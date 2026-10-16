# Low-Level Design (LLD): Portfolio & Watchlist Analyzer

> Status: **v1 complete — all sections approved 2026-10-16.** Source of truth: `docs/HLD.md` v1.3 (signed off 2026-10-16). Each section is reviewed and approved before implementation of that area starts.

| § | Section | Status |
|---|---|---|
| 1 | Data models & Firestore schema | **Approved 2026-10-16** |
| 2 | Core domain logic (holdings/XIRR, indicators, scoring, CSV, rules) | **Approved 2026-10-16** |
| 3 | Services (market data, FX, Gemini, instrument sync, repositories) | **Approved 2026-10-16** |
| 4 | App: navigation, state, screen → data mapping | **Approved 2026-10-16** |
| 5 | Error taxonomy, test plan, delivery order | **Approved 2026-10-16** |

---

## 1. Data Models & Firestore Schema

Traceability: HLD §4 (data model), §7 (CSV), §11 (security), §15 (instrument master), §16 (auth & actions), decisions D4, D12, D16, D21→D30, D23, D24, D25, D28, D31.

### 1.1 Conventions

| Topic | Rule |
|---|---|
| Schema location | `packages/core/src/models/*.ts`. Every persisted shape is a **zod** schema; TS types come from `z.infer`. Repositories validate on read **and** before write. |
| Schema versioning | Every Firestore document has `schemaVersion: 1`. Readers accept known versions and migrate in memory; writers always write the latest. |
| Timestamps | `createdAt` / `updatedAt` are Firestore server timestamps (`serverTimestamp()`); converted to epoch ms (`number`) at the repository boundary so `core` never sees SDK types. |
| Trade dates | `IsoDate` string `YYYY-MM-DD` (exchange-local calendar date), never a timestamp. |
| Money | `number` in the instrument's native currency. Never rounded when stored. |
| Missing data | `null` (never `0` or `""`) for optional numeric/text fields that are known-absent; field omitted only where noted. |
| IDs | Firestore auto-IDs unless a deterministic ID is specified (used where it enforces uniqueness). |
| Instrument key | `InstrumentKey` string `"<EXCHANGE>:<SYMBOL>"`, e.g. `NSE:RELIANCE`, `NASDAQ:AAPL`. Used for maps, caches and local lookups. |
| Nested arrays | Firestore cannot store arrays inside arrays. JSON-Logic and packed instrument rows are therefore stored as **JSON / TSV strings**, not maps. |

### 1.2 Primitive schemas (`models/primitives.ts`)

```ts
export const EXCHANGES = ['NSE', 'BSE', 'NASDAQ', 'NYSE', 'NYSE_ARCA', 'NYSE_AMERICAN', 'CBOE'] as const;
export const ExchangeSchema = z.enum(EXCHANGES);
export type Exchange = z.infer<typeof ExchangeSchema>;

export const MarketSchema = z.enum(['IN', 'US']);
export const CurrencySchema = z.enum(['INR', 'USD']);

/** Exchange → market/currency. Single source of truth; never inferred elsewhere. */
export const EXCHANGE_META: Readonly<Record<Exchange, { market: Market; currency: Currency }>> = {
  NSE: { market: 'IN', currency: 'INR' },
  BSE: { market: 'IN', currency: 'INR' },
  NASDAQ: { market: 'US', currency: 'USD' },
  NYSE: { market: 'US', currency: 'USD' },
  NYSE_ARCA: { market: 'US', currency: 'USD' },
  NYSE_AMERICAN: { market: 'US', currency: 'USD' },
  CBOE: { market: 'US', currency: 'USD' },
};

/** Uppercase exchange ticker without provider suffix. BSE uses the scrip ID (e.g. RELIANCE), not the numeric code. */
export const SymbolSchema = z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9.&_-]{0,19}$/);

export const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(isValidCalendarDate);

export const InstrumentKeySchema = z.string().regex(/^(NSE|BSE|NASDAQ|NYSE|NYSE_ARCA|NYSE_AMERICAN|CBOE):[A-Z0-9.&_-]{1,20}$/);
export const toInstrumentKey = (exchange: Exchange, symbol: string): InstrumentKey => `${exchange}:${symbol}`;

/** Broker / app name as displayed. Matching is case-insensitive on the trimmed value. */
export const PlatformSchema = z.string().trim().min(1).max(40);

export const SCHEMA_VERSION = 1 as const;
```

### 1.3 Firestore layout

```
users/{uid}                                   UserProfile
  ├─ transactions/{txId}                      BuyTransaction          (auto-ID)
  ├─ watchlists/{watchlistId}                 Watchlist               (auto-ID)
  │    └─ items/{instrumentKey}               WatchlistItem           (ID = "NSE:RELIANCE" → no duplicates per list)
  ├─ rules/{ruleId}                           Rule                    (auto-ID)
  └─ ruleResults/{YYYY-MM-DD}_{ruleId}        RuleResult              (deterministic → one per rule per day)

reference/instruments                         InstrumentMasterMeta    (read-only for signed-in users)
  └─ chunks/{chunkId}                         InstrumentChunk         (TSV text, ≤ 900 KB)
```

No composite indexes are needed in v1: every query reads a whole small subcollection for one user (see 1.10).

### 1.4 User profile — `users/{uid}` (`models/user.ts`)

```ts
export const UserProfileSchema = z.object({
  schemaVersion: z.literal(1),
  displayName: z.string().trim().min(1).max(80),
  email: z.string().email(),
  authProvider: z.enum(['google', 'password']),
  settings: z.object({
    summaryCurrency: CurrencySchema.default('INR'),           // D25: portfolio summary only
    defaultSort: z.enum(['VALUE_DESC', 'PNL_PCT_DESC', 'NAME_ASC']).default('VALUE_DESC'),
    aiSuggestions: z.boolean().default(true),                 // D29; forced false when build flag is off
  }),
  platforms: z.array(PlatformSchema).max(30).default([]),     // managed list (Settings → Platforms), dropdown source
  sectorOverrides: z.record(InstrumentKeySchema, z.string().trim().min(1).max(60)).default({}),
  createdAt: z.number(),
  updatedAt: z.number(),
});
```

- **Device-local settings are not stored here:** biometric app lock (per device) lives in MMKV (1.9).
- **Sector overrides** live on the profile (one per instrument), not on each transaction, so a stock bought on three brokers has one sector. A CSV `sector` value writes an override.
- **Platform rename** (Settings → Platforms) rewrites `platform` on every matching transaction in batched writes (≤ 500 per batch) and updates `platforms`.
- The effective `aiSuggestions` = `settings.aiSuggestions && FEATURES.aiSuggestions` (build flag wins).

### 1.5 Buy transaction — `users/{uid}/transactions/{txId}` (`models/transaction.ts`)

HLD D30: every individual buy is one document. Holdings are derived (§2), never stored.

```ts
export const TransactionTypeSchema = z.enum(['BUY']);   // v1. Later: 'SELL', 'DIVIDEND', 'SPLIT' (no migration needed)

export const BuyTransactionSchema = z
  .object({
    schemaVersion: z.literal(1),
    type: TransactionTypeSchema,
    symbol: SymbolSchema,
    exchange: ExchangeSchema,
    name: z.string().trim().min(1).max(120),             // display snapshot (master list name preferred at render time)
    platform: PlatformSchema,
    quantity: z.number().positive().max(1e9),
    price: z.number().positive().max(1e7),               // per share, native currency
    tradeDate: IsoDateSchema,
    source: z.enum(['CSV', 'MANUAL']),
    importBatchId: z.string().nullable(),                // groups rows from one CSV upload; null for manual
    createdAt: z.number(),
    updatedAt: z.number(),
  })
  .superRefine((tx, ctx) => {
    if (EXCHANGE_META[tx.exchange].market === 'IN' && !Number.isInteger(tx.quantity)) {
      ctx.addIssue({ code: 'custom', path: ['quantity'], message: 'Indian shares must be whole numbers' });
    }
    if (tx.tradeDate > todayIso() || tx.tradeDate < '1990-01-01') {
      ctx.addIssue({ code: 'custom', path: ['tradeDate'], message: 'Trade date out of range' });
    }
  });

export type BuyTransaction = z.infer<typeof BuyTransactionSchema> & { id: string };
```

**Duplicates are allowed** (HLD D31). `core.findLikelyDuplicates()` flags buys sharing `symbol + exchange + normalised(platform) + tradeDate + quantity` (against existing buys and within the file). It is used only for the **non-blocking** post-import heads-up ("3 look like duplicates" → Review) and a warning on manual add; nothing is ever rejected for being a duplicate.

**Undo import:** every CSV upload gets a fresh `importBatchId` (UUID). The success toast and Settings → Data offer **Undo last import**, which deletes all transactions with that ID. The last batch ID and its timestamp are kept in MMKV (`import.lastBatch`) for 7 days.

**"Keep history" seam** (HLD §16): v1 Remove = hard delete of the stock's transactions. Later, SELL transactions replace deletion; no field reservation needed beyond `type`.

### 1.6 Watchlists (`models/watchlist.ts`)

```ts
// users/{uid}/watchlists/{watchlistId}
export const WatchlistSchema = z.object({
  schemaVersion: z.literal(1),
  name: z.string().trim().min(1).max(40),      // editable (D23); unique per user, case-insensitive (checked in app)
  sortOrder: z.number().int().min(0),
  createdAt: z.number(),
  updatedAt: z.number(),
});

// users/{uid}/watchlists/{watchlistId}/items/{instrumentKey}
export const WatchlistItemSchema = z.object({
  schemaVersion: z.literal(1),
  symbol: SymbolSchema,
  exchange: ExchangeSchema,
  targetEntryPrice: z.number().positive().nullable(),
  targetExitPrice: z.number().positive().nullable(),
  notes: z.string().max(500).nullable(),
  addedAt: z.number(),
  updatedAt: z.number(),
});
```

- Item document ID = `InstrumentKey`, so a stock appears at most once per list but may be in several lists.
- Limits: ≤ 20 watchlists, ≤ 100 items per list (enforced in app; HLD scale ≤ 50 items total is the typical case).
- First sign-in creates one watchlist named **"My Watchlist"**.
- Deleting a watchlist deletes its items (client batch), after confirmation.

### 1.7 Rules (`models/rule.ts`)

```ts
// users/{uid}/rules/{ruleId}
export const RuleSchema = z.object({
  schemaVersion: z.literal(1),
  name: z.string().trim().min(1).max(60),
  naturalPrompt: z.string().trim().min(3).max(500),        // user's English text (untrusted)
  compiledLogicJson: z.string().max(10_000),               // JSON-Logic AST as JSON string (nested arrays!)
  readBack: z.string().max(500),                            // plain-English read-back the user confirmed
  variables: z.array(RuleVariableSchema).min(1),            // whitelist keys used (ANALYSIS_FRAMEWORK §8)
  appliesToPortfolio: z.boolean(),
  appliesToWatchlists: z.boolean(),                         // D28: means ALL watchlists
  enabled: z.boolean(),
  compiledWith: z.object({ model: z.string(), promptVersion: z.string() }),
  createdAt: z.number(),
  updatedAt: z.number(),
}).refine((r) => r.appliesToPortfolio || r.appliesToWatchlists, { message: 'Rule must apply to portfolio or watchlists' });

// users/{uid}/ruleResults/{YYYY-MM-DD}_{ruleId}
export const RuleResultSchema = z.object({
  schemaVersion: z.literal(1),
  ruleId: z.string(),
  sessionDate: IsoDateSchema,
  matches: z.array(z.object({
    instrumentKey: InstrumentKeySchema,
    scope: z.enum(['PORTFOLIO', 'WATCHLIST']),
  })).max(200),
  evaluatedAt: z.number(),
});
```

- `compiledLogicJson` is parsed and **re-validated against the whitelist on every load** (defence in depth), not only at save time.
- `RuleVariableSchema` = `z.enum([...])` generated from the single `RULE_VARIABLES` constant in `core/rules` (§2).
- Limit ≤ 25 rules (HLD scale). `ruleResults` older than 30 days are deleted opportunistically by the app on refresh.
- Results are stored in Firestore (tiny) so "Triggered today (NVDA, INFY)" survives reinstall and shows on the Rules hub.

### 1.8 Instrument master list — `reference/instruments` (`models/instrument.ts`)

```ts
export const InstrumentTypeSchema = z.enum(['EQUITY', 'ETF']);

export const ListingSchema = z.object({
  exchange: ExchangeSchema,
  symbol: SymbolSchema,
  providerCode: z.string().nullable(),       // BSE numeric scrip code (e.g. "500325"); null otherwise
});

/** One company/fund. NSE+BSE listings merged by ISIN (HLD §15). */
export const InstrumentSchema = z.object({
  id: z.string(),                            // ISIN when known, else "<EXCHANGE>:<SYMBOL>" of the primary listing
  name: z.string().min(1).max(160),
  isin: z.string().regex(/^[A-Z]{2}[A-Z0-9]{9}\d$/).nullable(),
  type: InstrumentTypeSchema,
  listings: z.array(ListingSchema).min(1).max(2),
  industry: z.string().nullable(),           // BSE only; sector for held stocks comes from market data
});

// reference/instruments  (meta — written LAST by the sync)
export const InstrumentMasterMetaSchema = z.object({
  schemaVersion: z.literal(1),
  version: z.string(),                       // e.g. "2026-10-15.1"
  generatedAt: z.number(),
  sourceDates: z.object({ nse: IsoDateSchema, bse: IsoDateSchema, us: IsoDateSchema }),
  counts: z.object({ total: z.number().int(), nse: z.number().int(), bse: z.number().int(), us: z.number().int() }),
  chunkIds: z.array(z.string()).min(1).max(10),
  sha256: z.string().length(64),             // over the concatenated chunk texts, in chunkIds order
  columns: z.literal('id\tname\tisin\ttype\tnse\tbse\tbseCode\tus\tusExchange\tindustry'),
});

// reference/instruments/chunks/{chunkId}
export const InstrumentChunkSchema = z.object({
  schemaVersion: z.literal(1),
  version: z.string(),                       // must equal meta.version
  index: z.number().int().min(0),
  tsv: z.string().max(900_000),              // one instrument per line, columns as in meta.columns, "" = null
});
```

- **Why TSV in a string:** ~18.5k rows × ~60 B ≈ 1.1 MB → 2 chunk documents ≈ **3 reads per full download** (meta + 2), versus 18.5k reads for one-doc-per-instrument. Tabs/newlines are stripped from names during the build.
- **Versioning:** the sync writes `chunks/{version}-{index}` first, then the meta doc, then deletes chunks of older versions. A client that read an old meta mid-sync still finds its chunks.
- **Client integrity check:** recompute `sha256` after download; on mismatch keep the previous local copy and retry on next launch.

### 1.9 Device-local storage (MMKV, encrypted)

Encryption key: 32 random bytes generated on first launch, stored in `expo-secure-store` (Android Keystore-backed). Cleared on sign-out together with all keys below (except `device.*`).

| Key | Value | Written by | Invalidation |
|---|---|---|---|
| `device.biometricLock` | `boolean` | Settings | user toggle (survives sign-out) |
| `instruments.meta` | `InstrumentMasterMeta` | instrument sync | new version |
| `instruments.tsv` | concatenated chunk TSV | instrument sync | new version (atomic replace: write `instruments.tsv.next`, verify hash, swap) |
| `instruments.lastCheckAt` | epoch ms | instrument sync | — (check ≤ 1×/24 h) |
| `market.bars.<InstrumentKey>` | daily OHLCV, ~260 sessions | market-data service (§3) | new session |
| `market.fundamentals.<InstrumentKey>` | fundamentals snapshot | market-data service | 7 days |
| `market.profile.<InstrumentKey>` | sector/industry from provider | market-data service | 30 days |
| `market.macro` | indices, VIX snapshot | market-data service | new session |
| `market.index.<NIFTY50\|SP500>` | index adjClose history back to the earliest buy (benchmark) | market-data service | extended, never discarded |
| `fx.usdInr` | latest USD/INR + history | fx service | latest: new IN session; history: extended |
| `ai.performance` | map InstrumentKey → rating entry (own session date + input hash) | Gemini service | per entry: new session, changed inputs, or on-demand refresh (D26) |
| `ai.signals` | map InstrumentKey → signal entry | Gemini service | as above |
| `ai.analysis.<InstrumentKey>` | deep-analysis entry | Gemini service | as above |
| `ai.marketSentiment` | watchlist market-context paragraph entry | Gemini service | new session in either market, or on-demand refresh |
| `ai.usage.<YYYY-MM-DD>` | Gemini request count for the day | Gemini service | pruned after 3 days |
| `import.lastBatch` | `{ importBatchId, importedAt, count }` | CSV import | 7 days, or after Undo |
| `ui.*` | last filters, collapsed sectors | UI | — |

