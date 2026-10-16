import { parseInstrumentKey, toInstrumentKey } from '@portfolio/core';
import { useLocalSearchParams } from 'expo-router';

import { SheetScroll } from '@/components/Sheet';
import { WatchlistPick } from '@/features/watchlist/WatchlistPick';

/** Add an instrument to watchlists (`?key=` from S04 ★; without it, search first). */
export default function WatchlistPickRoute(): React.JSX.Element {
  const { key } = useLocalSearchParams<{ key?: string }>();
  const ref = key ? parseInstrumentKey(key) : null;
  return (
    <SheetScroll>
      <WatchlistPick initialKey={ref ? toInstrumentKey(ref.exchange, ref.symbol) : null} />
    </SheetScroll>
  );
}
