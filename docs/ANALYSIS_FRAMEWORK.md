# Stock Analysis Framework

> Status: **Draft — review thresholds before LLD.** All thresholds are widely used rules of thumb, not guarantees. They live in a single config object in `packages/core/src/analysis/thresholds.ts` so they can be tuned without code changes elsewhere. The output is informational, not investment advice.

## 1. Principles
1. **Deterministic first.** Every parameter is computed and classified by code. Gemini only writes the narrative from those results.
2. **Three-level classification** for each parameter: 🟢 Good (+1), 🟡 Average (0), 🔴 Bad (−1), or ⚪ Insufficient data (excluded from the score, shown to the user).
3. **Context matters.** Valuation ratios are compared against the stock's **sector median** where available; absolute fallbacks are used only when sector data is missing.
4. **Sector exceptions.** Banks/NBFCs/insurers skip leverage and current-ratio checks (debt is their raw material) — see §5.
5. **Pros = all 🟢 parameters, Cons = all 🔴 parameters**, each with a one-line reason generated from a template (e.g. "ROE 22% — strong return on shareholder capital (> 15%)").

## 2. Technical Parameters (from ~1 year of daily closes)

| Key | Parameter | 🟢 Good | 🟡 Average | 🔴 Bad | Why it matters |
|---|---|---|---|---|---|
| `trend200` | Close vs SMA-200 | Close > SMA-200 | within ±2% of SMA-200 | Close < SMA-200 | Long-term trend direction. |
| `cross50_200` | SMA-50 vs SMA-200 | SMA-50 > SMA-200 (golden cross regime) | within ±1% | SMA-50 < SMA-200 (death cross regime) | Medium vs long-term momentum. |
| `rsi14` | RSI (14) | 40–60 (healthy) or 30–40 in an uptrend (pullback) | 60–70 | > 70 (overbought) or < 30 in a downtrend | Momentum / overextension. |
| `macd` | MACD (12,26,9) vs signal | MACD > signal and > 0 | MACD > signal but < 0, or < signal but > 0 | MACD < signal and < 0 | Short-term momentum shift. |
| `range52w` | Position in 52-week range `(close−low)/(high−low)` | 50–90% | 25–50% or > 90% | < 25% | Strength vs extremes. |
| `drawdown` | Drop from 52-week high | < 10% | 10–25% | > 25% | Depth of current correction. |
| `volatility` | Annualised volatility (std of daily returns × √252) | < 25% | 25–40% | > 40% | Risk / position sizing. |
| `volumeTrend` | 20-day avg volume vs 90-day avg (on up-days) | > 1.2× | 0.8–1.2× | < 0.8× | Conviction behind the move. |

Minimum history: SMA-200 needs 200 sessions; with less data those parameters are ⚪.

## 3. Fundamental Parameters

| Key | Parameter | 🟢 Good | 🟡 Average | 🔴 Bad | Notes |
|---|---|---|---|---|---|
| `pe` | P/E (TTM) vs sector median | < 0.8× sector | 0.8–1.2× | > 1.2× sector, or negative earnings | Fallback absolute: < 20 / 20–35 / > 35. |
| `peg` | PEG (P/E ÷ EPS growth %) | < 1 | 1–2 | > 2 or negative | Valuation adjusted for growth. |
| `pb` | Price / Book vs sector median | < 0.8× sector | 0.8–1.5× | > 1.5× | Most useful for financials & asset-heavy sectors. |
| `roe` | Return on Equity | > 15% | 10–15% | < 10% | Capital efficiency. |
| `roce` | Return on Capital Employed | > 15% | 10–15% | < 10% | Skip for financials. Often unavailable on free APIs. |
| `de` | Debt / Equity | < 0.5 | 0.5–1.0 | > 1.0 | Skip for financials. |
| `currentRatio` | Current ratio | > 1.5 | 1.0–1.5 | < 1.0 | Short-term liquidity. Skip for financials. |
| `interestCoverage` | EBIT / Interest | > 5 | 2–5 | < 2 | Ability to service debt. |
| `revenueGrowth` | Revenue growth (3-yr CAGR, fallback YoY) | > 15% | 5–15% | < 5% | Business expansion. |
| `epsGrowth` | EPS growth (3-yr CAGR, fallback YoY) | > 15% | 5–15% | < 5% or negative | Earnings expansion. |
| `netMargin` | Net profit margin vs sector median | > sector | ≈ sector (±20%) | < sector or negative | Fallback absolute: > 15% / 5–15% / < 5%. |
| `fcf` | Free cash flow (TTM) | Positive and growing | Positive, flat/declining | Negative | Earnings quality. |
| `dividendYield` | Dividend yield | Informational only (no score) | — | — | Shown, not scored. |
| `promoterHolding` *(India)* | Promoter holding % / pledge % | Holding > 50%, pledge 0% | Holding 30–50% or pledge < 10% | Pledge > 10% | Usually **not** available from free APIs → ⚪ unless entered manually. |

