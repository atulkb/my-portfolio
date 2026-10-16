# Low-Level Design (LLD): Portfolio & Watchlist Analyzer

> Status: **Draft — in progress.** Source of truth: `docs/HLD.md` v1.1 (signed off 2026-10-16). Each section is reviewed and approved before implementation of that area starts.

| § | Section | Status |
|---|---|---|
| 1 | Data models & Firestore schema | **Approved 2026-10-16** |
| 2 | Core domain logic (holdings/XIRR, indicators, scoring, CSV, rules) | **Approved 2026-10-16** |
| 3 | Services (market data, FX, Gemini, instrument sync, repositories) | Not started |
| 4 | App: navigation, state, screen → data mapping | Not started |
| 5 | Error taxonomy, test plan, delivery order | Not started |

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
| `market.macro` | indices, VIX, FX snapshot | market-data/fx service | new session |
| `ai.performance.<sessionDate>` | ratings batch result | Gemini service | next session / on-demand refresh (D26) |
| `ai.signals.<sessionDate>` | buy/sell signals | Gemini service | next session / on-demand refresh |
| `ai.analysis.<InstrumentKey>.<sessionDate>` | deep-analysis narrative | Gemini service | next session / on-demand refresh |
| `import.lastBatch` | `{ importBatchId, importedAt, count }` | CSV import | 7 days, or after Undo |
| `ui.*` | last filters, collapsed sectors | UI | — |

Exact shapes of `market.*` and `ai.*` values are specified with their services in §3. Old-session `ai.*` entries are pruned on launch (keep 3 days).

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
