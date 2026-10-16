# Project Context

- **Name:** Portfolio & Watchlist Analyzer
- **Description:** Android-first personal app to consolidate stock holdings across brokers (NSE/BSE + US), show P/L in INR & USD grouped by sector, run deterministic technical/fundamental scoring with Gemini-written explanations, and evaluate natural-language watchlist rules on daily closes.
- **Audience:** Personal use now; may ship to Play Store later — keep public-release concerns (feature flags, disclaimers) in place from day one; App Check (debug provider) protects AI Logic in every build (HLD D35).
- **Current phase:** HLD v1.3 and LLD v1 approved (2026-10-16) → implementation, milestone by milestone (LLD §5.6, M0 first). No feature code outside an approved LLD section.
- **Branches:** `main` = clean/stable; `release1/v1` = v1 integration branch; one branch per milestone (`feat/m0-foundations`, …) merged into `release1/v1` by PR after review.

# Tech Stack

- **Language:** TypeScript (strict) everywhere. Node.js LTS (v22+). npm workspaces monorepo.
- **Mobile:** Expo (managed workflow + development builds, Expo Router), React Native.
- **State / cache:** Zustand; `react-native-mmkv` (encrypted) for local cache.
- **Backend (BaaS):** Firebase — Auth, Cloud Firestore, App Check (debug provider, AI Logic); Remote Config later. Spark (free) plan in v1.
- **AI:** Gemini Flash via Firebase AI Logic (`@react-native-firebase/ai`, Gemini Developer API). Model name lives in `apps/mobile/src/config/ai.ts`, never at call sites.
- **Market data:** Pluggable `MarketDataProvider` adapters (primary: Yahoo Finance chart/quote endpoints; fallbacks per `docs/HLD.md` §6). FX via Frankfurter (ECB).
- **Domain logic:** `technicalindicators`, `json-logic-engine`, `zod`, `papaparse` — inside `packages/core` (pure TS, no RN/Firebase imports).
- **Testing:** Jest (`jest-expo` for the app, `ts-jest` for core), `@testing-library/react-native`, Firebase Emulator Suite for security rules.
- **Deferred (v1.1):** Firebase Cloud Functions + Cloud Scheduler + FCM for push alerts (requires Blaze plan).

# Docs

- **HLD:** `docs/HLD.md` (source of truth for scope & architecture)
- **LLD:** `docs/LLD.md` (v1 complete; §5.6 = delivery milestones, §5.2 = error catalogue)
- **Analysis framework:** `docs/ANALYSIS_FRAMEWORK.md` (parameters, thresholds, scoring, R/G/Y)
- **UI reference:** `docs/ui/` — Google Stitch exports kept as downloaded (`docs/ui/screens/<stitch_folder>/screen.png` + `code.html`), design system in `docs/ui/screens/obsidian_capital/DESIGN.md`, folder → screen-ID map in `docs/ui/README.md`. Read the screen's PNG (and HTML for exact values) before building or changing it; translate the HTML to React Native, never copy it in.

# Project Structure

```
apps/mobile/              Expo app
  AGENTS.md               Expo's own agent guidance (versioned docs, expo install, CNG) — read before touching Expo APIs
  src/app/                Expo Router routes (thin screens only)
  src/features/           portfolio | watchlist | rules | analysis | settings (components + hooks)
  src/services/           firestore/ (repositories), market-data/ (adapters), ai/ (Gemini client), fx/
  src/stores/             Zustand stores
  src/config/             ai.ts (model names, limits), features.ts (feature flags), env access
packages/core/            Pure TypeScript shared by app (and Cloud Functions in v1.1)
  src/models/             zod schemas + inferred types (Holding, Instrument, Rule, Snapshot…)
  src/csv/                CSV import parsing & validation
  src/indicators/         RSI/SMA/MACD etc. wrappers
  src/analysis/           parameter scoring, R/G/Y classification, pros/cons
  src/rules/              JSON-Logic whitelist validation + evaluation
  src/prompts/            prompt builder functions (no prompts anywhere else)
firebase/                 firestore.rules, firestore.indexes.json, rules tests
tools/instrument-sync/    dev script: NSE/BSE/US ticker lists → Firestore reference/instruments (HLD §15, LLD §3.6); weekly Cloud Function later
.github/workflows/        (planned) scheduled instrument sync
functions/                (v1.1) Cloud Functions — not created yet
docs/                     HLD, LLD, analysis framework, ui/ (Stitch screen designs)
.claude/                  Reusable Claude Code config (see .claude/README.md)
```

# Essential Commands (Windows PowerShell or any shell, run from repo root)

- **Expo SDK:** 57 (React Native 0.86). Add native packages with `npx expo install <pkg>` from `apps/mobile`, never plain `npm install`.
- **Install deps:** `npm install`
- **Start Metro dev server:** `npm run start`
- **Build, install & run on the emulator/phone (dev client; needs Android Studio + JDK 17):** `npm run android` (first build ≈ 30 min, then incremental). Expo Go no longer works (native Firebase modules).
- **Regenerate the native project after app.json/plugin changes or a new google-services.json:** `npx expo prebuild --platform android --clean` (in `apps/mobile`)
- **Emulator:** AVD `Medium_Phone_API_37.0` (Google Play image, needed for Google sign-in)
- **Cloud dev build (no local Android SDK needed):** `npx eas-cli build --profile development --platform android` (run inside `apps/mobile`)
- **Run all tests:** `npm test`
- **Type-check:** `npm run typecheck`
- **Lint:** `npm run lint`
- **Format:** `npm run format`
- **Firestore rules tests (emulator):** `npm run test:rules` — firebase-tools needs Java 21+: set `FIREBASE_JAVA_HOME` (e.g. Android Studio's `jbr`) so Android builds keep JDK 17
- **Firebase emulators:** `firebase emulators:start`
- **Stock list sync (gcloud ADC login needed):** `npm run sync -- download --out data/instruments/snapshot-<YYYY-MM-DD>` → `npm run sync -- build --snapshot data/instruments/snapshot-<YYYY-MM-DD>` → `npm run sync -- upload --dry-run` → `npm run sync -- upload`
- **Expo dependency health:** `npm run doctor`

# Coding Guidelines (details in `.claude/rules/`)

- Strict TypeScript, no `any`; zod schemas at every boundary (CSV, Firestore, market APIs, LLM output).
- `packages/core` must stay pure (no React Native, Firebase, or `fetch`) so it is fully unit-testable and reusable by Cloud Functions.
- All I/O behind service/repository interfaces; UI never calls SDKs directly.
- Derived numbers (CMP value, P/L, %, scores) are computed, not stored.
- TSDoc on all exported functions, types and components.

# Guardrails

- **No secrets in the repo.** `google-services.json`, `.env*`, keystores are git-ignored. Remember `EXPO_PUBLIC_*` vars are public.
- **No inline prompts.** Prompts only in `packages/core/src/prompts/`.
- **No `eval`.** LLM-compiled rules are JSON-Logic validated against a variable/operator whitelist.
- **Bounded AI usage.** Max retries, `maxOutputTokens` caps and per-day caching of AI analysis; no unbounded loops.
- **Not investment advice.** AI stock suggestions sit behind `features.aiSuggestions` (off for public builds); disclaimer on analysis screens.
- **Respect scope.** v1 = daily closes, BUY transactions only (no sells), no push. Don't build v1.1 items early.
