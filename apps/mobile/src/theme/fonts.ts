// Per-weight subpath imports: the package root would bundle all 18 Inter variants.
import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';
import { Inter_700Bold } from '@expo-google-fonts/inter/700Bold';

/** Inter family name per weight (Android selects custom weights by family name). */
export const INTER = {
  400: 'Inter_400Regular',
  500: 'Inter_500Medium',
  600: 'Inter_600SemiBold',
  700: 'Inter_700Bold',
} as const;

/** Font map for `useFonts`; keys must match {@link INTER}. */
export const INTER_FONT_MAP = {
  [INTER[400]]: Inter_400Regular,
  [INTER[500]]: Inter_500Medium,
  [INTER[600]]: Inter_600SemiBold,
  [INTER[700]]: Inter_700Bold,
};
