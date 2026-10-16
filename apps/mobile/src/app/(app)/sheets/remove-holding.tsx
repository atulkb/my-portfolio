import { parseInstrumentKey, toInstrumentKey } from '@portfolio/core';
import { useLocalSearchParams } from 'expo-router';

import { SheetScroll } from '@/components/Sheet';
import { RemoveHolding } from '@/features/portfolio/RemoveHolding';

/** S02b → Remove confirmation (`?key=`). */
export default function RemoveHoldingRoute(): React.JSX.Element | null {
  const { key } = useLocalSearchParams<{ key: string }>();
  const ref = parseInstrumentKey(key ?? '');
  if (!ref) return null;
  return (
    <SheetScroll>
      <RemoveHolding holdingKey={toInstrumentKey(ref.exchange, ref.symbol)} />
    </SheetScroll>
  );
}