Exact shapes of `market.*`, `fx.*` and `ai.*` values are specified with their services in §3 (amended on §3 approval). AI entries older than 3 sessions are pruned on launch.

### 1.10 Repositories (`apps/mobile/src/services/firestore/`)

Interfaces live in `core` (`core/ports.ts`) so domain code and tests depend on interfaces, not the SDK.

```ts
export interface TransactionRepository {
  listAll(): Promise<BuyTransaction[]>;                                   // whole subcollection (≤ 500)
  addMany(txs: NewBuyTransaction[], importBatchId: string | null): Promise<string[]>; // batched, ≤ 500/batch
  deleteByImportBatch(importBatchId: string): Promise<number>;            // Undo import; returns docs deleted
  update(id: string, patch: BuyTransactionPatch): Promise<void>;
  deleteMany(ids: string[]): Promise<void>;                               // Remove stock / remove from broker
  renamePlatform(from: string, to: string): Promise<number>;              // returns docs updated
}

export interface WatchlistRepository {
  listWatchlists(): Promise<Watchlist[]>;
  createWatchlist(name: string): Promise<string>;
  renameWatchlist(id: string, name: string): Promise<void>;
  deleteWatchlist(id: string): Promise<void>;                             // deletes items first
  listItems(watchlistId: string): Promise<WatchlistItem[]>;
  upsertItem(watchlistId: string, item: NewWatchlistItem): Promise<void>; // doc ID = InstrumentKey
  removeItem(watchlistId: string, key: InstrumentKey): Promise<void>;
}

export interface RuleRepository {
  list(): Promise<Rule[]>;
  create(rule: NewRule): Promise<string>;
  update(id: string, patch: RulePatch): Promise<void>;
  delete(id: string): Promise<void>;
  saveResults(results: RuleResult[]): Promise<void>;
  listResults(sessionDate: IsoDate): Promise<RuleResult[]>;
  pruneResultsBefore(date: IsoDate): Promise<void>;
}

export interface ProfileRepository {
  get(): Promise<UserProfile | null>;
  createIfMissing(seed: ProfileSeed): Promise<UserProfile>;               // first sign-in: profile + "My Watchlist"
  updateSettings(patch: Partial<UserProfile['settings']>): Promise<void>;
  setPlatforms(platforms: string[]): Promise<void>;
  setSectorOverride(key: InstrumentKey, sector: string | null): Promise<void>;
  deleteAccountData(): Promise<void>;                                      // see 1.12
}

export interface InstrumentMasterRepository {
  getMeta(): Promise<InstrumentMasterMeta | null>;
  getChunks(meta: InstrumentMasterMeta): Promise<InstrumentChunk[]>;
}
```

Read budget (Spark free tier = 50k reads/day): a cold start reads profile (1) + transactions (≤ 500) + watchlists/items (≤ ~70) + rules (≤ 25) + today's results (≤ 25) ≈ **≤ 650 reads**; Firestore offline persistence serves later screens from cache. Instrument meta check adds 1 read/day.

