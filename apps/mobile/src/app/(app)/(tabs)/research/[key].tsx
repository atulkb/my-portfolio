import { parseInstrumentKey, type InstrumentKey } from '@portfolio/core';
import { useLocalSearchParams } from 'expo-router';

import { ResearchScreen } from '@/features/analysis/ResearchScreen';

/** S04 for one instrument (`key` = "NSE:RELIANCE"). */
export default function ResearchKeyRoute(): React.JSX.Element {
  const { key } = useLocalSearchParams<{ key: string }>();
  const parsed = typeof key === 'string' ? parseInstrumentKey(key) : null;
  return <ResearchScreen instrumentKey={parsed ? (key as InstrumentKey) : null} />;
}
