import { useLocalSearchParams } from 'expo-router';

import { SheetScroll } from '@/components/Sheet';
import { AddBuyForm } from '@/features/portfolio/AddBuyForm';

/** S06 Add / edit buy (`?key=&txId=&platform=`). */
export default function AddBuyRoute(): React.JSX.Element {
  const params = useLocalSearchParams<{ key?: string; txId?: string; platform?: string }>();
  return (
    <SheetScroll>
      <AddBuyForm params={params} />
    </SheetScroll>
  );
}
