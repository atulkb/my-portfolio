import { parseInstrumentKey, toInstrumentKey } from '@portfolio/core';
import { useLocalSearchParams } from 'expo-router';

import { EditBuysScreen } from '@/features/portfolio/EditBuysScreen';

/** S02c Edit buys (`key` = "NSE:RELIANCE"). */
export default function EditBuysRoute(): React.JSX.Element | null {
  const { key } = useLocalSearchParams<{ key: string }>();
  const ref = parseInstrumentKey(key ?? '');
  return ref ? <EditBuysScreen holdingKey={toInstrumentKey(ref.exchange, ref.symbol)} /> : null;
}
