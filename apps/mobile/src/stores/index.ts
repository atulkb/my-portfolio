import * as Crypto from 'expo-crypto';
import { useStore } from 'zustand';

import { AI_CONFIG } from '@/config/ai';
import { localIsoDate } from '@/lib/dates';
import { devErrorDetail } from '@/lib/devError';
import { userMessage } from '@/lib/messages';
import { createAiClient } from '@/services/ai/aiClient';
import { createAiService } from '@/services/ai/aiService';
import { firebaseGenerativePort } from '@/services/ai/firebaseAi';
import { pushAiDevLog } from '@/services/ai/devLog';
import { createAiUsage } from '@/services/ai/usage';
import { firebaseAuthService } from '@/services/auth/firebaseAuthService';
import { createKeyValueCache } from '@/services/cache/kv';
import { mmkvRawStore, wipeUserData } from '@/services/cache/storage';
import { createInstrumentMasterRepository } from '@/services/firestore/instrumentMasterRepository';
import { createProfileRepository } from '@/services/firestore/profileRepository';
import { createRuleRepository } from '@/services/firestore/ruleRepository';
import { createTransactionRepository } from '@/services/firestore/transactionRepository';
import { createWatchlistRepository } from '@/services/firestore/watchlistRepository';
import {
  clearInstrumentIndex,
  getInstrumentIndex,
  setIndexFromTsv,
} from '@/services/instruments/instrumentIndex';
import { createInstrumentSyncService } from '@/services/instruments/instrumentSyncService';
import { createInstrumentStore, type InstrumentState } from './instrumentStore';
import { createPortfolioStore, type PortfolioState } from './portfolioStore';
import { createFxService } from '@/services/fx/fxService';
import { createHttpClient } from '@/services/http/httpClient';
import { createMarketDataService } from '@/services/market-data/marketDataService';
import { createYahooProvider } from '@/services/market-data/yahoo/yahooProvider';
import { createRefreshService } from '@/services/refresh/refreshService';
import { createAiStore, type AiState } from './aiStore';
import { createAnalysisStore, type AnalysisState } from './analysisStore';
import { createMarketStore, type MarketState } from './marketStore';
import { createRulesStore, type RulesState } from './rulesStore';
import { createSessionStore, type SessionState } from './sessionStore';
import { createToastStore, type ToastState } from './toastStore';
import { createUiStore, type UiState } from './uiStore';
import { createWatchlistStore, type WatchlistState } from './watchlistStore';

const kv = createKeyValueCache(mmkvRawStore());
const clock = { now: () => Date.now() };

/** The app's instrument (stock list) store, wired to Firestore + MMKV. */
export const instrumentStore = createInstrumentStore({
  sync: createInstrumentSyncService({
    // Created on first use so importing the stores never touches Firestore.
    repo: {
      getMeta: () => createInstrumentMasterRepository().getMeta(),
      getChunks: (meta) => createInstrumentMasterRepository().getChunks(meta),
    },
    kv,
    clock,
    sha256: (text) => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, text),
  }),
  getIndex: getInstrumentIndex,
  setIndexFromTsv,
  clearIndex: clearInstrumentIndex,
});

/** Shared HTTP client with per-host limits (LLD §3.2). */
const http = createHttpClient(
  {
    fetch: (url, init) => fetch(url, init),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    now: () => Date.now(),
    random: Math.random,
  },
  {
    'query1.finance.yahoo.com': { concurrency: 4, minIntervalMs: 200 },
    'query2.finance.yahoo.com': { concurrency: 4, minIntervalMs: 200 },
    'fc.yahoo.com': { concurrency: 1, minIntervalMs: 1000 },
    'api.frankfurter.dev': { concurrency: 2, minIntervalMs: 500 },
  },
  __DEV__ ? (line) => console.log(`[http] ${line}`) : undefined,
);

/** Prices, FX and refresh progress (LLD §4.3). */
export const marketStore = createMarketStore({
  refresh: createRefreshService({
    http,
    market: createMarketDataService({ providers: [createYahooProvider(http, clock)], kv, clock }),
    fx: createFxService({ http, kv, clock }),
    now: () => Date.now(),
  }),
  now: () => Date.now(),
});

/** Indicators and Health per instrument, derived from market data (LLD §4.3). */
export const analysisStore = createAnalysisStore();

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const aiUsage = createAiUsage({
  kv,
  clock,
  sleep,
  limits: { ...AI_CONFIG.rateLimit, maxWaitMs: AI_CONFIG.maxRpmWaitMs },
});

