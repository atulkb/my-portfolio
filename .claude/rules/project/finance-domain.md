---
description: Project-specific domain rules for the Portfolio & Watchlist Analyzer (money, markets, analysis). Replace this folder when reusing .claude/ in another project.
---

# Finance Domain Rules (this project only)

## Instruments & markets

- An instrument is identified by `{ symbol, exchange }` where `exchange ∈ NSE | BSE | NASDAQ | NYSE | NYSE_ARCA | NYSE_AMERICAN | CBOE` — never by display name alone. Provider-specific symbols (e.g. Yahoo `RELIANCE.NS`, `500325.BO`) are produced by the market-data adapter, never stored as the canonical ID.
- Each instrument has a native currency (`INR` for NSE/BSE, `USD` for US). Never add INR and USD amounts without explicit FX conversion. Holdings are always displayed in their native currency; only the portfolio summary converts to the INR/USD toggle.

## Money & numbers

- Prices and amounts are JS `number`s in the instrument's currency; round **only at display time** (2 decimals for currency, 2 for percentages). Never persist rounded derived values.
- Derived values (CMP-based value, P/L, % gain, scores) are **computed**, never stored as source of truth. Only user input (BUY transactions) and dated market snapshots are persisted; holdings, average price and returns are derived from transactions.
- Returns over multiple buys use money-weighted XIRR from each buy's date and amount, never a simple average holding period.
- FX: convert using the snapshot rate with its `asOf` date and show that date in the UI.
- Missing data is `null`, not `0`. Any score/ratio computed from missing inputs must be marked `insufficientData`, never silently treated as good or bad.

## Dates & sessions

- Store dates as ISO `YYYY-MM-DD` (trade dates) or Firestore `Timestamp` (audit fields).
- Analysis uses **daily closes only** (v1). "Latest close" means the last completed session for that exchange (NSE/BSE close 15:30 IST; US close 16:00 ET).

## Analysis & AI

- Indicator maths and parameter scoring are deterministic code in `packages/core` following `docs/ANALYSIS_FRAMEWORK.md` — thresholds live in one config object, not scattered literals.
- The LLM **explains** pre-computed numbers, compiles rules, and assigns the qualitative **Performance rating** (`GOOD | AVERAGE | BAD`) from supplied metrics. It never computes indicators, invents figures, or sets the deterministic Health score. Every number in AI output must come from the input payload.
- If an AI rating is unavailable or invalid, show "Not rated". Never substitute a guessed or default colour.
- Stock "alternatives / suggestions" and buy/sell signal labels with AI confidence are behind the `features.aiSuggestions` flag (on for personal builds, off for public release). Every analysis screen shows the "not investment advice" disclaimer.

## Rules engine

- NL rules compile to JSON-Logic (evaluated with `json-logic-engine`). Validate the AST against a whitelist of operators and variables (`RULE_VARIABLES` in core) before saving; reject anything else. Never `eval`.
