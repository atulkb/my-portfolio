import { SheetScroll } from '@/components/Sheet';
import { FilterSheet } from '@/features/portfolio/FilterSheet';

/** S02a Filter sheet. */
export default function FilterRoute(): React.JSX.Element {
  return (
    <SheetScroll>
      <FilterSheet />
    </SheetScroll>
  );
}
