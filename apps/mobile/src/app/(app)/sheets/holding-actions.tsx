import { parseInstrumentKey, toInstrumentKey } from '@portfolio/core';
import { useLocalSearchParams } from 'expo-router';

import { SheetScroll } from '@/components/Sheet';
import { HoldingActions } from '@/features/portfolio/HoldingActions';

/** S02b Holding actions (`?key=`). */
export default function HoldingActionsRoute(): React.JSX.Element | null {
  const { key } = useLocalSearchParams<{ key: string }>();
  const ref = parseInstrumentKey(key ?? '');
  if (!ref) return null;
  return (
    <SheetScroll>
      <HoldingActions holdingKey={toInstrumentKey(ref.exchange, ref.symbol)} />
    </SheetScroll>
  );
}
