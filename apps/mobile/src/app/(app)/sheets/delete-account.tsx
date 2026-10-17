import { SheetScroll } from '@/components/Sheet';
import { DeleteAccountSheet } from '@/features/settings/DeleteAccountSheet';

/** S09 → Delete account confirmation. */
export default function DeleteAccountRoute(): React.JSX.Element {
  return (
    <SheetScroll>
      <DeleteAccountSheet />
    </SheetScroll>
  );
}
