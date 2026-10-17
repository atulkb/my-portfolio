import {
  EXCHANGE_META,
  sessionDateFor,
  type Capability,
  type Clock,
  type Exchange,
  type InstrumentRef,
  type MarketDataProvider,
} from '@portfolio/core';

import { ServiceError } from '../../http/errors';
import type { HttpClient } from '../../http/httpClient';
import { quotePageSymbol } from '../symbols';
import { YAHOO_DESKTOP_HEADERS } from '../yahoo/session';
import { parseQuotePage } from './parse';

/** Quote page host (LLD §3.3). */
export const QUOTE_PAGE_HOST = 'https://www.google.com';

/**
 * Last-resort latest close (HLD D33): reads one documented element of the public quote page.
 * Used only for instruments whose bars are stale and only while their market is closed; the
 * caller enforces both. Off for public builds (`FEATURES.scrapeFallback`).
 */
export function createQuotePageProvider(
  http: HttpClient,
  clock: Clock,
  enabled: boolean,
): MarketDataProvider {
  return {
    id: 'quotepage',
    supports: (cap: Capability, exchange: Exchange | null) =>
      enabled && cap === 'LATEST_CLOSE' && exchange !== null,
    async getLatestClose(ref: InstrumentRef) {
      const sym = quotePageSymbol(ref);
      if (!sym || !ref.exchange) throw new ServiceError('UNSUPPORTED', 'quotepage');
      const meta = EXCHANGE_META[ref.exchange];
      const html = await http.getText(`${QUOTE_PAGE_HOST}/finance/quote/${encodeURIComponent(sym)}`, {
        provider: 'quotepage',
        headers: {
          'User-Agent': YAHOO_DESKTOP_HEADERS['User-Agent'],
          Accept: 'text/html',
          // English month names in the status line, which the parser reads.
          'Accept-Language': 'en-US,en;q=0.9',
        },
        retries: 0,
      });
      return parseQuotePage(html, meta.currency, sessionDateFor(meta.market, clock.now()));
    },
  };
}
