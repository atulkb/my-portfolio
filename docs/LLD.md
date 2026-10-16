# Low-Level Design (LLD): Technical Specifications

> ⚠️ **STALE DRAFT (v0.1).** Superseded by HLD v0.2 (data now nested under `users/{uid}`, holdings one-doc-per-lot, Expo/Zustand/monorepo). Will be regenerated once the HLD is signed off. Do not implement from this file.

## 1. Database Schema (Cloud Firestore)

### Collection: `users`
{
  "uid": "STRING (PK)",
  "email": "STRING",
  "baseCurrency": "INR | USD",
  "createdAt": "TIMESTAMP",
  "subscriptionStatus": "FREE | PRO"
}

### Collection: `portfolios`
{
  "id": "STRING (PK)",
  "userId": "STRING (Index)",
  "name": "STRING",
  "currency": "USD | INR",
  "holdings": [
    {
      "holdingId": "STRING",
      "ticker": "STRING",
      "market": "US | IN",
      "platform": "STRING",
      "buyDate": "YYYY-MM-DD",
      "quantity": "NUMBER",
      "buyPrice": "NUMBER"
    }
  ],
  "updatedAt": "TIMESTAMP"
}

### Collection: `watchlists`
{
  "id": "STRING (PK)",
  "userId": "STRING (Index)",
  "ticker": "STRING",
  "market": "US | IN",
  "targetEntryPrice": "NUMBER (Optional)",
  "targetExitPrice": "NUMBER (Optional)",
  "notes": "STRING",
  "addedAt": "TIMESTAMP"
}

### Collection: `user_rules`
{
  "id": "STRING (PK)",
  "userId": "STRING (Index)",
  "ruleName": "STRING",
  "naturalPrompt": "STRING",
  "compiledLogic": {
    "and": [
      { "<": [{ "var": "rsi14" }, 30] },
      { "<": [{ "var": "peRatio" }, 25] }
    ]
  },
  "appliedTo": "PORTFOLIO | WATCHLIST | BOTH",
  "enabled": "BOOLEAN",
  "updatedAt": "TIMESTAMP"
}

---

## 2. Decoupled Processing Pipeline

### Step 1: Internet Data Ingestion (Client App)
Fetch raw financial numbers from web APIs and calculate technical indicators locally:
```typescript
import { RSI, SMA } from 'technicalindicators';

export function calculateTechnicals(prices: number[]) {
  return {
    rsi14: RSI.calculate({ values: prices, period: 14 }).slice(-1)[0],
    sma50: SMA.calculate({ values: prices, period: 50 }).slice(-1)[0],
    sma200: SMA.calculate({ values: prices, period: 200 }).slice(-1)[0],
  };
}