## 4. Portfolio Badges

### 4.1 Performance badge (per stock — rated by Gemini, HLD D11)
Gemini assigns `GOOD | AVERAGE | BAD`, but only from **inputs computed deterministically by `core`**, so the model judges and never calculates:

| Input (per stock, computed from its individual BUY transactions) | Notes |
|---|---|
| `pnlPct` — absolute return % | From weighted avg buy price and latest close. |
| `xirrPct` — money-weighted annualised return | From each buy's date and amount. Only when the first buy is ≥ 1 year old; otherwise `null`. |
| `benchmarkReturnPct` — Nifty 50 (NSE/BSE) or S&P 500 (US) as if the **same amounts had been invested on the same dates** | Annualised (XIRR) if first buy ≥ 1 year old, absolute otherwise. |
| `excessReturnPp` — return minus benchmark, in percentage points | The single most important input. |
| `holdingDays` (quantity-weighted average age of the buys) | Short holdings (< 90 days) should lean towards AVERAGE: too early to judge. |
| `healthScore` + `healthBadge` | From §4.2. Gives context, not a substitute for return. |
| `drawdownPct`, `volatilityPct` | Risk context. |

**Guidance given to the model** (in the prompt, so ratings stay consistent):
- GOOD ≈ clearly beating the benchmark for the period held; BAD ≈ clearly trailing it, or a large loss; AVERAGE ≈ roughly in line, or too early to judge.
- Must return a ≤ 20-word reason that cites at least one of the supplied numbers.

**Guardrails**
- Batched: up to ~25 holdings per call; temperature 0; response validated with zod (every requested holding present, enum values only).
- Cached per `{symbol, exchange, sessionDate}`. Re-rated on the next daily refresh, not on every screen open.
- On AI failure or invalid output after `maxRetries`: ⚪ "Not rated". Never fall back to a guessed colour.
- The reason text is shown under the badge so the user can see why it was rated that way.

### 4.2 Health badge (per stock, from analysis)
```
technicalScore   = Σ(weight × value) / Σ(weight)    over non-⚪ technical params   → −1 … +1
fundamentalScore = Σ(weight × value) / Σ(weight)    over non-⚪ fundamental params → −1 … +1
health (0–100)   = 50 + 50 × (0.4 × technicalScore + 0.6 × fundamentalScore)
```
| Badge | Health score |
|---|---|
| 🟢 Good | ≥ 65 |
| 🟡 Average | 40 – 64 |
| 🔴 Bad | < 40 |
| ⚪ Insufficient | fewer than 50% of parameters available |

Default weights: all 1.0, except `trend200`, `roe`, `de`, `epsGrowth` = 1.5 (most predictive and most reliably available). The 40/60 technical/fundamental split suits a long-term investor; it is configurable.

## 5. Sector Exceptions
| Sector | Skip | Add / emphasise (when data is available) |
|---|---|---|
| Banks, NBFCs, Insurance | `de`, `currentRatio`, `roce`, `interestCoverage` | `pb`, `roe` (weight 2.0); later: NIM, GNPA, CASA |
| Utilities, Real Estate | — | `de` thresholds relaxed to < 1.0 / 1–2 / > 2 |
| IT / Software, FMCG | — | `pe` sector-relative is essential (structurally high P/E) |