### 1.11 Security rules (`firebase/firestore.rules`, replaces the baseline)

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function signedIn() { return request.auth != null; }
    function isOwner(uid) { return signedIn() && request.auth.uid == uid; }
    function data() { return request.resource.data; }
    function onlyKeys(keys) { return data().keys().hasOnly(keys); }
    function v1() { return data().schemaVersion == 1; }
    function isExchange(x) { return x in ['NSE','BSE','NASDAQ','NYSE','NYSE_ARCA','NYSE_AMERICAN','CBOE']; }
    function isIsoDate(s) { return s is string && s.matches('^[0-9]{4}-[0-9]{2}-[0-9]{2}$'); }
    function posNum(n) { return (n is int || n is float) && n > 0; }
    function shortStr(s, max) { return s is string && s.size() > 0 && s.size() <= max; }

    match /users/{uid} {
      allow read, delete: if isOwner(uid);
      allow create, update: if isOwner(uid) && v1()
        && onlyKeys(['schemaVersion','displayName','email','authProvider','settings','platforms','sectorOverrides','createdAt','updatedAt'])
        && data().platforms is list && data().platforms.size() <= 30
        && data().sectorOverrides is map;

      match /transactions/{txId} {
        allow read, delete: if isOwner(uid);
        allow create, update: if isOwner(uid) && v1()
          && onlyKeys(['schemaVersion','type','symbol','exchange','name','platform','quantity','price','tradeDate','source','importBatchId','createdAt','updatedAt'])
          && data().type == 'BUY'
          && isExchange(data().exchange)
          && shortStr(data().symbol, 20) && shortStr(data().name, 120) && shortStr(data().platform, 40)
          && posNum(data().quantity) && posNum(data().price)
          && isIsoDate(data().tradeDate)
          && data().source in ['CSV','MANUAL'];
      }

      match /watchlists/{wid} {
        allow read, delete: if isOwner(uid);
        allow create, update: if isOwner(uid) && v1()
          && onlyKeys(['schemaVersion','name','sortOrder','createdAt','updatedAt'])
          && shortStr(data().name, 40);

        match /items/{key} {
          allow read, delete: if isOwner(uid);
          allow create, update: if isOwner(uid) && v1()
            && onlyKeys(['schemaVersion','symbol','exchange','targetEntryPrice','targetExitPrice','notes','addedAt','updatedAt'])
            && isExchange(data().exchange)
            && key == data().exchange + ':' + data().symbol;
        }
      }

      match /rules/{ruleId} {
        allow read, delete: if isOwner(uid);
        allow create, update: if isOwner(uid) && v1()
          && onlyKeys(['schemaVersion','name','naturalPrompt','compiledLogicJson','readBack','variables','appliesToPortfolio','appliesToWatchlists','enabled','compiledWith','createdAt','updatedAt'])
          && shortStr(data().naturalPrompt, 500)
          && data().compiledLogicJson is string && data().compiledLogicJson.size() <= 10000
          && (data().appliesToPortfolio == true || data().appliesToWatchlists == true);
      }

      match /ruleResults/{resultId} {
        allow read, delete: if isOwner(uid);
        allow create, update: if isOwner(uid) && v1()
          && onlyKeys(['schemaVersion','ruleId','sessionDate','matches','evaluatedAt'])
          && isIsoDate(data().sessionDate)
          && resultId == data().sessionDate + '_' + data().ruleId
          && data().matches is list && data().matches.size() <= 200;
      }
    }

    // Instrument master list: read-only; written only by the sync (Admin SDK bypasses rules).
    match /reference/{document=**} {
      allow read: if signedIn();
      allow write: if false;
    }
  }
}
```

Rules enforce **ownership, shape and basic types**; full semantic validation (dates in range, integer Indian quantities, whitelist of rule variables) is done by zod in the app. Rules are the backstop against a buggy or tampered client, not the primary validator.

### 1.12 Lifecycle flows

| Event | Behaviour |
|---|---|
| **First sign-in** | `createIfMissing`: profile with defaults, `platforms` empty, one watchlist "My Watchlist". Idempotent (transaction: create only if absent). |
| **Email sign-up** | Profile is created only after `emailVerified == true` (checked on next app open / "I've verified" button). |
| **Sign-out** | Firebase sign-out → clear Firestore offline cache (`clearPersistence`) → wipe MMKV except `device.*` → delete MMKV key from secure store. |
| **Delete account** (S09 confirm) | Re-authenticate if required → delete `ruleResults`, `rules`, watchlist `items`, `watchlists`, `transactions` in batches of ≤ 500 → delete `users/{uid}` → delete the Auth user → sign-out cleanup. On partial failure: show retry; the operation is idempotent. (No Cloud Function on Spark; done client-side.) |
| **Remove stock** (S02b) | Confirmation lists brokers and quantities → `deleteMany(all tx ids of the instrument)`; sector override kept (harmless) unless no other references remain. |
| **Remove from broker** (Edit) | `deleteMany(tx ids of instrument on that platform)`. |

### 1.13 Test plan for this section

| Test | Tool | Cases |
|---|---|---|
| Schema unit tests | Jest (`packages/core`) | valid docs pass; each field boundary (empty/max length, negative/zero price, fractional NSE qty, future date, 1989 date, bad exchange, lowercase symbol normalised, malformed ISIN); `schemaVersion` mismatch rejected; JSON-Logic string > 10k rejected |
| Instrument TSV round-trip | Jest | build TSV from records → parse → identical; names with tabs/newlines sanitised; sha256 stable |
| Security rules | Firebase emulator + `@firebase/rules-unit-testing` (`firebase/tests/`) | owner can CRUD own docs; other user denied read/write on every path; unauthenticated denied; extra field rejected; `type: 'SELL'` rejected; item ID ≠ `exchange:symbol` rejected; ruleResult ID mismatch rejected; rule with both scopes false rejected; `reference/**` readable when signed in, never writable |
| Repository contract | Jest with emulator | batched `addMany` > 500 docs splits batches; `deleteByImportBatch` removes only that batch; `renamePlatform` updates only matching (case-insensitive); `deleteAccountData` leaves no documents |

### 1.14 Review decisions (2026-10-16)
1. Duplicate buys are allowed for CSV and manual add; post-import heads-up + Undo import (HLD D31).
2. Watchlist limits ≤ 20 lists × ≤ 100 items: approved.
3. Default "My Watchlist" on first sign-in: approved.
4. Email sign-up creates the profile only after verification: approved.

---

## 2. Core Domain Logic (`packages/core`)

Traceability: HLD §4, §5, §7, §8, §15, D6, D11, D22, D26, D28, D30, D31; `ANALYSIS_FRAMEWORK.md` §2–§8.

All functions in this section are **pure and synchronous** (no I/O, no `Date.now()`; "today"/session date is always passed in). That makes every one of them table-testable and reusable by the later Cloud Functions.

### 2.1 Module layout & public API

```
packages/core/src/
  models/        §1 schemas
  ports.ts       §1.10 repository interfaces + MarketData/AI ports (§3)
  market/        DailyBar, MarketSnapshot types; session-date helpers
  holdings/      aggregate.ts, filters.ts, summary.ts, xirr.ts, benchmark.ts
  indicators/    compute.ts (wraps technicalindicators)
  analysis/      thresholds.ts, sectors.ts, classify.ts, health.ts, proscons.ts
  rules/         variables.ts, validate.ts, evaluate.ts, readback.ts, context.ts
  csv/           parse.ts, headers.ts, validate.ts, suggest.ts, duplicates.ts
  instruments/   build.ts (sync), tsv.ts, search.ts, normalise.ts
  prompts/       builders + versions (specified with the Gemini service in §3)
  index.ts       re-exports the public API below
```

| Function | Signature (abridged) |
|---|---|
| `aggregateHoldings` | `(txs, ctx: PricingContext, filters: PortfolioFilters) → StockHolding[]` |
| `groupBySector` | `(holdings) → SectorGroup[]` |
| `summarisePortfolio` | `(holdings, ctx, summaryCurrency) → PortfolioSummary` |
| `xirr` | `(cashflows: Cashflow[]) → number \| null` |
| `benchmarkReturn` | `(cashflows, indexBars, valuationDate) → BenchmarkResult` |
| `computeIndicators` | `(bars: DailyBar[]) → IndicatorSet` |
| `analyseInstrument` | `(input: AnalysisInput) → AnalysisResult` (parameters, health, pros/cons) |
| `validateRuleLogic` | `(ast: unknown) → Result<ValidRuleAst, RuleIssue[]>` |
| `evaluateRule` | `(ast, ctx: RuleContext) → 'MATCH' \| 'NO_MATCH' \| 'INSUFFICIENT_DATA'` |
| `renderReadBack` | `(ast) → string` |
| `parseHoldingsCsv` | `(text, deps: CsvDeps) → CsvImportResult` |
| `findLikelyDuplicates` | `(incoming, existing) → DuplicateGroup[]` |
| `buildInstrumentMaster` | `(sources: RawSources) → { instruments, tsv, counts }` (sync only) |
| `parseInstrumentTsv` / `searchInstruments` | `(tsv) → InstrumentIndex` / `(index, query, opts) → SearchHit[]` |

### 2.2 Market data types (`market/`)

```ts
export type DailyBar = {
  date: IsoDate;            // exchange-local session date
  open: number; high: number; low: number;
  close: number;            // as traded — used for prices, P/L and value
  adjClose: number;         // split/dividend adjusted — used for indicators and return series
  volume: number;
};

export type MarketSnapshot = {
  key: InstrumentKey;
  sessionDate: IsoDate;     // last completed session
  close: number;
  prevClose: number | null;
  bars: readonly DailyBar[];          // ascending, ~260 sessions (1y) for indicators
};

export type PricingContext = {
  valuationDate: IsoDate;                                   // per-market last session (see sessionDateFor)
  snapshots: ReadonlyMap<InstrumentKey, MarketSnapshot>;
  fx: { usdInr: number; asOf: IsoDate; history: ReadonlyMap<IsoDate, number> };   // history for XIRR conversion
  sectorOf: (key: InstrumentKey) => string | null;           // override → provider profile → master industry → null
  labels: ReadonlyMap<InstrumentKey, { performance: Label | null; health: Label | null }>;
};

export type Label = 'GOOD' | 'AVERAGE' | 'BAD';
```

`sessionDateFor(market, now: EpochMs) → IsoDate`: last completed session date — IN closes 15:30 Asia/Kolkata, US closes 16:00 America/New_York; weekends skipped. Exchange holidays are **not** modelled: if a fetched snapshot's `sessionDate` is older than expected, the snapshot's own date wins (the data is the truth).

### 2.3 Holdings (`holdings/`)

```ts
export type BrokerPosition = { platform: string; quantity: number; avgPrice: number; invested: number; buys: BuyTransaction[] };

export type StockHolding = {
  key: InstrumentKey; symbol: string; exchange: Exchange; name: string;
  market: Market; currency: Currency; sector: string | null;
  quantity: number;          // Σ q
  avgPrice: number;          // Σ(q·p) / Σ q
  invested: number;          // Σ(q·p)
  close: number | null;      // null when no snapshot yet
  value: number | null;      // quantity × close
  pnl: number | null;        // value − invested
  pnlPct: number | null;     // pnl / invested × 100
  dayChange: number | null;  // quantity × (close − prevClose)
  dayChangePct: number | null;
  xirrPct: number | null;    // money-weighted, annualised; null if first buy < 365 days old (absolute pnlPct is used then)
  holdingDays: number;       // quantity-weighted average age of buys
  firstBuyDate: IsoDate;
  brokers: BrokerPosition[]; // sorted by invested desc — used by Edit (S02b)
  performance: Label | null; health: Label | null;
};
```

**Filters** (`PortfolioFilters`, S02a): `platforms[]`, `markets[]`, `exchanges[]`, `sectors[]`, `performance[]`, `health[]` (empty array = no filter), `sort: 'VALUE_DESC' | 'DAY_PNL_PCT_DESC' | 'PNL_PCT_DESC' | 'WEIGHT_DESC' | 'NAME_ASC'`.
Order of application: **transaction-level** filters (platform, market, exchange) are applied *before* aggregation, so a card reflects only matching buys (HLD §4); **holding-level** filters (sector, labels) after aggregation. Platform matching is case-insensitive on trimmed names.

**Sector groups** (`SectorGroup`): `{ sector: string ('Unclassified' when null), holdings, value, invested, pnl, pnlPct, weightPct }`. `weightPct` is relative to the filtered portfolio value **in summary currency** (INR and USD holdings in one sector are converted for weight only; displayed holding values stay native, D25).

**Portfolio summary** (`PortfolioSummary`, header of S02): all amounts in `summaryCurrency`, converted at `fx.usdInr` (current rate):
`totalValue`, `invested`, `unrealisedPnl`, `unrealisedPnlPct`, `dayChange`, `dayChangePct`, `xirrPct` (portfolio-level, see below), and per-market blocks `{ market, value, weightPct, xirrPct }` for the US / India cards and the allocation bar. `fx.asOf` is displayed.

**Portfolio-level XIRR across currencies:** each buy's cash flow is converted into summary currency at the **historical USD/INR rate on its trade date** (Frankfurter time series, nearest earlier date), and the terminal value at the current rate. Per-market XIRR uses native currency (no FX).

### 2.4 XIRR (`holdings/xirr.ts`)

```ts
export type Cashflow = { date: IsoDate; amount: number };   // buys negative, terminal value positive
export function xirr(flows: readonly Cashflow[]): number | null;
```
- Solves `Σ amount_i / (1 + r)^((d_i − d_0)/365) = 0` for `r`.
- Newton–Raphson from `r₀ = 0.1`; on non-convergence or derivative ≈ 0, **bisection** on `[-0.9999, 100]`. Tolerance `1e-7`, **max 100 iterations** (bounded loop).
- Returns `null` when: < 2 flows, no sign change, no root in bracket, or span < 365 days (HLD/framework: annualise only when the first buy is ≥ 1 year old).
- Result returned as a fraction; callers multiply by 100 for `xirrPct`.

### 2.5 Benchmark (`holdings/benchmark.ts`)

Implements ANALYSIS_FRAMEWORK §4.1 "same amounts on the same dates":
```
units_i      = amount_i / indexClose(onOrBefore(tradeDate_i))
benchValue   = Σ units_i × indexClose(valuationDate)
benchPnlPct  = (benchValue / Σ amount_i − 1) × 100
benchXirrPct = xirr(same buy flows, terminal = benchValue)     // null if < 365 days
excessReturnPp = (holding xirrPct ?? pnlPct) − (benchXirrPct ?? benchPnlPct)   // like-for-like
```
Index = `^NSEI` (Nifty 50) for IN, `^GSPC` (S&P 500) for US, using **adjClose** history back to the first buy (fetched once, cached; §3). If index history doesn't reach a buy date → `excessReturnPp = null` (Performance prompt receives null, framework handles it).

### 2.6 Indicators (`indicators/compute.ts`)

Input: `DailyBar[]` ascending. Series used: `adjClose` for all price indicators; `volume` raw.

| Output | Definition | Min bars (else `null`) |
|---|---|---|
| `close`, `closePrev` | last / previous **close** (as traded) | 1 / 2 |
| `changePct` | (close/closePrev − 1)×100 | 2 |
| `sma20/50/200` (+ `…Prev`) | simple MA of adjClose; Prev = same MA ending one bar earlier | n / n+1 |
| `rsi14` | Wilder RSI(14) (`technicalindicators` RSI) | 15 |
| `macd`, `macdSignal` (+ Prev) | EMA12−EMA26, signal EMA9 | 35 |
| `high52w`, `low52w` | max high / min low over last 252 bars | 252 (fewer → computed over available, flagged `partial`) |
| `range52wPct` | (close − low)/(high − low)×100 | as above |
| `drawdownPct` | (high52w − close)/high52w×100 | as above |
| `volatilityPct` | stdev of daily simple returns of adjClose over last 252 × √252 × 100 | 60 |
| `volume`, `avgVolume30` | last volume / mean of last 30 | 1 / 30 |
| `volumeTrend` | mean volume of up-days in last 20 ÷ mean volume of up-days in last 90 | 90 |

Prices are compared against `adjClose`-based averages scaled to the latest bar (adjClose of the last bar equals close, so comparisons like `close > sma200` stay consistent).

**Corporate actions (known v1 limitation):** buy prices are as entered; after a split the P/L of older buys is wrong until the user edits them (SPLIT transactions are a later release). Indicators are unaffected because they use `adjClose`. The app shows a hint when a stock's close/prevClose ratio suggests a split (e.g. ≈ 1/2, 1/5, 1/10) on the day it happens.

### 2.7 Analysis & Health (`analysis/`)

```ts
export type ParamLevel = 'GOOD' | 'AVERAGE' | 'BAD' | 'NA';
export type ParamResult = { key: ParamKey; group: 'TECHNICAL' | 'FUNDAMENTAL'; value: number | null; level: ParamLevel; weight: number; reason: string };
export type AnalysisInput = { indicators: IndicatorSet; fundamentals: Fundamentals | null; sectorCategory: SectorCategory; macro: MacroSnapshot };
export type AnalysisResult = {
  params: ParamResult[];
  technicalScore: number | null; fundamentalScore: number | null;
  healthScore: number | null;          // 0–100
  healthLabel: Label | null;           // null = ⚪ insufficient
  pros: ParamResult[]; cons: ParamResult[];
  macro: MacroAssessment;              // ANALYSIS_FRAMEWORK §6, shown not scored
};
```

- **Thresholds:** one `THRESHOLDS` object in `thresholds.ts` mirroring ANALYSIS_FRAMEWORK §2–§3 exactly (e.g. `roe: { good: { gt: 15 }, bad: { lt: 10 } }`). No threshold literal appears anywhere else. Boundaries: `good` and `bad` are strict; everything between is AVERAGE.
- **Sector category** (`sectors.ts`): keyword mapping of the provider sector/industry string → `FINANCIALS | UTILITIES_REAL_ESTATE | TECH | FMCG | OTHER` (e.g. "Financial Services", "Banks", "Insurance" → FINANCIALS). Applies the skip/relax rules of framework §5 and the FINANCIALS `pb`/`roe` weight 2.0.
- **Valuation vs sector median (v1 deviation):** free data sources give no reliable sector medians, so v1 uses the framework's **absolute fallback** thresholds for `pe`, `pb`, `netMargin` everywhere. The classifier keeps a `sectorMedian?: number` input so sector-relative scoring can be switched on later without changing callers.
- **Scores:** `groupScore = Σ(weight × v) / Σ(weight)` over non-NA params with v ∈ {+1, 0, −1}; `health = 50 + 50 × (0.4 × technical + 0.6 × fundamental)`; if one group has no data, the other group alone (weight 1.0) is used. `healthLabel`: ≥ 65 GOOD, 40–64 AVERAGE, < 40 BAD; `null` when fewer than 50 % of applicable parameters are available.
- **Pros/cons:** all GOOD / BAD params, each with a templated reason, e.g. `ROE 22.1% — strong return on shareholder capital (> 15%)`. Templates live next to the thresholds. Max 5 each, ordered by weight then distance from threshold.

### 2.8 Rule engine (`rules/`)

**Variables** (`variables.ts`): a single `RULE_VARIABLES` record, the only source for the whitelist, the zod enum (§1.7) and the Gemini prompt:
```ts
export const RULE_VARIABLES = {
  close:        { type: 'number', label: 'Close price', scopes: ['PORTFOLIO', 'WATCHLIST'] },
  sma50:        { type: 'number', label: '50-day moving average', scopes: [...] },
  // … all keys from ANALYSIS_FRAMEWORK §8
  pnlPct:       { type: 'number', label: 'Your P/L %', scopes: ['PORTFOLIO'] },
  targetEntryPrice: { type: 'number', label: 'Target entry price', scopes: ['WATCHLIST'] },
  sector:       { type: 'string', label: 'Sector', scopes: [...] },
  market:       { type: 'enum', values: ['IN', 'US'], label: 'Market', scopes: [...] },
  healthLabel:  { type: 'enum', values: ['GOOD', 'AVERAGE', 'BAD'], label: 'Health', scopes: [...] },
} as const;
```

**Validation** (`validateRuleLogic`): recursive walk with limits **depth ≤ 10, nodes ≤ 100**; each node must be a literal (number, string ≤ 60 chars, boolean), an array of literals (only as the 2nd arg of `in`), `{ var: <whitelisted key> }`, or `{ <allowed op>: [args] }` with the op's arity. Allowed ops exactly as framework §8. Type checks: comparison operands must be number-typed vars/literals; `==`/`in` on string/enum vars must use allowed values. Scope check: a rule using `pnlPct` cannot be applied to watchlists, `targetEntryPrice` not to the portfolio (error tells the user which toggle to change). Any violation → `RuleIssue { code, path, message }`; nothing is saved.

**Evaluation** (`evaluateRule`): a `json-logic-engine` instance with **only the allowed operators registered**. Before evaluating, if any referenced variable is `null` in the context → `INSUFFICIENT_DATA` (never a silent false/true). Otherwise truthy → `MATCH`.

**Context** (`context.ts`): `buildRuleContext(holding | watchItem, indicators, analysis, macro)` → flat `Record<RuleVariable, number | string | null>`.

**Read-back** (`renderReadBack`): **deterministic** renderer from the validated AST to English using the variable labels, e.g. `RSI (14) is below 30 AND P/E is below 20 AND 20-day MA crossed above 50-day MA`. The user confirms this text, not the LLM's prose, so what they approve is exactly what runs. The crossover pattern (`aPrev <= bPrev and a > b`) is recognised and rendered as "crossed above".

**Dry run** (S08a "Run Dry Test"): validate → read-back → evaluate against today's portfolio and/or all watchlists → list matches and insufficient-data stocks. No save.

**Daily evaluation:** after the market refresh, every enabled rule is evaluated per scope; results → `RuleResult` (§1.7) for that session date.

### 2.9 CSV import (`csv/`)

Pipeline: `text → parse → headers → rows → validate → (errors | transactions + warnings + likelyDuplicates)`.

1. **Limits:** ≤ 1 MB, ≤ 2,000 data rows, UTF-8 (BOM stripped). Delimiter auto-detected (`,` `;` tab) by papaparse; `header: true`, `skipEmptyLines: 'greedy'`, values trimmed.
2. **Headers:** case/space/underscore-insensitive match against canonical names + aliases:

   | Canonical | Accepted aliases |
   |---|---|
   | `symbol` | ticker, scrip, tradingsymbol, instrument |
   | `name` | company, company_name, stock_name, security |
   | `exchange` | exch, market_exchange |
   | `quantity` | qty, shares, units |
   | `buy_price` | price, avg_price, average_price, cost, buy_avg |
   | `buy_date` | date, trade_date, purchase_date |
   | `platform` | broker, account, source |
   | `sector` | industry |

   Missing required column → `CSV_MISSING_COLUMN` with fix "add column `X`" (or "rename `Qty` → `quantity`" if an unknown header is a close match by edit distance ≤ 2). Unknown extra columns are ignored with a warning.
3. **Field normalisation (accepted silently):** symbol uppercased; numbers may contain thousands separators `,`, spaces and a leading `₹`/`$`; exchange case-insensitive, `NASDAQGS`/`NASDAQ GS` → NASDAQ, `NYSEARCA` → NYSE_ARCA.
4. **Field validation (errors, each with a suggested fix):**

   | Code | Condition | Suggested fix |
   |---|---|---|
   | `CSV_SYMBOL_SUFFIX` | symbol ends `.NS` / `.BO` / `.BSE` | "Use symbol `INFY`, exchange `NSE`" |
   | `CSV_UNKNOWN_SYMBOL` | not in master list for that exchange | up to 3 suggestions: exact symbol on another exchange ("`AAPL` is listed on `NASDAQ`"), then closest symbols (Damerau-Levenshtein ≤ 2), then name matches |
   | `CSV_BAD_EXCHANGE` | not a known exchange | list of accepted values |
   | `CSV_BAD_DATE` | unparseable | "Use YYYY-MM-DD, e.g. `2024-03-15`" |
   | `CSV_AMBIGUOUS_DATE` | `dd/mm/yyyy` vs `mm/dd/yyyy` both possible (both parts ≤ 12) | "Write it as `2024-03-05` or `2024-05-03`" |
   | `CSV_DATE_FORMAT` | unambiguous non-ISO (e.g. `15/03/2024`, `15-Mar-2024`) | "Use `2024-03-15`" (not auto-converted, so the file stays the source of truth) |
   | `CSV_FUTURE_DATE` / `CSV_DATE_TOO_OLD` | > today / < 1990-01-01 | — |
   | `CSV_BAD_NUMBER` | quantity/price not a positive number | "Quantity must be a positive number" |
   | `CSV_FRACTIONAL_IN` | fractional quantity on NSE/BSE | "Indian shares must be whole numbers" |
   | `CSV_MISSING_VALUE` | required cell empty | "Fill in `buy_price` on row 12" |
   | `CSV_TOO_LARGE` / `CSV_EMPTY` | limits | — |

   **Warnings (never block):** `CSV_NAME_MISMATCH` (normalised name similarity < 0.6 vs master; normalisation strips case, punctuation, "ltd/limited/inc/corp/co/the"), `CSV_UNKNOWN_COLUMN`, `CSV_NEW_PLATFORM` (platform not in the managed list → it will be added).
5. **Result:**
   ```ts
   type CsvIssue = { fileName: string; row: number | null; rowPreview: string | null; column: string | null; code: CsvIssueCode; message: string; suggestion: string | null };
   type CsvImportResult =
     | { ok: false; errors: CsvIssue[]; warnings: CsvIssue[] }          // nothing imported (all-or-nothing, HLD §7)
     | { ok: true; transactions: NewBuyTransaction[]; warnings: CsvIssue[]; likelyDuplicates: DuplicateGroup[]; newPlatforms: string[]; sectorOverrides: Record<InstrumentKey, string> };
   ```
   **Row references are for the error sheet only and are never stored.** Persisted data is per instrument + transaction (§1.5); the only link back to an upload is `importBatchId`. Each upload is validated independently, so line numbers from different files never interact, and a file with errors imports nothing.
   In the error sheet each issue shows: **file name**, **line number** (1-based, header = line 1, i.e. what a spreadsheet shows) and a **row preview** (`symbol · exchange · buy_date`), e.g. `holdings_zerodha.csv · line 12 · RELIANCEIND · NSE · 2024-03-15 → Unknown symbol. Did you mean RELIANCE (Reliance Industries, NSE)?`. All issues in the file are listed in one pass (sorted by line), so the user fixes everything before re-uploading.

### 2.10 Instrument master (`instruments/`)

**Build** (`buildInstrumentMaster`, used by the sync script / later Cloud Function) from the four raw files (formats in `data/instruments/README.md`):

| Source | Keep | Map |
|---|---|---|
| NSE `EQUITY_L.csv` | series ∈ {EQ, BE, BZ, SM, ST} | listing `NSE:SYMBOL`; isin; type EQUITY |
| BSE bhavcopy | `FinInstrmTp = STK` | listing `BSE:TckrSymb` with `providerCode = FinInstrmId`; isin |
| `nasdaqlisted.txt` | `Test Issue = N` | `NASDAQ:Symbol`; ETF flag → type |
| `otherlisted.txt` | `Test Issue = N`, Exchange ∈ {N, A, P, Z} | N→NYSE, A→NYSE_AMERICAN, P→NYSE_ARCA, Z→CBOE (others, e.g. IEX, skipped and counted) |

- Merge NSE + BSE by ISIN → one instrument with up to two listings; name preference NSE → BSE. US instruments have no ISIN in the source (`isin = null`, `id = <EXCHANGE>:<SYMBOL>`).
- Name cleanup: collapse whitespace, strip tabs/newlines, US names drop trailing share-class boilerplate ("Common Stock", "Class A Ordinary Shares" kept as suffix only when needed to disambiguate).
- **Sanity check** vs previous meta counts: each market within ±20 % and total ≥ 10,000, else abort without writing.
- Output TSV sorted by `id` (deterministic → stable sha256 when sources are unchanged).

**Search** (`searchInstruments(index, query, { market?, limit = 20 })`): query normalised (uppercase, trim, strip `.NS/.BO`); candidates ranked:
1. exact symbol on any listing, 2. symbol prefix, 3. name word-prefix (every query token prefixes a name word), 4. name substring.
Ties broken by: listing on NSE/NASDAQ/NYSE before others, then shorter name. Index built once after load: arrays of symbols and tokenised names; a 20k linear scan per keystroke is < 10 ms, so no trie is needed. Results are debounced 150 ms in the UI.

### 2.11 Test plan for this section

| Area | Key cases |
|---|---|
| Holdings | single buy; multiple buys same broker; same stock across brokers; platform filter recomputes avg/pnl from matching buys only; missing snapshot → nulls not zeros; sector weight with mixed currencies |
| XIRR | known reference values (spreadsheet XIRR parity to 1e-6); all-negative flows → null; < 365 days → null; convergence fallback to bisection; 100-iteration cap |
| Benchmark | buy on a holiday uses previous close; index history gap → null excess |
| Indicators | parity with `technicalindicators` on fixtures; min-bar thresholds return null; split day uses adjClose (no fake crash in SMA) |
| Analysis | every threshold boundary (exactly 15 % ROE = AVERAGE); FINANCIALS skips D/E; < 50 % data → null label; one empty group |
| Rules | whitelist rejection (unknown var, `eval`-like op, depth 11, 101 nodes, nested array outside `in`); scope errors; null var → INSUFFICIENT_DATA; crossover read-back; dry-run matches |
| CSV | every error/warning code with a fixture file; aliases; BOM; `;` delimiter; 2,001 rows → error; row numbers = file lines; all-or-nothing |
| Instruments | build from the dev snapshot: counts match README (2,605 / 5,048 / 13,306 → ≈ 18.5k merged); sanity check aborts on −30 %; TSV round-trip; search ranking examples (`relia` → RELIANCE first, `INFY.NS` → INFY, `apple` → AAPL) |

### 2.12 Review decisions (2026-10-16)
1. Valuation ratios (`pe`, `pb`, `netMargin`) use absolute thresholds in v1; sector-relative scoring later: approved.
2. Stock splits are handled in a later release (SPLIT transactions); v1 shows a "possible split" hint only: approved.
3. Non-ISO CSV dates produce an error with a suggested fix, never auto-converted: approved.
4. Rule read-back is rendered deterministically by code from the validated AST: approved.
5. CSV error references (file name, line, row preview) exist only in the error sheet; nothing about files or lines is persisted.

### 2.13 Implementation notes (M1, 2026-10-16)
Small refinements made while implementing; behaviour matches the sections above unless noted.
1. **P/B absolute fallback** — the framework defines P/B only relative to a sector median. v1 uses `good < 1.5`, `bad > 3` (1.5–3 average), in `THRESHOLDS.pb`. **Approved by user 2026-10-16.**
2. **Buy date "not in the future"** is checked only on write (`newBuyTransactionSchema(today)`); stored documents are read with format + ≥ 1990 checks only, so a wrong device clock never hides existing buys.
3. **Sector groups** (`groupBySector(holdings, fx, currency)`) report value / P&L / weight in the summary currency; holdings stay native (D25).
4. **`AnalysisInput.market`** added (needed for India-only promoter holding and VIX relevance).
5. **Percentage differences** are rounded to 6 dp before threshold comparison, so float noise (102/100 − 1) cannot cross a band edge.
6. **CSV**: extra error code `CSV_TOO_LONG` (name > 120 / platform > 40 chars). Row line numbers are real file lines, including blank lines and multi-line quoted fields.
7. **Instrument master** from the 2026-10-15 snapshot: 18,108 instruments (NSE 2,605 · BSE 5,048 · overlap 2,423 · US 12,878). US rows skipped: 37 test issues, 17 IEX-only, 374 symbols outside the symbol format (mostly preferreds like `AHT$D`). The BSE bhavcopy has no industry column, so `industry` is always null in v1. TSV ≈ 1.31 MB → 2 chunks.
8. **Prompt tasks** are split into `SinglePromptTask` (deep analysis, rule compile, market sentiment) and `BatchPromptTask` (ratings, signals) with per-item `validate` so the client retries only rejected items. Grounding allows integers 0–10 and indicator/index constants (14, 50, 200, 500 …). `<` in the DATA block is escaped as `<` so user text cannot close the block.
9. **Rule compile**: scope problems are returned as `scopeIssues` (shown to the user) rather than retried, since the model cannot fix them.

---

## 3. Services (`apps/mobile/src/services/`, `tools/instrument-sync/`)

Traceability: HLD §3, §5, §6, §10, §11, §15, D3, D7, D10, D11, D16, D17, D26, D29; `ANALYSIS_FRAMEWORK.md` §4.1, §6, §7; rules `.claude/rules/project/firebase-ai.md`.

Services do **all I/O** and nothing else: they fetch, validate (zod), cache and hand plain data to `core`. They never compute scores or P/L. Screens and stores reach them only through the interfaces below (ports live in `core/ports.ts`, so tests use fakes).

### 3.1 Layout & ports

```
apps/mobile/src/services/
  http/          httpClient.ts (timeout, retry, rate limit), errors.ts
  cache/         kv.ts (MMKV wrapper + zod-validated get/set), keys.ts
  market-data/   provider.ts (port), yahoo/, twelvedata/, finnhub/, quotepage/ (scrape, D33), symbols.ts, marketDataService.ts
  fx/            frankfurter.ts, fxService.ts
  ai/            firebaseAi.ts (SDK wrapper), aiClient.ts (retry/validate/budget), aiService.ts (4 tasks), usage.ts
  instruments/   instrumentSyncService.ts, instrumentIndex.ts
  firestore/     §1.10 repositories + converters.ts
  auth/          authService.ts
  refresh/       refreshService.ts (daily pipeline, §3.8)
```

```ts
// core/ports.ts (additions to §1.10)
export interface Clock { now(): EpochMs }
export interface KeyValueCache {
  get<T>(key: string, schema: z.ZodType<T>): T | null;     // invalid/old-shape value → deleted, returns null
  set<T>(key: string, value: T): void;
  delete(key: string): void;
  keys(prefix: string): string[];
}
export interface MarketDataProvider {
  readonly id: 'yahoo' | 'twelvedata' | 'finnhub' | 'quotepage';
  supports(cap: Capability, exchange: Exchange): boolean;   // Capability = 'BARS' | 'LATEST_CLOSE' | 'FUNDAMENTALS' | 'PROFILE'
  getDailyBars?(req: BarsRequest): Promise<BarsResult>;
  getLatestClose?(ref: InstrumentRef): Promise<{ close: number; sessionDate: IsoDate; currency: Currency }>;
  getFundamentals?(key: InstrumentRef): Promise<Fundamentals>;
  getProfile?(key: InstrumentRef): Promise<InstrumentProfile>;
}
export type InstrumentRef = { key: InstrumentKey; symbol: string; exchange: Exchange; bseCode: string | null; type: 'EQUITY' | 'ETF' | 'INDEX' };
export type BarsRequest = { ref: InstrumentRef; range: { kind: '1y' } | { kind: 'from'; from: IsoDate } };
export type BarsResult = { bars: DailyBar[]; currency: Currency | null; adjusted: boolean; provider: string };
```

`InstrumentRef` is built from the master list (`bseCode` comes from `Listing.providerCode`). Index/macro symbols (`^NSEI`, `^GSPC`, `^INDIAVIX`, `^VIX`) use pseudo-keys `INDEX:NIFTY50`, `INDEX:SP500`, `INDEX:INDIAVIX`, `INDEX:VIX` inside services only (never persisted in Firestore).

### 3.2 HTTP client (`http/`)

One `httpGetJson(url, schema, opts)` / `httpGetText(url, opts)` used by every market-data and FX adapter:

| Concern | Behaviour |
|---|---|
| Timeout | `AbortController`, default **10 s** per request. |
| Retries | ≤ 2 retries on network error, timeout, 5xx; backoff 500 ms → 1.5 s (+ jitter). **No retry** on 4xx (404 = not found, 401/403 = key/blocked, 429 = rate limited). |
| Rate limit | Per-host token bucket + concurrency cap (table below). Requests queue; nothing is dropped silently. |
| Circuit breaker | 3 consecutive failures for a host within one refresh → host marked `down` for the rest of that refresh (avoids 100 sequential timeouts); next refresh starts fresh. |
| Validation | Response parsed with the adapter's zod schema; failure → `ServiceError('BAD_RESPONSE')`, never passed on. |
| Logging | Dev builds: URL (API keys redacted), status, duration. Release: counts only. |

| Host | Concurrency | Rate |
|---|---|---|
| Yahoo (`query1/query2.finance.yahoo.com`) | 4 | ≤ 5 req/s |
| Twelve Data | 1 | ≤ 8 req/min, ≤ 800/day (counter in MMKV) |
| Finnhub | 2 | ≤ 50 req/min |
| Frankfurter | 2 | no stated limit; ≤ 2 req/s |
| Quote page (scrape) | 1 | ≤ 1 req/s, ≤ 100 per refresh |

```ts
export type ServiceErrorCode =
  | 'NETWORK' | 'TIMEOUT' | 'RATE_LIMITED' | 'NOT_FOUND' | 'AUTH' | 'BAD_RESPONSE'
  | 'PROVIDER_DOWN' | 'CURRENCY_MISMATCH' | 'UNSUPPORTED';
export class ServiceError extends Error { code: ServiceErrorCode; provider: string; retryable: boolean; }
```
(§5 consolidates these with Firestore/AI/auth codes into the app-wide taxonomy and user messages.)

### 3.3 Market data (`market-data/`)

**Provider symbols** (`symbols.ts`, the only place they are produced):

| Exchange | Yahoo | Twelve Data | Finnhub | Quote page (Google Finance) |
|---|---|---|---|---|
| NSE | `RELIANCE.NS` | `symbol=RELIANCE&exchange=NSE` | — (not used) | `RELIANCE:NSE` |
| BSE | `500325.BO` (numeric code from master); `RELIANCE.BO` if code missing | `symbol=RELIANCE&exchange=BSE` | — | `500325:BOM` |
| US (all five) | `BRK-B` (`.` → `-`) | `BRK.B` | `BRK.B` | `BRK.B:NYSE` (NASDAQ, NYSE, NYSEARCA, NYSEAMERICAN, BATS) |
| Indices | `^NSEI`, `^GSPC`, `^INDIAVIX`, `^VIX` | — | — | — |

**Capabilities and fallback chain** (first provider that `supports()` and succeeds wins):

| Capability | Chain | Cache (MMKV, §1.9) | Refetch when |
|---|---|---|---|
| Daily bars (1 y) | Yahoo chart → Twelve Data → cached (stale) | `market.bars.<key>` | cached `sessionDate` < expected session, or force |
| Latest close (last resort, D33) | quote-page scrape, only when bars are stale and the market is closed | stored on the snapshot (`priceSource: 'SCRAPE'`) | as bars |
| Index history (benchmark) | Yahoo chart (`period1` = earliest buy − 7 d) | `market.index.<NIFTY50\|SP500>` | earliest buy moves earlier, else extended from the daily 1 y fetch |
| Fundamentals | Yahoo quoteSummary → Finnhub (US only) → cached → `null` | `market.fundamentals.<key>` | older than 7 days |
| Profile (sector/industry) | Yahoo assetProfile → Finnhub profile (US only) → master `industry` (BSE) → `null` | `market.profile.<key>` | older than 30 days |

**Yahoo chart** — `GET /v8/finance/chart/{sym}?range=1y&interval=1d&events=div%2Csplits&includeAdjustedClose=true` (or `period1/period2` for index history). No cookie or crumb needed.
- zod schema covers `chart.result[0].meta { currency, exchangeTimezoneName, instrumentType }`, `timestamp[]`, `indicators.quote[0] { open, high, low, close, volume }` (entries nullable), `indicators.adjclose[0].adjclose[]`; `chart.error` non-null → `NOT_FOUND`/`BAD_RESPONSE`.
- Timestamps → exchange-local `IsoDate` using `exchangeTimezoneName`. Rows with any null price are dropped; duplicate dates keep the last row.
- **In-progress session dropped:** a bar dated after `sessionDateFor(market, now)` (i.e. today before the close) is removed, so a cached snapshot is always a completed session.
- `meta.currency` must equal `EXCHANGE_META[exchange].currency` (INR/USD), else `CURRENCY_MISMATCH` (guards against wrong listings such as GBp quotes).
- The full year is re-fetched each new session (≈ 15–20 KB per stock) rather than appended, because `adjClose` history is rewritten after every dividend or split.

**Yahoo quoteSummary (fundamentals + profile)** — `GET /v10/finance/quoteSummary/{sym}?modules=financialData,defaultKeyStatistics,summaryDetail,assetProfile&crumb=…`. Needs a session cookie + crumb: `GET https://fc.yahoo.com` (sets cookie; non-2xx is expected) → `GET /v1/test/getcrumb` → crumb cached in memory for the app session; on 401 refresh once. **Best effort:** any failure falls through the chain; nothing breaks if Yahoo removes this endpoint (fundamentals become ⚪ "insufficient data"). Spike S1 (§3.11) confirms RN's cookie handling works before implementation.

`Fundamentals` (`core/market/fundamentals.ts`; consumed by §2.7). All fields `number | null`; percentages as **percent** (15 = 15 %):

| Field | Yahoo source (conversion) | Finnhub `metric` source |
|---|---|---|
| `pe` | `summaryDetail.trailingPE` | `peTTM` |
| `pb` | `defaultKeyStatistics.priceToBook` | `pb` |
| `peg` | `defaultKeyStatistics.pegRatio`; else `pe / epsGrowthPct` when growth > 0 | same derivation |
| `roePct` | `financialData.returnOnEquity` × 100 | `roeTTM` |
| `roce`, `interestCoverage`, `promoterHoldingPct`, `pledgePct` | not available → `null` | `netInterestCoverageTTM` for interest cover; others `null` |
| `de` | `financialData.debtToEquity` ÷ 100 (Yahoo reports percent) | `totalDebt/totalEquityQuarterly` |
| `currentRatio` | `financialData.currentRatio` | `currentRatioQuarterly` |
| `revenueGrowthPct`, `epsGrowthPct` | `financialData.revenueGrowth`/`earningsGrowth` × 100 (YoY) | `revenueGrowth3Y`/`epsGrowth3Y` (3-yr CAGR), else `…TTMYoy` |
| `netMarginPct` | `financialData.profitMargins` × 100 | `netProfitMarginTTM` |
| `fcf` | `financialData.freeCashflow` (TTM; trend unknown → `trend: null`) | `null` |
| `dividendYieldPct` | `summaryDetail.dividendYield` × 100 | `dividendYieldIndicatedAnnual` |

Plus `growthBasis: 'CAGR3Y' | 'YOY'`, `asOf: IsoDate`, `provider`. Exact Finnhub field names are pinned from a recorded fixture during implementation; the mapping lives in one file per provider. FCF with unknown trend is classified as "positive, flat" (AVERAGE) by §2.7, never GOOD.

`InstrumentProfile = { sector: string | null; industry: string | null }`. ETFs get sector `"ETF"` from the master `type` without a network call.

**Twelve Data (fallback bars only)** — `GET /time_series?symbol=…&exchange=…&interval=1day&outputsize=260&apikey=…`. Numbers arrive as strings (zod `coerce`). No adjusted close: `adjClose = close`, `adjusted: false` (indicators then show a split as a price jump; acceptable for a fallback, flagged in the report). Free-plan coverage of NSE/BSE is **unverified** (spike S3); if India isn't covered, `supports('BARS', 'NSE'|'BSE')` returns false and Indian stocks fall back straight to the cached snapshot. Fallback use is capped at **16 instruments per refresh** (holdings first, then watchlist) because of the 8/min limit; the rest stay stale.

**Quote-page scrape (last-resort latest close, HLD D33)** — `GET https://www.google.com/finance/quote/{SYM}:{EXCH}` (browser User-Agent), price read from one documented attribute/selector in `quotepage/parse.ts`; parsed value must be a positive number in the expected currency, else `BAD_RESPONSE`.
- Used **only** for instruments whose bars are still stale after Yahoo and Twelve Data, and **only while the market is closed** (after the session close, before the next open), so the scraped price is that session's close, never an intraday price (v1 = daily closes).
- It updates `close`, `prevClose` (= last cached bar's close), value, P/L and day change. **Indicators, Health and rules stay on the cached bars**; the snapshot carries `priceSource: 'SCRAPE'` and `indicatorsAsOf`, and the card shows "price from web · indicators as of 14 Oct".
- Fragile by nature (page changes) and against some sites' terms: isolated in one adapter, with a recorded HTML fixture test that fails loudly when the page changes. Disabled for public builds (`FEATURES.scrapeFallback`, on for personal builds).

**Finnhub (US fundamentals + profile only)** — `/stock/metric?symbol=…&metric=all`, `/stock/profile2?symbol=…` (`finnhubIndustry` → sector). Its candle endpoint is not on the free plan, so it is never used for bars.

**API keys:** `EXPO_PUBLIC_TWELVEDATA_KEY`, `EXPO_PUBLIC_FINNHUB_KEY` in `apps/mobile/.env.local` (git-ignored). They are **public in the bundle** (acceptable for personal use, HLD §6); missing key → that provider reports `supports() = false`. Before a public release these move behind a Cloud Function proxy.

**`MarketDataService`** (what the refresh pipeline calls):
```ts
interface MarketDataService {
  getSnapshots(refs: InstrumentRef[], opts: { force: boolean; onProgress?: (done: number, total: number) => void }):
    Promise<{ snapshots: Map<InstrumentKey, MarketSnapshot & { stale: boolean; provider: string; priceSource: 'BARS' | 'SCRAPE'; indicatorsAsOf: IsoDate }>; failures: Failure[] }>;
  getIndexHistory(index: 'NIFTY50' | 'SP500', from: IsoDate): Promise<DailyBar[]>;
  getFundamentals(refs: InstrumentRef[]): Promise<Map<InstrumentKey, Fundamentals | null>>;
  getProfiles(refs: InstrumentRef[]): Promise<Map<InstrumentKey, InstrumentProfile>>;
  getMacro(opts: { force: boolean }): Promise<MacroSnapshot>;   // NIFTY50, SP500 (1 y for trend), INDIAVIX, VIX
}
```
- Order: holdings first, then watchlist-only instruments, so the portfolio renders first.
- `stale = true` when the returned snapshot's `sessionDate` (of its close price) is older than the expected session for its market (provider down, or a holiday — the data's own date is shown either way: "as of 14 Oct").
- `NOT_FOUND` from every provider → `failure.code = 'NOT_FOUND'`; the holding shows "No price data" and the "not in latest exchange list" hint if the master list also lacks it (HLD §15). Never deleted.
- Budget: 100 instruments + 4 macro symbols ≈ 104 chart calls at ≤ 5/s with 4 in flight → **~10–15 s** cold, well inside the 30 s NFR. Fundamentals/profile calls are spread over the week by their TTLs (~15/day on average).

**Cached shapes** (columnar to keep MMKV small; ~15 KB per instrument):
```ts
type CachedBars = { v: 1; key: string; provider: string; currency: Currency; adjusted: boolean;
  sessionDate: IsoDate; fetchedAt: EpochMs;
  d: IsoDate[]; o: number[]; h: number[]; l: number[]; c: number[]; a: number[]; vol: number[] };
type CachedIndexHistory = { v: 1; index: 'NIFTY50' | 'SP500'; from: IsoDate; d: IsoDate[]; a: number[] };
type CachedFundamentals = { v: 1; key: string; fetchedAt: EpochMs; data: Fundamentals | null };   // null cached too (no re-hammering)
type CachedProfile = { v: 1; key: string; fetchedAt: EpochMs; profile: InstrumentProfile };
```
Every cached value has a zod schema; a value that fails parsing (old shape) is deleted and refetched.

**Benchmark note (HLD D33):** `^NSEI` and `^GSPC` are **price** indices; bonuses and dividends are not considered on either side (the stock's return also ignores dividends in v1). The Research screen labels it "Nifty 50 / S&P 500 (price index)".

### 3.4 FX (`fx/`)

Frankfurter (ECB reference rates, no key), base URL `https://api.frankfurter.dev/v1`:

| Call | Request | Use |
|---|---|---|
| Latest | `/latest?base=USD&symbols=INR` | summary conversion, `fx.usdInr` + `asOf` |
| History | `/{from}..{to}?base=USD&symbols=INR` | portfolio-level XIRR (§2.3): each buy converted at its trade-date rate |

- History is fetched **once** from the earliest buy date (minus 7 days) and then only extended forward (past ECB rates never change). If a new buy predates `from`, the missing range is fetched and merged.
- Lookup = nearest **earlier** available date (ECB publishes on TARGET business days only; gaps are normal, and long ranges may come back at lower granularity). ECB INR rates start in 1999; an earlier buy uses the first available rate and the summary marks XIRR "approximate".
- Fallback for latest: Yahoo chart `USDINR=X` (last close). If both fail: last cached rate with its `asOf` shown.
- Cache: `fx.usdInr` → `{ v: 1; latest: { rate: number; asOf: IsoDate }; history: { from: IsoDate; d: IsoDate[]; r: number[] }; fetchedAt }`. Latest refreshed once per IN session.

### 3.5 Gemini (`ai/`)

**SDK wrapper** (`firebaseAi.ts`, the only file importing `@react-native-firebase/ai`):
```ts
const ai = getAI(getApp(), { backend: new GoogleAIBackend() });
const model = getGenerativeModel(ai, {
  model: AI_CONFIG.models[task.model],                     // never a literal
  systemInstruction: built.system,
  generationConfig: {
    responseMimeType: 'application/json',
    responseSchema: toSdkSchema(task.responseSchema),        // plain JSON-schema subset from core → SDK Schema
    temperature: AI_CONFIG.temperature[task.id],
    maxOutputTokens: AI_CONFIG.maxOutputTokens[task.id],
    // thinkingConfig per task if supported by the SDK (spike S2)
  },
});
```
It exposes one port to the rest of the app: `GenerativePort.generate({ task, built, signal }) → { text, finishReason, usage }`.

**Prompt builders** (`core/prompts/`, pure, no SDK types):
```ts
export type PromptTask<I, O> = {
  id: 'performanceRating' | 'signals' | 'deepAnalysis' | 'ruleCompile' | 'marketSentiment';
  version: string;                        // e.g. 'perf-rating@1' — bumped on any wording change; recorded with results
  model: 'flash' | 'flashLite';
  build(input: I): { system: string; user: string; allowedNumbers: number[] };
  responseSchema: JsonSchemaSubset;       // object/array/string/number/integer/boolean/enum, no recursion
  outputSchema: z.ZodType<O>;             // stricter than responseSchema (lengths, enums, cross-checks)
  postValidate(input: I, output: O): Result<O, string[]>;   // grounding + set equality checks
};
```
- **Input hygiene:** numbers are rounded to 2 dp before being sent; nulls are sent as `null` with the instruction "null = insufficient data, say so". Only tickers, company names and numbers are sent — no email, display name, broker or quantities (HLD §10 privacy).
- **Untrusted text** (the user's rule sentence) is JSON-encoded inside a delimited block (`<user_rule>…</user_rule>`); the system instruction says content inside the block is data, never instructions.
- **Grounding check** (`prompts/grounding.ts`): every number found in generated prose must match a value in `allowedNumbers` after rounding to 0, 1 or 2 dp (thresholds quoted in the prompt, e.g. 90 days, are included). A stray number fails validation → retry. This enforces "every number must come from the input payload".

**The five tasks:**

| Task | When | Input (per item) | Output (zod) & post-checks | Batch / caps |
|---|---|---|---|---|
| `performanceRating` (D11, framework §4.1/§7.1) | daily after refresh; on demand | `symbol, exchange, pnlPct, xirrPct, benchmarkReturnPct, excessReturnPp, holdingDays, healthScore, healthLabel, drawdownPct, volatilityPct` | `{ ratings: [{ symbol, exchange: Exchange, rating: GOOD\|AVERAGE\|BAD, reason ≤ 20 words }] }`; **exactly** the requested set (missing/extra = invalid); grounding on `reason` | ≤ 25 per call, temp 0, 2,048 tokens |
| `signals` (D29, §7.2) — only if effective `aiSuggestions` | daily after refresh; on demand | params (key, value, level), `healthScore`, macro, `pnlPct` (holdings), `targetEntryPrice/ExitPrice` (watchlist) | `{ signals: [{ symbol, exchange, label: STRONG_BUY…SELL, confidencePct 0–100 int, targetEntryPrice?, reason ≤ 25 words }] }`; exact set; `targetEntryPrice` must equal the supplied target or is stripped; insufficient-data stock must be `HOLD`; grounding | ≤ 25 per call, temp 0, 2,048 tokens |
| `deepAnalysis` (§7) | user opens Research (S04) | one stock: `AnalysisResult` params, indicators, fundamentals, macro, performance metrics if held | `{ summary ≤ 80 words, pros: [{ paramKey, text }] ≤ 5, cons ≤ 5, risks ≤ 3, watchFor ≤ 3, alternatives? ≤ 3 }`; `pros[].paramKey` ∈ GOOD params, `cons[].paramKey` ∈ BAD params; `alternatives` dropped unless flag on, and each must exist in the master list (else that entry is dropped); grounding | 1 per call, temp 0.3, 1,024 tokens |
| `ruleCompile` (§2.8) | user taps Compile in S08a | sentence + catalogue generated from `RULE_VARIABLES` (key, type, label, allowed values, scopes) + allowed ops + 4 worked examples | `{ status: 'OK', logicJson: string, suggestedName ≤ 60 } \| { status: 'UNSUPPORTED', reason ≤ 30 words }` (e.g. intraday "4H"). `logicJson` → `JSON.parse` → `validateRuleLogic`; issues are fed back on retry ("unknown variable `peRatio`; use one of …") | 1 per call, temp 0, 512 tokens |

| `marketSentiment` (S07 market card) | daily after refresh (once both markets' macro is loaded); on demand with the S07 refresh | deterministic macro only: India VIX + level, CBOE VIX + level, Nifty 50 / S&P 500 vs SMA-200 (% and regime), USD/INR + day change | `{ headline ≤ 8 words, paragraph ≤ 50 words }`; grounding on both; no buy/sell or allocation instructions (prompt rule + banned-phrase check: "buy", "sell", "allocate", "stop-loss"); the Calm/Elevated/Fear level shown on the card stays deterministic (framework §6) | 1 per call, temp 0.3, 256 tokens |

`logicJson` is a string because Gemini's response schema can't express recursive JSON-Logic; the whitelist validator, not the schema, is the gate.

**`AiClient.run(task, input, { force })`** — the bounded loop around the port:
1. **Budget check** (`usage.ts`): ≤ `AI_CONFIG.rateLimit.rpm` (default 5) requests/min and ≤ `AI_CONFIG.rateLimit.dailyCap` (default 500) per local day, counted in MMKV `ai.usage.<YYYY-MM-DD>`. Over budget → `AI_BUDGET_EXCEEDED` (UI: "AI limit reached for today"), no call.
2. Call with `AI_CONFIG.requestTimeoutMs` (20 s).
3. Parse JSON → `outputSchema` → `postValidate`.
4. **Retry** (max `AI_CONFIG.maxRetries` = 2, i.e. ≤ 3 attempts) on: invalid JSON, schema/post-check failure, `MAX_TOKENS` truncation, timeout, 5xx. For batches, a retry asks only for the **missing/invalid items**. Backoff 1 s, 3 s.
5. **No retry** on: 429 (`AI_RATE_LIMITED`), `SAFETY`/blocked (`AI_BLOCKED`), 400 (`AI_BAD_REQUEST`, a bug), 403 (`AI_NOT_AUTHORISED`: AI Logic not enabled, or App Check rejected once enabled).
6. After the last attempt, items still invalid → `null` ⇒ UI shows ⚪ "Not rated" / "No signal". Never a default value.
7. Release builds log only task id, version, attempts, token usage and error code; never prompts or responses.

**Caching** (D26). Entries carry their own session date because IN and US sessions differ:
```ts
type AiEntry<T> = { sessionDate: IsoDate; inputHash: string; model: string; promptVersion: string; createdAt: EpochMs; value: T };
// MMKV
'ai.performance'               → Record<InstrumentKey, AiEntry<{ rating: Label; reason: string }>>
'ai.signals'                   → Record<InstrumentKey, AiEntry<Signal>>
'ai.analysis.<InstrumentKey>'  → AiEntry<DeepAnalysis>
'ai.marketSentiment'           → AiEntry<{ headline: string; paragraph: string }>   // sessionDate = later of IN/US sessions; inputHash over the macro input
```
- An entry is **fresh** when `sessionDate == sessionDateFor(market)` **and** `inputHash` matches the current input (FNV-1a over the canonical rounded input, computed in `core`).
- **Portfolio updates** (add/edit/remove a buy, CSV import, Undo import) change only the affected stocks' inputs, so **only those stocks** are re-rated (one small batch, ≤ 25 per call); everything else is served from cache.
- **Daily:** after each refresh, stale/missing entries are batched and sent (≈ 4 calls for 100 holdings).
- **On demand** (refresh button on S02/S07/S04): `force: true` re-runs all items of that screen, still subject to the budget.
- Entries older than 3 sessions are pruned on launch. (Replaces the per-date `ai.*` keys listed in §1.9; same data, keyed per instrument.)

**App Check:** not used in personal builds (HLD D32). The AI and Firestore services take no App Check dependency; for a Play release, `@react-native-firebase/app-check` (Play Integrity) is initialised at startup and enforcement is switched on in the console for Firestore and AI Logic. Nothing else changes.

**Proposed `AI_CONFIG` additions** (`src/config/ai.ts`): `rateLimit: { rpm: 5, dailyCap: 500 }`, `signalBatchSize: 25`, `maxOutputTokens.marketSentiment: 256`, `temperature.marketSentiment: 0.3`, and `model` per task (`flash` for all in v1; `flashLite` can be tried for ratings later by changing config only).

### 3.6 Instrument master: sync script & device sync

**Dev script** (`tools/instrument-sync/`, Node 24 + `tsx`, its own workspace; uses `@portfolio/core` `buildInstrumentMaster`):

| Command | Does |
|---|---|
| `npm run sync -- build --snapshot data/instruments/snapshot-2026-10-15` | parse the four raw files → TSV + meta in `tools/instrument-sync/out/` (git-ignored); prints counts and sanity-check result |
| `npm run sync -- upload --dry-run` | compare with live meta (version, counts ±20 %), print what would be written |
| `npm run sync -- upload` | write `chunks/{version}-{i}` → meta → delete older-version chunks |
| `npm run sync -- download --out data/instruments/snapshot-<date>` | optional: fetch fresh NSE/BSE/Nasdaq Trader files into a new snapshot folder (same URLs the later Cloud Function will use) |

- **Chunking:** split at line boundaries so each chunk's **UTF-8 byte** length ≤ 900,000 (Firestore doc limit is 1 MiB). ≈ 2 chunks today.
- `version = <max source date>.<n>`; `sha256` over the concatenated chunk texts in order.
- **Credentials:** Firebase Admin SDK with **Application Default Credentials** from the developer's own login (`gcloud auth application-default login`, quota project `my-portfolio-2d6c0`). No service-account key file is created or stored. The script passes `projectId` explicitly and refuses to run if ADC is missing (message: run the login command). Admin SDK bypasses security rules, so this is the only writer of `reference/**`.
- Cost: ~3 writes + ~2 deletes per upload; free.
- **Later (Blaze):** the same `download → build → upload` code moves into a scheduled Cloud Function (weekly); the script stays for manual runs.

**Device sync** (`InstrumentSyncService.ensureFresh()`, called on launch, non-blocking):
1. If `instruments.lastCheckAt` < 24 h ago and a local copy exists → done.
2. `getMeta()` (1 read). Same `version` as local → update `lastCheckAt`, done.
3. `getChunks(meta)` (≈ 2 reads, from server) → sort by `index` → all `version`s must equal `meta.version` → concatenate → `sha256` (`expo-crypto`) must equal `meta.sha256`.
4. Write `instruments.tsv.next` → swap to `instruments.tsv` + `instruments.meta` → rebuild the in-memory `InstrumentIndex` (`core.parseInstrumentTsv`, ≈ 50–100 ms for 18.5k rows).
5. Any failure → keep the previous copy, retry next launch. No local copy at all → search shows "Downloading stock list…" (HLD §15).

`instrumentIndex.ts` holds the parsed index as a module singleton, loaded from MMKV at startup and exposed to search, CSV import (`CsvDeps`) and `InstrumentRef` construction.

### 3.7 Firestore repositories & auth

**SDK:** `@react-native-firebase/firestore` (modular API). Offline persistence is on by default on Android (cache 100 MB default).

| Concern | Implementation |
|---|---|
| Converters (`converters.ts`) | One per collection: Firestore `Timestamp` → epoch ms, add `id`, `Schema.safeParse`. An invalid document is **skipped and counted** (`{ items, skipped }`), logged in dev, and surfaced as "1 record couldn't be read" — never a crash. |
| Writes | Input validated with the `New…` zod schema (without timestamps) → `createdAt/updatedAt = serverTimestamp()`. |
| Batches | ≤ 500 ops per `writeBatch`, committed sequentially; multi-batch operations (rename platform, delete account, undo import) are idempotent so a retry after partial failure is safe. |
| `deleteByImportBatch` | `where('importBatchId', '==', id)` (automatic single-field index) → batched deletes. |
| `renamePlatform` | Firestore can't query case-insensitively → filter the in-memory transaction list → batched updates. |
| Reads | Default source (server, cache when offline). Collections are read once per app start (≈ 650 reads, §1.10) and then held in stores; no real-time listeners in v1 except on the profile doc (1 listener, cheap). |
| Offline writes | RNFB write promises resolve only when the server acknowledges. Stores apply changes **optimistically** and show a "Saving… will sync when online" chip if a write is still pending after 3 s; Firestore replays queued writes on reconnect. |
| `createIfMissing` | `runTransaction`: create profile + "My Watchlist" only if the profile doc is absent (needs network; first sign-in is online by definition). |

**`AuthService`** (`@react-native-firebase/auth` + `@react-native-google-signin/google-signin`):
```ts
interface AuthService {
  onAuthStateChanged(cb: (u: AuthUser | null) => void): Unsubscribe;
  signInWithGoogle(): Promise<AuthUser>;                   // webClientId from EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID (public OAuth client ID)
  signUpWithEmail(name: string, email: string, password: string): Promise<AuthUser>;   // sends verification email
  signInWithEmail(email: string, password: string): Promise<AuthUser>;
  sendVerificationEmail(): Promise<void>;
  reloadUser(): Promise<AuthUser>;                         // "I've verified" → checks emailVerified
  sendPasswordReset(email: string): Promise<void>;
  reauthenticate(): Promise<void>;                         // before delete account
  deleteCurrentUser(): Promise<void>;
  signOut(): Promise<void>;                                // + cleanup per §1.12
}
type AuthUser = { uid: string; email: string; displayName: string | null; emailVerified: boolean; provider: 'google' | 'password' };
```
Password policy (≥ 8 chars, 1 number, 1 symbol) is checked in the form **and** configured in Firebase Auth's password policy. Firebase error codes map to friendly messages in §5.

### 3.8 Refresh pipeline (`refresh/refreshService.ts`)

The single orchestrator behind app open and pull-to-refresh. Stores (§4) call it and render progress.

```
refresh({ force }):
  0. show cached data immediately (snapshots, AI entries) — cold render < 1 s
  1. instruments.ensureFresh()                                   (parallel, non-blocking)
  2. refs = holdings ∪ watchlist items ∪ macro indices
  3. market.getSnapshots(refs, { force, onProgress })            holdings first
  4. fx.latest(); fx.history(earliestBuyDate)                    parallel with 3
  5. market.getIndexHistory(NIFTY50/SP500, earliest buy per market)
  6. market.getFundamentals / getProfiles for expired entries    after 3, low priority
  7. core: indicators → analysis → holdings/summary → benchmark  → stores (UI updates)
  8. rules: evaluate enabled rules → ruleRepo.saveResults(today) (only if inputs changed)
  9. AI: performance ratings for stale entries; signals if aiSuggestions (holdings + watchlist)
 10. return RefreshReport { fetched, fromCache, stale[], failed[{ key, code }], aiCalls, durationMs }
```
- Only one refresh runs at a time (a second call joins the running one).
- Without `force`, step 3 skips instruments whose cached session is current, so reopening the app the same evening costs no network calls.
- Steps 8–9 never block the portfolio from rendering; their results stream into the stores.
- The ruleResults write is skipped when nothing changed since the last evaluation for that session (saves writes on repeated opens).

### 3.9 Dependencies introduced by this section

| Package | Where | Notes |
|---|---|---|
| `@react-native-firebase/app`, `auth`, `firestore`, `ai`, `crashlytics` (`app-check` at Play release) | mobile (`npx expo install`) | config plugins; requires a **development build** (Expo Go no longer usable from here on) |
| `@react-native-google-signin/google-signin` | mobile | Google sign-in; needs SHA-1/SHA-256 of the dev build registered in Firebase |
| `react-native-mmkv` (+ its Nitro peer if required by the installed major) | mobile | encrypted cache |
| `expo-secure-store`, `expo-crypto` | mobile | MMKV key, sha256 |
| `zod`, `papaparse`, `technicalindicators`, `json-logic-engine` | core | §2 |
| `firebase-admin`, `tsx` | `tools/instrument-sync` | dev only |
| `@firebase/rules-unit-testing` | root dev | rules tests (§1.13) |

Exact versions are pinned by `npx expo install` / the lockfile at implementation time.

### 3.10 Test plan for this section

| Area | Tool | Key cases |
|---|---|---|
| HTTP client | Jest + fake timers + mocked `fetch` | timeout aborts; 5xx retried twice then fails; 404/429 not retried; token bucket spacing; circuit breaker opens after 3 failures |
| Yahoo adapter | Jest with **recorded fixtures** (no live calls in tests) | NSE/BSE/US/index responses parse; null rows dropped; in-progress bar dropped before close, kept after; currency mismatch rejected; `chart.error` → NOT_FOUND; BSE numeric code used; `BRK.B` → `BRK-B` |
| quoteSummary | fixtures | unit conversions (D/E ÷ 100, ROE × 100); missing modules → nulls; crumb refresh on 401 once |
| Twelve Data / Finnhub | fixtures | string numbers coerced; `adjusted: false`; missing key → `supports() = false`; fallback cap of 16 |
| Quote-page scrape | recorded HTML fixtures | price parsed for NSE/BSE/US pages; changed page → BAD_RESPONSE (test fails loudly); not used while the market is open; updates price/P&L only, `indicatorsAsOf` kept |
| Market service | fakes for providers + in-memory KV | fallback chain order; stale flag; cache hit skips network; force refetches; holdings fetched before watchlist |
| FX | fixtures | nearest-earlier lookup over gaps; history extension merges without duplicates; Yahoo fallback |
| Prompt builders | Jest snapshot | each task's prompt is stable; user rule text appears only inside the delimited block; no email/platform/quantity in any prompt |
| Grounding & post-validation | Jest | invented number rejected; rounded variants accepted; missing/extra batch items rejected; `targetEntryPrice` mismatch stripped; non-HOLD for insufficient data rejected; alternative not in master list dropped |
| AiClient | fake `GenerativePort` | retry only missing items; stops at 3 attempts → nulls; 429/SAFETY not retried; budget blocks the 501st call of the day; cache freshness by session + input hash; force bypasses cache |
| Instrument sync | Jest on a small fixture snapshot | chunk byte limit respected with multi-byte names; sha256 matches; meta written after chunks (call order); sanity abort leaves nothing written; device sync rejects hash mismatch and keeps old copy |
| Repositories | emulator (§1.13) | plus: invalid doc skipped and counted; batch idempotency on retry |

### 3.11 Spikes before implementation (≤ ½ day each, results recorded here)

| # | Question | If it fails |
|---|---|---|
| S1 | Does the Yahoo cookie + crumb flow work from RN on Android (cookie jar)? | Fundamentals from Finnhub (US) only; Indian fundamentals ⚪ until a source is found |
| S2 | `@react-native-firebase/ai` with `gemini-3.5-flash`: structured output, `thinkingConfig` support, and whether thinking tokens count toward `maxOutputTokens` | Raise token caps or set minimal thinking per task in `AI_CONFIG` |
| S3 | Twelve Data free plan: are NSE/BSE daily series included? | India fallback = cached snapshot only |

### 3.12 Review decisions (2026-10-16)
1. Fallback: Yahoo → Twelve Data → scraped latest close from a public quote page (market closed only; price/P&L only) → cached snapshot (HLD D33).
2. Benchmark uses price indices; bonuses and dividends are not considered (HLD D33).
3. App Check is not used in personal builds; added with Play Integrity for a Play release (HLD D32).
4. Gemini budget: ≤ 5 requests/min, ≤ 500 requests/day (`AI_CONFIG.rateLimit`).
5. Portfolio updates re-rate only the affected stocks; the refresh button re-rates everything (D26).
6. AI cache is one map per task keyed by instrument with per-entry session date; §1.9 amended.
7. Sync script credentials: Application Default Credentials via the user's `gcloud` login; no service-account key.
8. ANALYSIS_FRAMEWORK §7.1 now uses the full `Exchange` enum.

---

## 4. App: Navigation, State & Screen → Data Mapping (`apps/mobile/src/`)

Traceability: HLD §3, §4, §7, §8, §14, §16, D12, D19, D20, D22, D23, D25, D26, D28, D29, D31; `docs/ui/README.md` (screen IDs S01–S09).

Principles: routes are **thin** (layout + wiring); features own components and hooks; stores hold state and call services (§3); every number on screen comes from a `core` function, never from inline arithmetic in a component. Stitch screens are layout references; the deviations needed to match the HLD are listed in 4.9.

### 4.1 Route tree (Expo Router, `src/app/`)

```
src/app/
  _layout.tsx                    Root: providers (theme, fonts, query of stores), AppGate (4.2), <Stack>
  (auth)/
    _layout.tsx                  Stack, no header
    login.tsx                    S01   (Forgot password = sheet inside the screen)
    sign-up.tsx                  S01a
    verify-email.tsx             S01b  (not in Stitch; same style)
  (app)/
    _layout.tsx                  Stack: tabs + pushed screens + sheets
    (tabs)/
      _layout.tsx                Tabs: Portfolio · Watchlist · Rules · Research
      portfolio.tsx              S02
      watchlist.tsx              S07
      rules.tsx                  S08
      research/
        _layout.tsx              Stack inside the Research tab
        index.tsx                S04 empty state: search + recently viewed
        [key].tsx                S04 for one instrument (key = encodeURIComponent("NSE:RELIANCE"))
    holding/[key]/edit.tsx       S02c Edit buys grouped by broker (not in Stitch; same style)
    settings/
      index.tsx                  S09
      platforms.tsx              Manage platforms (rename / delete unused)
      legal/[doc].tsx            privacy | disclaimer (static text)
    sheets/                      presentation: 'formSheet' (native sheet, detents)
      filter.tsx                 S02a
      holding-actions.tsx        S02b   (?key=)
      add-buy.tsx                S06    (?key=&txId= for edit, ?platform= prefill)
      csv-result.tsx             S05    error sheet / duplicate review
      watchlist-pick.tsx         add instrument to one or more watchlists
      watchlist-edit.tsx         create / rename / delete a watchlist
      create-rule.tsx            S08a   (?ruleId= for edit)
      remove-holding.tsx         S02b → Remove confirmation (lists brokers and quantities)
      delete-account.tsx         S09 → Delete account confirmation
```

- **Sheets as routes** (`presentation: 'formSheet'`, `sheetAllowedDetents`) instead of a bottom-sheet library: no extra dependency, back button closes them, and they receive params. If Android formSheet behaviour proves unreliable in the spike build, swap to `@gorhom/bottom-sheet` inside the same route files.
- **The + button** on S02 is a floating speed-dial component (not a route): **Add stock** → `sheets/add-buy`; **Upload CSV** → `expo-document-picker` → parse → toast or `sheets/csv-result`. On S07 the + opens search → `watchlist-pick`; on S08 it opens `create-rule`.
- **Deep Research from Portfolio/Watchlist** navigates to `/(tabs)/research/[key]`, switching to the Research tab with its own back stack.
- Header gear (S02/S07) → `settings`; avatar → `settings`.

### 4.2 App gate (root `_layout.tsx`)

`sessionStore.gate` drives `Stack.Protected` groups:

| Gate state | Condition | Shows |
|---|---|---|
| `booting` | fonts, MMKV key, auth state, cached data loading | splash (kept until ready, ≤ 1 s typical) |
| `signedOut` | no Firebase user | `(auth)` |
| `unverified` | password user with `emailVerified = false` | `verify-email` (resend, "I've verified" → `reloadUser`) |
| `locked` | biometric lock on and lock condition met | full-screen lock → `expo-local-authentication`; fallback to device PIN; "Sign out" link |
| `ready` | profile loaded/created (`createIfMissing`) | `(app)` |

**Biometric lock condition:** cold start, or returning to foreground after **≥ `LOCK_AFTER_BACKGROUND_MS`** (default 5 minutes, in `src/config/app.ts`) in background (`AppState`). Stored in MMKV `device.biometricLock` (per device, §1.9).

**Startup sequence when `ready`:** load cached snapshots/AI entries/instrument index from MMKV → render → load Firestore collections (profile listener, transactions, watchlists + items, rules, today's results) → `refreshService.refresh({ force: false })` (§3.8).

**Foreground trigger:** on `AppState` → active, if the expected session date of either market is newer than the cached one, run `refresh({ force: false })`. No background tasks in v1.

### 4.3 Stores (Zustand, `src/stores/`)

One store per domain; actions call services and update state; components use selector hooks with shallow equality. No store imports another store's internals; cross-store needs go through selector hooks in features.

| Store | State | Actions (→ service) |
|---|---|---|
| `sessionStore` | `gate`, `authUser`, `profile`, `effectiveAiSuggestions` (= profile setting ∧ `FEATURES.aiSuggestions`) | `signIn…`, `signUp`, `verify`, `signOut` (cleanup §1.12), `updateSettings`, `setSummaryCurrency`, `deleteAccount` |
| `portfolioStore` | `transactions: BuyTransaction[]`, `loadState`, `pendingWrites: number`, `lastImport` | `load`, `addBuy`, `updateBuy`, `deleteBuys`, `removeHolding(key)`, `removeFromBroker(key, platform)`, `importCsv(result)`, `undoLastImport` — all optimistic (§3.7) |
| `watchlistStore` | `watchlists`, `itemsByList: Record<id, WatchlistItem[]>`, `activeListId` | `create`, `rename`, `delete`, `addItem(listIds[], ref)`, `updateItem`, `removeItem`, `setActive` |
| `rulesStore` | `rules`, `todayResults`, `dryRun: { state, readBack, matches, insufficient, issues }` | `compile(text, scopes)` (→ AI), `dryRun`, `save`, `toggle`, `delete`, `evaluateAll` (called by refresh) |
| `marketStore` | `snapshots`, `fundamentals`, `profiles`, `macro`, `fx`, `indexHistory`, `refresh: { running, progress, report, lastAt }` | `refresh({ force })` → `refreshService` |
| `analysisStore` | `byKey: Map<InstrumentKey, { indicators, analysis }>` (derived, not persisted) | `recompute(keys)` — pure `core` calls after snapshots/fundamentals change |
| `aiStore` | `performance`, `signals`, `analysis` maps, `marketSentiment` (from MMKV), `status` per task, `budgetLeftToday` | `ratePerformance(keys, { force })`, `generateSignals(keys, { force })`, `deepAnalysis(key, { force })`, `marketSentiment({ force })` |
| `instrumentStore` | `status: 'missing' \| 'downloading' \| 'ready' \| 'error'`, `meta` | `ensureFresh`, `search(query, market?)` (sync, core), `resolve(key)` |
| `uiStore` | `portfolioFilters`, `collapsedSectors`, `watchlistFilters` (market, signal), `rulesFilter` | setters; persisted to MMKV `ui.*` |

**Derived views (selector hooks in `features/*/hooks`, memoised):**
```ts
usePricingContext()   // marketStore + aiStore labels + analysisStore health + sector resolution → core PricingContext
usePortfolioView()    // aggregateHoldings(tx, ctx, filters) → groupBySector → summarisePortfolio(summaryCurrency)
useHolding(key)       // single StockHolding incl. brokers[] (unfiltered) for S02b/S02c/S04
useWatchlistView(id)  // items + snapshot + analysis + signal → WatchlistRow[] filtered/sorted
useRuleSummary()      // counts, today's triggered keys, per-rule last triggered
```
Recomputation is cheap (≤ 500 transactions, ≤ 150 instruments) and memoised on the input references.

### 4.4 Screen → data mapping

**S02 Portfolio** (`usePortfolioView`)

| UI element | Source |
|---|---|
| Net portfolio worth + $/₹ toggle | `summary.totalValue` in `profile.settings.summaryCurrency`; toggle writes the setting (same as S09) |
| "1 USD ≈ ₹83.42 · ECB · 15 Oct" | `fx.usdInr`, `fx.asOf` |
| US / India cards (value, weight %, CAGR) | `summary.markets[]` (`value` native, `weightPct`, `xirrPct` labelled **CAGR**; "—" when null with "< 1 yr" hint) |
| 1-day P/L, total unrealised P/L, overall CAGR | `summary.dayChange/Pct`, `unrealisedPnl/Pct`, `xirrPct` |
| Allocation bar | `summary.markets[].weightPct` |
| "Platforms · 4" + Filters button (dot when active) | distinct platforms in transactions; `uiStore.portfolioFilters` non-empty |
| Holdings (N assets) + sort button | `holdings.length`; sort cycles `VALUE_DESC → DAY_PNL_PCT_DESC → PNL_PCT_DESC` |
| Sector header (collapsible) | `SectorGroup` value, pnl, pnlPct, weightPct, count; collapse state in `uiStore` |
| Stock card | `StockHolding`: symbol tile, name, market badge, broker ("Zerodha" or "Zerodha +1"), qty, avg, close, day change %, invested, value, total return (pnl, pnlPct), CAGR (`xirrPct`) |
| Badges + reason | `performance` label (⚪ "Not rated" when null) + `health` label; reason line = AI performance reason (hidden when not rated) |
| Stale / scraped hints | snapshot `stale` → "as of 14 Oct"; `priceSource = 'SCRAPE'` → "price from web" |
| Empty state | no transactions → "Add your first stock" + "Upload CSV" |
| Pull to refresh | `marketStore.refresh({ force: false })` |

**S02a Filter sheet:** markets (with counts), exchanges (present ones only), sectors (multi-select with weight % and member names), **Performance** chips GOOD/AVERAGE/BAD/Not rated, **Health** chips GOOD/AVERAGE/BAD/Insufficient, platforms (with holding counts), sort. Live "N of M matched" from `aggregateHoldings` with the draft filters. Apply → `uiStore`; Reset clears.

**S02b Holding actions sheet** (`useHolding(key)`): header (symbol, name); **View deep research & rules** → `research/[key]`; **Edit buys** → `holding/[key]/edit`; **Remove from portfolio** → `remove-holding` with **Delete all records** selected and **Keep history** disabled ("Coming later").

**S02c Edit buys** (`useHolding(key).brokers`): per broker header (platform, quantity, avg price, invested) + its buys (date, qty, price; tap → `add-buy?txId=`; swipe/⋮ delete); "Remove from <broker>" (confirm) → `removeFromBroker`; "Add buy" → `add-buy?key=`.

**S04 Research** (`research/[key]`)

| UI element | Source |
|---|---|
| Search bar | `instrumentStore.search` (debounce 150 ms, top 20, market filter) |
| Header: symbol, exchange badge, name · sector; ★ (add to watchlist → `watchlist-pick`) | master list + `sectorOf(key)` |
| Price card: close, day change, "Close · 15 Oct" | snapshot; not held/watched instruments are fetched on open (one chart call, cached) |
| 3-month line chart | last ~63 `adjClose` bars (react-native-svg path) |
| Day range, 52W range | last bar high/low; `indicators.high52w/low52w` |
| Tab **AI Verdict** | `aiStore.analysis[key]` (summary, pros/cons with param keys, risks, watch-for); header chip "Health 72 · Good" and, if `effectiveAiSuggestions`, signal label + "AI confidence 84%"; refresh icon → `deepAnalysis(key, { force: true })` |
| Tab **Fundamentals** | `analysis.params` group FUNDAMENTAL: value, level colour, reason; ⚪ for null |
| Tab **Technicals** | `analysis.params` group TECHNICAL + macro block (VIX, index trend) |
| Tab **Rules** | enabled rules whose scope covers this instrument, with today's result (Match / No match / Insufficient data) |
| "Your position" (held only) | `useHolding`: qty, avg, invested, value, P/L, CAGR, benchmark return, excess (pp), holding days, Performance label + full reason |
| Similar alternatives (flag on) | `analysis.alternatives`: symbol, name, reason; tap → `research/[key]` |
| Disclaimer footer | static, always |

**S06 Add / edit buy** (`add-buy`)

| Field | Behaviour |
|---|---|
| Market toggle US / India | narrows search; sets currency symbol |
| Ticker search | `instrumentStore.search`; selecting shows name, sector, last close + day change (fetched on select if not cached) |
| Price | numeric; **Use close** button fills last close |
| Quantity | integer for India (keyboard + validation), up to 4 decimals for US |
| Date | date picker, 1990-01-01 … today |
| Platform | dropdown from `profile.platforms` + "Add new…" |
| Summary | outlay = qty × price (native), est. weight (summary currency), unrealised gain at close; FX note with ECB rate |
| Submit | zod-validated → `addBuy` / `updateBuy`; likely duplicate → inline non-blocking warning (D31) |

**S05 CSV flow** — success: toast "45 buys imported" (+ "3 look like duplicates · Review") with **Undo** for 10 s; Undo also in Settings → Data for 7 days. Failure: `csv-result` sheet listing issues (file · line · row preview · message · suggested fix), sorted by line, with a "Copy issues" button. Review: duplicates grouped, each linking to Edit buys.

**S07 Watchlist** (`useWatchlistView(activeListId)`)

| UI element | Source |
|---|---|
| "Signals as of 15 Oct · 16:05" + refresh | newest `aiStore.signals` entry time; refresh → `generateSignals(listKeys, { force: true })` |
| Search bar | instrument search → `watchlist-pick` |
| Watchlist chips (name, count, ✎) | `watchlistStore`; ✎ → `watchlist-edit`; "+ New list" chip |
| Market chips: All / US / India | `uiStore.watchlistFilters.market` |
| Market context card | AI headline + paragraph (`aiStore.marketSentiment`, hidden if unavailable) above the deterministic figures: India VIX, CBOE VIX (Calm/Elevated/Fear, framework §6), Nifty/S&P vs SMA-200, USD/INR; "Analysed 15 Oct" |
| Signal chips with counts: All / Strong buy / Buy / Hold / Trim / Sell | `aiStore.signals` (hidden when AI suggestions off) |
| Row | symbol, market + exchange badge, name, close, day change, 3-month sparkline, signal label + "AI conf. 88%" (or Health label when AI off), target entry/exit if set, reason (1 line, AI) |
| Row tap | `research/[key]`; long-press/⋮ → edit targets/notes, move/copy to list, remove |

**S08 Rules hub** (`useRuleSummary`): stat tiles (active / paused counts; triggered today + symbols; cadence "Daily close · checked when the app refreshes"); chips All / Portfolio / Watchlist / Paused; rule card = enabled toggle, **read-back** text (variables highlighted), scope tags, "Triggered today (NVDA, INFY)" / "Last checked 15 Oct" / "Insufficient data for 2"; Edit → `create-rule?ruleId=`; delete (confirm).

**S08a Create rule sheet:**
1. Text box (≤ 500 chars) + example chips (pre-written sentences, e.g. "Oversold dip", "Breakout volume", "Low debt + yield").
2. Scope toggles: Apply to Portfolio, Apply to Watchlists (all lists, D28). Cadence row is display-only "Daily market close".
3. **Run dry test** = compile (AI) → validate → read-back → dry run. Shows the read-back ("This rule will match when: …"), matches and insufficient-data stocks, or the issues/UNSUPPORTED reason.
4. Name field (prefilled from `suggestedName`, editable).
5. **Save** is enabled only after a successful dry test of the current text and scopes; saving stores the read-back the user saw (§2.8). Editing the text invalidates the dry test.

**S09 Settings**

| Row | Source / action |
|---|---|
| Account: name, email, provider badge | `authUser`, `profile` |
| Change password (email accounts only) | sends reset email to the account address |
| Portfolio summary currency | `settings.summaryCurrency` |
| Sort holdings by default | `settings.defaultSort` |
| Biometric app lock | MMKV `device.biometricLock`; enabling requires one successful biometric prompt |
| AI suggestions & buy/sell signals | `settings.aiSuggestions` (hidden when build flag off) |
| Refresh AI ratings now · "Last rated today 16:05" | `ratePerformance(all, { force: true })` + signals if on |
| Stock list · "18,512 stocks · updated 15 Oct 2026" · Check for update | `instrumentStore.meta`; check ignores the 24 h throttle |
| Market data · "Prices as of 15 Oct close" · Refresh | `marketStore.refresh({ force: true })` |
| Undo last import (shown for 7 days) | `portfolioStore.undoLastImport` |
| Platforms → | `settings/platforms` (rename = batched rewrite, §1.4; delete only when unused) |
| Clear local cache · size | wipes `market.*`, `fx.*`, `ai.*` (keeps instruments, `device.*`, `ui.*`); next refresh refetches |
| App version | `expo-constants` (version + build) |
| Privacy policy, Disclaimer | `settings/legal/[doc]` |
| Sign out / Delete account | §1.12 flows; delete via `delete-account` sheet (type "DELETE" to confirm) |

### 4.5 Shared UI building blocks (`src/components/`, `src/theme/`)

- **Theme tokens** (`theme/tokens.ts`) generated by hand from `obsidian_capital/DESIGN.md`: colours (surface ramp, primary `#46fc8b`, error, tertiary), spacing, radii, typography scale. **Inter** via `expo-font` (bundled); numbers use tabular figures. **Dark theme only in v1** (the design system is dark).
- **Label colours:** GOOD = primary green, AVERAGE = tertiary amber, BAD = error red, null = outline grey with "Not rated" / "Insufficient data". Signal labels: STRONG_BUY/BUY green, HOLD amber, TRIM/SELL red. Colour is never the only cue (text always present).
- **Components:** `MoneyText` (native currency, sign, colour by sign), `PctText`, `LabelBadge`, `SignalBadge`, `MarketBadge`, `ExchangeBadge`, `SymbolTile`, `Sparkline` (svg), `RangeBar`, `StatTile`, `SectionHeader`, `Chip`, `Toast`, `StaleBanner`, `OfflineBanner`, `Disclaimer`, `EmptyState`, `SpeedDialFab`.
- **Formatting** (`lib/format.ts`, the only place numbers become text): INR `en-IN` grouping (₹49,04,360.00), USD `en-US` ($92,144.68); 2 decimals for money and %, sign for changes; dates "15 Oct" / "15 Oct 2026"; `null` → "—". Uses `Intl` (Hermes).
- **Accessibility:** touch targets ≥ 44 dp, `accessibilityLabel` on icon buttons and badges ("Performance: Good"), font scaling allowed (layouts wrap, no fixed-height text rows).

