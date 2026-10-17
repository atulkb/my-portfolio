import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Screen } from '@/components/Screen';
import { spacing, typography } from '@/theme/tokens';
import { makeStyles, useTheme } from '@/theme/theme';
import { LEGAL_DOCS, type LegalDoc } from './legal';

/** S09 → Privacy policy / Disclaimer (static text). */
export function LegalScreen({ doc }: { readonly doc: LegalDoc }): React.JSX.Element {
  const { colors } = useTheme();
  const styles = useStyles();
  const { title, paragraphs } = LEGAL_DOCS[doc];
  return (
    <Screen>
      <View style={styles.appBar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={10}
          onPress={() => router.back()}
        >
          <MaterialCommunityIcons name="arrow-left" size={24} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.title}>{title}</Text>
      </View>
      {paragraphs.map((p) => (
        <Text key={p} style={styles.body}>
          {p}
        </Text>
      ))}
    </Screen>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    appBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    title: { ...typography.headlineMd, color: colors.textPrimary },
    body: { ...typography.bodyLg, color: colors.textSecondary },
  }),
);
