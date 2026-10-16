import { parseInstrumentKey, toInstrumentKey } from '@portfolio/core';
import { useLocalSearchParams } from 'expo-router';

import { SheetScroll } from '@/components/Sheet';
import { WatchlistItemSheet } from '@/features/watchlist/WatchlistItemSheet';

/** S07 item actions (`?listId=&key=`): targets, notes, copy / move, remove. */
export default function WatchlistItemRoute(): React.JSX.Element | null {
  const { listId, key } = useLocalSearchParams<{ listId: string; key: string }>();
  const ref = parseInstrumentKey(key ?? '');
  if (!ref || !listId) return null;
  return (
    <SheetScroll>
      <WatchlistItemSheet listId={listId} instrumentKey={toInstrumentKey(ref.exchange, ref.symbol)} />
    </SheetScroll>
  );
}
