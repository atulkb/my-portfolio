import { SheetScroll } from '@/components/Sheet';
import { CsvResultSheet } from '@/features/portfolio/CsvResultSheet';

/** S05 CSV issues / duplicate review. */
export default function CsvResultRoute(): React.JSX.Element {
  return (
    <SheetScroll>
      <CsvResultSheet />
    </SheetScroll>
  );
}