### 4.6 Loading, empty, error and offline states

| Situation | Behaviour |
|---|---|
| First launch, no cache | skeleton cards while Firestore + first refresh run; refresh progress "Fetching prices 34/100" |
| Refresh running with cache | cached data shown, thin progress bar under the header |
| Stale snapshot | per-card "as of" date; header banner if > 50 % of holdings are stale |
| Offline | `@react-native-community/netinfo` → banner "Offline · showing data as of 15 Oct"; writes queue (pending chip), AI/compile buttons disabled with reason |
| AI unavailable / budget exceeded | ⚪ badges; toast once per session "AI limit reached for today" |
| AI suggestions off | signal chips, labels, confidence and alternatives hidden everywhere; Health label used instead |
| Instrument list missing | search shows "Downloading stock list…"; CSV upload waits for it (needed for validation) |
| Firestore doc skipped (invalid) | one-time toast "1 record couldn't be read" (§3.7) |
| Errors | mapped to friendly messages via the §5 taxonomy; never raw codes |

### 4.7 Dependencies introduced by this section

`zustand`, `react-native-svg`, `@react-native-community/netinfo`, `expo-local-authentication`, `expo-document-picker`, `expo-font` + Inter font files, `expo-constants`, `@react-native-community/datetimepicker`. All via `npx expo install` (versions pinned at implementation time).

