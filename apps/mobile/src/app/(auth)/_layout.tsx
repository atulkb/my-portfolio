import { Stack } from 'expo-router';

import { useSession } from '@/stores';
import { useTheme } from '@/theme/theme';

/** Sign-in group: login/sign-up when signed out, verify-email for unverified email accounts. */
export default function AuthLayout(): React.JSX.Element {
  const { colors } = useTheme();
  const gate = useSession((s) => s.gate);
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.canvas } }}>
      <Stack.Protected guard={gate === 'signedOut'}>
        <Stack.Screen name="login" />
        <Stack.Screen name="sign-up" />
      </Stack.Protected>
      <Stack.Protected guard={gate === 'unverified'}>
        <Stack.Screen name="verify-email" />
      </Stack.Protected>
    </Stack>
  );
}
