# Low-Level Design (LLD): Portfolio & Watchlist Analyzer

> Status: **Draft — in progress.** Source of truth: `docs/HLD.md` v1.1 (signed off 2026-10-16). Each section is reviewed and approved before implementation of that area starts.

| § | Section | Status |
|---|---|---|
| 1 | Data models & Firestore schema | **Approved 2026-10-16** |
| 2 | Core domain logic (holdings/XIRR, indicators, scoring, CSV, rules) | Not started |
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
