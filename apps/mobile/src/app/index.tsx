import { StyleSheet, Text, View } from 'react-native';

/** Placeholder home screen until the Portfolio feature is implemented. */
export default function HomeScreen(): React.JSX.Element {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Portfolio Analyzer</Text>
      <Text>Setup OK — implementation starts after LLD sign-off.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 16 },
  title: { fontSize: 22, fontWeight: '600' },
});
