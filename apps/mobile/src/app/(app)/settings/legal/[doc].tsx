import { useLocalSearchParams } from 'expo-router';

import { LegalScreen } from '@/features/settings/LegalScreen';

/** S09 → Privacy policy / Disclaimer (`doc` = privacy | disclaimer). */
export default function LegalRoute(): React.JSX.Element {
  const { doc } = useLocalSearchParams<{ doc: string }>();
  return <LegalScreen doc={doc === 'disclaimer' ? 'disclaimer' : 'privacy'} />;
}