### 4.8 Test plan for this section

| Area | Tool | Key cases |
|---|---|---|
| Selector hooks | Jest (`jest-expo`) | `usePortfolioView` with filters/currency toggle matches `core` fixtures; memoisation (same inputs → same reference) |
| Stores | Jest with fake services | optimistic add + rollback on failure; undo import; pending-write counter; effective `aiSuggestions` when build flag off |
| App gate | Jest + RNTL | each gate state renders the right group; unverified user can't reach `(app)`; lock after 5 min background, not after 4 |
| Screens | RNTL | S02 empty / loaded / stale / not-rated states; S02a live count; S06 integer-only India quantity; S08a Save disabled until dry test passes and re-disabled on text edit; S09 hides AI row when build flag off |
| Formatting | Jest | INR lakh grouping, USD, negative values, null → "—" |
| Manual (device) | checklist | biometric prompt, file picker, formSheet sheets, offline banner, font scaling at 130 % |

### 4.9 Deviations from the Stitch designs (to match HLD/v1 scope)

| Screen | Stitch shows | Built as | Reason |
|---|---|---|---|
| S02 cards | "Moderate (64/100)", "Health: Stable" | "Performance: Good/Average/Bad" + "Health: …" labels only | D22 labels only |
| S02 | "CAGR" | "CAGR" kept; value is money-weighted XIRR (ⓘ explains) | D30; label kept by user decision |
| S02 | "Live Mid-Market" FX | "ECB · 15 Oct" | daily ECB rate with date |
| S02 | "Platforms · 4 Synced" | "Platforms · 4" | no broker sync in v1 |
| S02a | score-band chips | Performance / Health label chips | D22 |
| S02b | "Keep history" selected | "Delete all records" selected; Keep history disabled | D20 |
| S04 | intraday chart, "At close 4:00 PM EST", News tab, bell icon | 3-month daily line, "Close · 15 Oct", **Rules** tab instead of News, no bell | daily closes; news later (D15) |
| S04 | "Score 92 · Strong Buy" | "Health 72 · Good" + signal chip when flag on | Health is deterministic; signal separate (D29) |
| S04 alternatives | score + price per alternative | symbol, name, reason | avoids extra fetches; tap opens full research |
| S06 | "LIVE QUOTE", FIFO note | "Last close", no FIFO text | daily closes; no lot accounting |
| S07 | AI sentiment narrative card | AI headline + paragraph (grounded, no advice wording) over deterministic VIX/index/FX figures | user decision; level colour stays deterministic |
| S07 | "Buy dip", "Hold/Trim", "on 4H" | exact labels STRONG_BUY…SELL; daily only | §7.2 enum; daily closes |
| S08 | "Next: 4:00 PM" | "Checked when the app refreshes after close" | no background jobs in v1 (alerts v1.1) |
| S09 | "quotes & vectors" | "market data & AI results" | accurate copy |