## 6. Macro & Sentiment Context (shown, not scored per stock)
| Indicator | 🟢 Calm | 🟡 Elevated | 🔴 Fear | Applies to |
|---|---|---|---|---|
| India VIX | < 15 | 15–20 | > 20 | NSE/BSE holdings |
| CBOE VIX | < 15 | 15–25 | > 25 | US holdings |
| Index trend (Nifty 50 / S&P 500 vs SMA-200) | Above | ±2% | Below | Market regime |

Macro context is passed to Gemini so the narrative can say, e.g., "fundamentals are strong, but the market regime is risk-off."

The Watchlist market card also shows a Gemini-written **market sentiment** headline (≤ 8 words) and paragraph (≤ 50 words) generated once per day from these figures only (HLD D34). It describes conditions; it never tells the user to buy, sell, allocate or set stop-losses. The Calm/Elevated/Fear levels above stay deterministic.

## 7. AI Narrative Contract (Gemini output, validated by zod)
```
{
  summary: string (≤ 80 words),
  pros: string[] (≤ 5, each must reference a 🟢 parameter key),
  cons: string[] (≤ 5, each must reference a 🔴 parameter key),
  risks: string[] (≤ 3),
  watchFor: string[] (≤ 3, e.g. "RSI back above 40", "next quarterly results"),
  alternatives?: { symbol, exchange, reason }[] (≤ 3; only when features.aiSuggestions = true)
}
```
Rules for the model: use only the numbers supplied; don't predict prices; don't give buy/sell instructions; say "insufficient data" where inputs are ⚪.

### 7.1 Performance rating contract (batched)
```
{
  ratings: {
    symbol: string,
    exchange: Exchange,   // NSE | BSE | NASDAQ | NYSE | NYSE_ARCA | NYSE_AMERICAN | CBOE
    rating: 'GOOD' | 'AVERAGE' | 'BAD',
    reason: string (≤ 20 words, must cite a supplied number)
  }[]   // exactly one entry per requested holding
}
```

### 7.2 Buy/sell signal contract (only when `features.aiSuggestions` = true)
```
{
  signals: {
    symbol: string,
    exchange: Exchange,
    label: 'STRONG_BUY' | 'BUY' | 'HOLD' | 'TRIM' | 'SELL',
    confidencePct: integer 0–100,      // model's self-reported confidence, shown as "AI confidence"
    targetEntryPrice?: number,         // only echoed from the user's watchlist target, never invented
    reason: string (≤ 25 words, must cite at least one supplied number or parameter)
  }[]   // exactly one entry per requested stock
}
```
Rules: inputs are the same computed parameters, Health score and macro context as §4/§6; daily-close data only (no intraday timeframes); a stock with ⚪ insufficient data on most parameters must get `HOLD` with a reason saying data is insufficient. UI shows the label, "AI confidence NN%", the reason, and the disclaimer.

## 8. Rule Studio Variables (whitelist)
Rules may reference only these variables (all computed per instrument by `core`):
- **Price & trend:** `close`, `closePrev`, `sma20`, `sma50`, `sma200`, `sma20Prev`, `sma50Prev`, `sma200Prev`, `high52w`, `low52w`, `drawdownPct`, `changePct` (vs previous close)
- **Momentum & volume:** `rsi14`, `macd`, `macdSignal`, `macdPrev`, `macdSignalPrev`, `volume`, `avgVolume30`, `volatilityPct`
- **Fundamentals:** `pe`, `pb`, `peg`, `roe`, `de`, `revenueGrowthPct`, `epsGrowthPct`, `netMarginPct`, `dividendYieldPct`
- **Scores:** `healthScore`, `healthLabel`, `performanceLabel` (holdings only)
- **Position / watchlist:** `pnlPct` (holdings only), `targetEntryPrice` / `targetExitPrice` (watchlist only)
- **Classification:** `sector`, `market` (`IN` | `US`), `exchange`
- **Macro:** `indiaVix`, `vix`

`*Prev` values are from the previous session, so "crosses above" compiles to e.g. `sma20Prev <= sma50Prev and sma20 > sma50`. Intraday timeframes (e.g. "4H") are rejected in v1 with a message that rules run on daily closes.

Allowed operators: `and`, `or`, `!`, `<`, `<=`, `>`, `>=`, `==`, `!=`, `+`, `-`, `*`, `/`, `var`, `if`, `in` (for `sector in [...]`).
