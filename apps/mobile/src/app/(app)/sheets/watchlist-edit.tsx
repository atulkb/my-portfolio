import { useLocalSearchParams } from 'expo-router';

import { SheetScroll } from '@/components/Sheet';
import { WatchlistEdit } from '@/features/watchlist/WatchlistEdit';

/** Create a watchlist, or rename / delete one (`?id=`). */
export default function WatchlistEditRoute(): React.JSX.Element {
  const { id } = useLocalSearchParams<{ id?: string }>();
  return (
    <SheetScroll>
      <WatchlistEdit listId={id ?? null} />
    </SheetScroll>
  );
}