### 4.10 Review decisions (2026-10-16)
1. Keep the label **CAGR** for the money-weighted (XIRR) annualised return; an ⓘ explains it.
2. Rules are evaluated on app refresh in v1; the hub says so. Scheduled checks come with v1.1 notifications.
3. Biometric lock on app open and after `LOCK_AFTER_BACKGROUND_MS` (default 5 min) in background.
4. Dark theme only in v1.
5. Watchlist market card: AI-written headline + paragraph (new `marketSentiment` task, §3.5) above deterministic figures; can be revisited later.
6. Undesigned secondary screens are built in the Obsidian style without Stitch mock-ups; adjusted later if needed.

---

## 5. Error Taxonomy, Test Plan & Delivery Order

Traceability: HLD §10 (NFRs), §11; all previous LLD sections; `.claude/rules/generic/workflow.md`.

### 5.1 Error model

```ts
// core/errors.ts (pure; services and stores share it)
export type ErrorDomain = 'AUTH' | 'FS' | 'MD' | 'FX' | 'AI' | 'RULE' | 'SYNC' | 'IMPORT' | 'DEVICE' | 'APP';
export class AppError extends Error {
  constructor(
    readonly code: AppErrorCode,          // e.g. 'AUTH_WRONG_PASSWORD'
    readonly options: { cause?: unknown; retryable?: boolean; context?: Record<string, string | number> } = {},
  ) { super(code); }
}
export function toAppError(e: unknown): AppError;   // maps SDK / ServiceError / zod errors; unknown → APP_UNEXPECTED
```

