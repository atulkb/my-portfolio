import { useLocalSearchParams } from 'expo-router';

import { SheetScroll } from '@/components/Sheet';
import { CreateRuleSheet } from '@/features/rules/CreateRuleSheet';

/** S08a Create rule (`?ruleId=` to edit). */
export default function CreateRuleRoute(): React.JSX.Element {
  const { ruleId } = useLocalSearchParams<{ ruleId?: string }>();
  return (
    <SheetScroll>
      <CreateRuleSheet ruleId={ruleId ?? null} />
    </SheetScroll>
  );
}
