import { Redirect } from 'expo-router';

/** Signed-in entry: the Portfolio tab. */
export default function AppIndex(): React.JSX.Element {
  return <Redirect href="/portfolio" />;
}