**Rules**
- Services throw `AppError` only (SDK errors are mapped at the service boundary; §3.2 `ServiceError` maps 1:1 into the `MD_*`/`FX_*` codes).
- Stores catch, put `{ code }` into state, and decide retry/rollback. Components never inspect raw errors.
- User text comes only from `messages.ts` (`userMessage(code, context)`); raw codes, stack traces and SDK messages are never shown.
- **Partial failure is normal**: a refresh with 3 failed instruments is a successful refresh with a report, not an error screen.
- `context` never contains email, display name, broker names, prompts or AI output (privacy, HLD §10).
- Each route exports an Expo Router `ErrorBoundary` ("Something went wrong · Try again"); a root boundary catches the rest.

### 5.2 Error catalogue

Severity: **silent** (log only) · **inline** (field/row message) · **toast** · **banner** (persistent until resolved) · **blocking** (screen-level).

| Code | Raised when | User message | Severity | Retry / action |
|---|---|---|---|---|
| `AUTH_WRONG_PASSWORD` | `auth/invalid-credential`, `auth/wrong-password`, `auth/user-not-found` | "Email or password is incorrect." | inline | — (no hint which one) |
| `AUTH_EMAIL_IN_USE` | `auth/email-already-in-use` | "An account with this email already exists. Sign in instead?" | inline | link to S01 |
| `AUTH_WEAK_PASSWORD` | `auth/weak-password`, policy failure | "Use at least 8 characters with a number and a symbol." | inline | — |
| `AUTH_TOO_MANY_ATTEMPTS` | `auth/too-many-requests` | "Too many attempts. Try again in a few minutes." | inline | — |
| `AUTH_NOT_VERIFIED` | password user, `emailVerified = false` | "Verify your email to continue." | blocking (S01b) | resend (60 s cooldown) |
| `AUTH_RECENT_LOGIN` | `auth/requires-recent-login` (delete account) | "Please sign in again to confirm." | inline | re-auth prompt |
| `AUTH_GOOGLE_CANCELLED` | user closed Google picker | — | silent | — |
| `AUTH_GOOGLE_CONFIG` | Google `DEVELOPER_ERROR` (SHA-1 not registered) | "Google sign-in isn't set up for this build." (+ dev hint in dev builds) | inline | register fingerprints |
| `AUTH_NETWORK` | `auth/network-request-failed` | "No connection. Check your internet." | inline | retry |
| `FS_PERMISSION` | `permission-denied` | "You don't have access to this data. Sign in again." | blocking | sign out → S01 |
| `FS_UNAVAILABLE` | `unavailable`, `deadline-exceeded` | "Can't reach the server. Showing saved data." | banner | auto, SDK retries |
| `FS_QUOTA` | `resource-exhausted` (Spark daily limit) | "Daily free database limit reached. Changes will sync tomorrow." | banner | — |
| `FS_INVALID_DOC` | stored doc fails zod (§3.7) | "1 record couldn't be read." | toast (once) | skip doc |
| `FS_WRITE_FAILED` | write rejected after optimistic update | "Couldn't save your change. It has been undone." | toast | rollback |
| `MD_NOT_FOUND` | no provider knows the symbol | "No price data" on the card | inline | — |
| `MD_STALE` | snapshot older than expected session | "as of 14 Oct" on the card; banner if > 50 % stale | inline / banner | next refresh |
| `MD_RATE_LIMITED` / `MD_PROVIDER_DOWN` / `MD_NETWORK` / `MD_TIMEOUT` / `MD_BAD_RESPONSE` | §3.2 | none per item; refresh report "Prices updated for 97 of 100" | toast | fallback chain, then cache |
| `MD_CURRENCY_MISMATCH` | quote currency ≠ exchange currency | "Price data looks wrong for this stock; skipped." | inline | — |
| `FX_UNAVAILABLE` | Frankfurter + Yahoo FX failed | "Using exchange rate from 14 Oct." | inline (summary) | next refresh |
| `AI_BUDGET_EXCEEDED` | client daily/minute cap (§3.5) | "AI limit reached for today." | toast (once/session) | tomorrow |
| `AI_RATE_LIMITED` | 429 | "AI is busy. Try again in a minute." | toast | manual |
| `AI_INVALID_OUTPUT` | validation failed after retries | ⚪ "Not rated" / "No signal" / "Analysis unavailable" | inline | refresh button |
| `AI_BLOCKED` | safety block | "AI couldn't answer this one." | inline | — |
| `AI_NOT_AUTHORISED` | 403 (AI Logic off / App Check later) | "AI features are unavailable." | banner (dev hint) | config |
| `AI_TIMEOUT` / `AI_UNAVAILABLE` | timeout, 5xx after retries | "AI didn't respond. Try again." | inline | refresh button |
| `RULE_UNSUPPORTED` | compile returned UNSUPPORTED (e.g. intraday) | model's reason + "Rules run on daily closes." | inline | edit text |
| `RULE_INVALID` | whitelist validation issues | issue list ("`peRatio` isn't a known value — did you mean P/E?") | inline | edit text |
| `RULE_SCOPE` | scope check (§2.8) | "This rule uses your P/L, so it can't apply to watchlists." | inline | change toggle |
| `RULE_LIMIT` | > 25 rules | "You can have up to 25 rules." | inline | — |
| `IMPORT_INVALID` | CSV has errors (§2.9) | error sheet (S05) | blocking (sheet) | fix file |
| `IMPORT_NO_MASTER` | stock list not downloaded yet | "Stock list is still downloading; try again shortly." | toast | wait |
| `IMPORT_FILE` | unreadable / > 1 MB / not text | "This file can't be read as CSV (max 1 MB)." | toast | — |
| `SYNC_HASH_MISMATCH` / `SYNC_FAILED` | instrument download problems (§3.6) | — (old list kept); Settings shows "Update failed, will retry" | silent / inline | next launch |
| `DEVICE_BIOMETRIC_UNAVAILABLE` | no enrolled biometrics | "Set up a fingerprint or face unlock in Android settings first." | inline (S09) | — |
| `DEVICE_STORAGE` | MMKV / secure store failure | "Local storage error. Cached data was reset." | toast | wipe cache, keep going |
| `LIMIT_WATCHLISTS` / `LIMIT_WATCHLIST_ITEMS` | > 20 lists / > 100 items | "Up to 20 watchlists / 100 stocks per list." | inline | — |
| `APP_OFFLINE` | NetInfo offline | "Offline · showing data as of 15 Oct" | banner | auto |
| `APP_UNEXPECTED` | anything unmapped | "Something went wrong." | toast / boundary | try again |