/** Gemini tasks with caching and the daily budget (LLD §3.5); shared by the AI and rules stores. */
export const aiService = createAiService({
  client: createAiClient({
    port: firebaseGenerativePort,
    usage: aiUsage,
    config: AI_CONFIG,
    sleep,
    log: __DEV__
      ? (line) => {
          console.log(`[ai] ${line}`);
          pushAiDevLog(line);
        }
      : undefined,
    describeError: devErrorDetail,
  }),
  usage: aiUsage,
  kv,
  clock,
});

/** Gemini ratings, signals, deep analysis and market sentiment (LLD §3.5, §4.3). */
export const aiStore = createAiStore({
  service: aiService,
  now: () => Date.now(),
  onNotice: (code) => {
    const message = userMessage(code);
    if (message) toastStore.getState().show(message);
  },
});

/** UI preferences (filters, collapsed sectors), persisted in MMKV. */
export const uiStore = createUiStore(kv);

/** Toasts (import results, write failures). */
export const toastStore = createToastStore();

/** The signed-in user's portfolio (buy transactions). */
export const portfolioStore = createPortfolioStore({
  // Resolved per call (the session store is defined below; this only runs after start-up).
  repo: () => {
    const uid = sessionStore.getState().user?.uid;
    return uid ? createTransactionRepository(uid) : null;
  },
  kv,
  clock,
  today: () => localIsoDate(),
  newBatchId: () => Crypto.randomUUID(),
});

/** The signed-in user's resolved uid, for repositories created per call. */
const currentUid = (): string | null => sessionStore.getState().user?.uid ?? null;

/** Watchlists and their items (LLD §4.3). */
export const watchlistStore = createWatchlistStore({
  repo: () => {
    const uid = currentUid();
    return uid ? createWatchlistRepository(uid) : null;
  },
  clock,
});

/** Rules and today's results (LLD §4.3). */
export const rulesStore = createRulesStore({
  repo: () => {
    const uid = currentUid();
    return uid ? createRuleRepository(uid) : null;
  },
  clock,
  compile: async (input) => {
    try {
      return await aiService.compileRule(input);
    } finally {
      aiStore.getState().refreshBudget();
    }
  },
});

/** The app's session store, wired to Firebase. */
export const sessionStore = createSessionStore({
  auth: firebaseAuthService,
  profiles: createProfileRepository,
  onSignedOut: () => {
    wipeUserData();
    instrumentStore.getState().reset();
    portfolioStore.getState().reset();
    watchlistStore.getState().reset();
    rulesStore.getState().reset();
    marketStore.getState().reset();
    analysisStore.getState().reset();
    aiStore.getState().reset();
    uiStore.getState().reset();
  },
});

/** React hook selecting from the session store. */
export function useSession<T>(selector: (s: SessionState) => T): T {
  return useStore(sessionStore, selector);
}

/** React hook selecting from the instrument store. */
export function useInstruments<T>(selector: (s: InstrumentState) => T): T {
  return useStore(instrumentStore, selector);
}

/** React hook selecting from the portfolio store. */
export function usePortfolio<T>(selector: (s: PortfolioState) => T): T {
  return useStore(portfolioStore, selector);
}

/** React hook selecting from the toast store. */
export function useToast<T>(selector: (s: ToastState) => T): T {
  return useStore(toastStore, selector);
}

/** React hook selecting from the market store. */
export function useMarket<T>(selector: (s: MarketState) => T): T {
  return useStore(marketStore, selector);
}

/** React hook selecting from the analysis store. */
export function useAnalysis<T>(selector: (s: AnalysisState) => T): T {
  return useStore(analysisStore, selector);
}

/** React hook selecting from the AI store. */
export function useAi<T>(selector: (s: AiState) => T): T {
  return useStore(aiStore, selector);
}

/** React hook selecting from the UI store. */
export function useUi<T>(selector: (s: UiState) => T): T {
  return useStore(uiStore, selector);
}

/** React hook selecting from the watchlist store. */
export function useWatchlists<T>(selector: (s: WatchlistState) => T): T {
  return useStore(watchlistStore, selector);
}

/** React hook selecting from the rules store. */
export function useRules<T>(selector: (s: RulesState) => T): T {
  return useStore(rulesStore, selector);
}