### 5.3 Logging & diagnostics

- `src/lib/log.ts`: `log.debug/info/warn/error(event, fields)`; dev builds print to Metro; release builds keep a **ring buffer of the last 200 entries in memory** (no network). Settings → About → "Copy diagnostics" copies the buffer (codes, counts, durations; no PII) for debugging.
- **Crash reporting:** Firebase Crashlytics (`@react-native-firebase/crashlytics`, free on Spark), added in M2. Collection **disabled in dev builds**, enabled in release builds. Sends crashes and `recordError` for `APP_UNEXPECTED` / boundary errors with the error code only; no user ID, email, prompts or financial data (`setUserId` is never called). `log.ts` breadcrumbs go to Crashlytics as codes and counts only.
- Never logged: tokens, API keys, email, prompts, AI responses, CSV contents.

### 5.4 Test strategy (consolidated)

| Level | Scope | Tool | Gate |
|---|---|---|---|
| Unit (core) | §2 functions, schemas, prompts, grounding, errors | Jest + ts-jest | **≥ 90 % line coverage** on `packages/core` |
| Service | adapters, http client, AI client, sync, caches | Jest + recorded fixtures + fakes (no live network) | all fixtures parse; retry/fallback cases |
| Security rules | `firebase/firestore.rules` | Firestore emulator + `@firebase/rules-unit-testing` | every case in §1.13 |
| Repository | Firestore repositories | emulator | §1.13 / §3.10 cases |
| Component / screen | stores, hooks, screens | `jest-expo` + RNTL | §4.8 cases |
| Manual device | dev build on the user's phone | checklist per milestone | checklist ticked in the PR |
| Live smoke (manual, optional) | real Yahoo / Frankfurter / Gemini | `npm run smoke` script, never in CI | run before each milestone sign-off |

**Fixtures:** `packages/core/test/fixtures/` (CSV files, bars, reference XIRR values) and `apps/mobile/test/fixtures/` (recorded Yahoo/Twelve Data/Finnhub/Frankfurter/quote-page responses, Gemini outputs incl. invalid ones). Fixtures contain no personal data.

**CI** (`.github/workflows/ci.yml`, GitHub Actions, free for public repos, no secrets): on push/PR to `release1/v1` and `main` → `npm ci` → lint → typecheck → tests (core + mobile, with coverage gate) → rules tests (emulator, Java 21) → Prettier check. Takes ~5 min.

### 5.5 Definition of done (per feature)

1. Covered by an approved LLD section (deviations recorded in the LLD first).
2. Code + tests from that section's test plan; lint, typecheck, tests and Prettier pass locally and in CI.
3. Manual device checklist ticked on a dev build (for UI features).
4. No secrets, no inline prompts, no model names outside `config/ai.ts`.
5. Docs updated if behaviour changed (LLD / CLAUDE.md).

### 5.6 Delivery order (milestones)

Each milestone is small enough to review and ends with something runnable.

| # | Milestone | Contents | Exit criteria |
|---|---|---|---|
| **M0** | Foundations | core deps (zod, papaparse, technicalindicators, json-logic-engine); `models/` + `ports.ts` + `errors.ts`; theme tokens + Inter; CI workflow | §1.13 schema tests pass; CI green |
| **M1** | Core domain | holdings, XIRR, benchmark, indicators, analysis, rules, CSV, instrument build/search, prompt builders + grounding | §2.11 + prompt tests pass; core coverage ≥ 90 % |
| **M2** | Firebase + dev build + auth | RNFB app/auth/firestore/crashlytics, Google sign-in, first **development build** (local Gradle build; EAS optional), SHA fingerprints registered, S01/S01a/S01b, app gate, `createIfMissing`, security rules + emulator tests, **rules deployed** | sign in on phone (Google + email), profile + "My Watchlist" created; rules tests pass |
| **M3** | Instrument master | sync script (`build`, `upload` via gcloud ADC), first upload; device sync + search; MMKV + secure store | 18.5k instruments on phone; search < 50 ms; re-launch costs 1 read |
| **M4** | Portfolio data entry | transactions repo; S06 add/edit buy; S05 CSV import + duplicates + Undo; S02c edit buys; S02b actions + remove | own CSV imports; edits sync; undo works |
| **M5** | Market data + portfolio view | spikes S1/S3; http client, Yahoo bars, FX, caches, refresh pipeline (deterministic steps); S02 + S02a with P/L, CAGR, sectors, summary toggle | portfolio values match broker statements within rounding; cold refresh of own portfolio < 30 s |
| **M6** | Research (deterministic) | fundamentals + profile, analysis store, S04 header/price/tabs/position without AI; Health labels on S02 | Health labels and parameters shown; ⚪ for missing data |
| **M7** | Gemini | spike S2; AI client (budget, retries, grounding, cache); performance ratings; deep analysis; signals; market sentiment | ratings on S02, verdict on S04; budget + cache verified (re-open costs 0 calls) |
| **M8** | Watchlists + Rules | watchlist repo + S07; rule compile/dry run/save S08a; hub S08; evaluation on refresh + results | rule from a sentence matches the expected stocks in a dry run; results survive reinstall |
| **M9** | Settings, resilience, release | S09 incl. platforms, clear cache, delete account; biometric lock; fallbacks (Twelve Data, Finnhub, quote-page scrape); offline polish; diagnostics; **signed release APK** for personal install | full manual checklist on a release build; delete account leaves no data |

Dependencies: M0 → M1 → (M2 ∥ M3 partly) → M4 → M5 → M6 → M7 → M8 → M9. M8's rule compile needs M7's AI client; watchlist CRUD could move earlier if wanted.

**Credentials needed per milestone** (prompted when reached, never pasted in chat): M2 — dev build SHA-1/SHA-256 into Firebase, `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` in `.env.local`; M3 — gcloud ADC (done); M9 — Twelve Data and Finnhub free keys in `.env.local`, release keystore (stored outside the repo) + its SHA fingerprints in Firebase.

**Build environment:** local builds with Android Studio's SDK + **JDK 17** (`JAVA_HOME`, `ANDROID_HOME` set); `npm run android:native` builds and installs the dev client. EAS cloud builds remain an option.

**Branching:** one branch per milestone off `release1/v1` (`feat/m0-foundations`, `feat/m1-core`, …), merged into `release1/v1` by PR after the user's review and green CI. `main` is updated from `release1/v1` only at release points.

### 5.7 Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Yahoo changes/blocks endpoints | no prices / fundamentals | adapter isolation, fallbacks (§3.3), stale cache, fixture tests flag changes fast |
| Gemini free-tier limits or model changes | AI features degrade | config-driven model, budget, caching, ⚪ fallbacks; app fully usable without AI |
| Expo SDK 57 / RNFB / MMKV version incompatibility | build failures | pin via `npx expo install`; dev build in M2 de-risks early; `npm run doctor` in CI |
| Firestore Spark quota | writes blocked for the day | read budget ≤ ~650 per cold start; no listeners on collections; `FS_QUOTA` banner |
| Scraped fallback breaks | last-resort fallback lost | isolated, optional (`FEATURES.scrapeFallback`), fixture test |

### 5.8 Review decisions (2026-10-16)
1. Firebase Crashlytics in v1 (release builds only, codes and stack traces, no personal data).
2. GitHub Actions CI added in M0.
3. One branch per milestone, merged into `release1/v1` by PR after review.
4. Milestone order unchanged.
5. Local builds (Android Studio installed; JDK 17 to be installed/configured); EAS optional.
6. Coverage gate ≥ 90 % on `packages/core`; screen tests cover the main features, no hard gate on the app.
