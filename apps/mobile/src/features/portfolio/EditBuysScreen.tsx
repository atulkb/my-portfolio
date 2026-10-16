import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { BrokerPosition, BuyTransaction, Currency, InstrumentKey } from '@portfolio/core';
import { router } from 'expo-router';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { formatDate, formatMoney, formatQuantity } from '@/lib/format';
import { portfolioStore, toastStore } from '@/stores';
import { colors, MIN_TOUCH, radii, spacing, typography } from '@/theme/tokens';
import { useHolding } from './hooks';

function confirmDeleteBuy(tx: BuyTransaction, currency: Currency): void {
  Alert.alert(
    'Delete this buy?',
    `${formatQuantity(tx.quantity, currency)} shares at ${formatMoney(tx.price, currency)} on ${formatDate(tx.tradeDate)} (${tx.platform}).`,
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          void portfolioStore
            .getState()
            .deleteBuys([tx.id])
            .then((ok) => ok && toastStore.getState().show('Buy deleted.'));
        },
      },
    ],
  );
}

function confirmRemoveBroker(
  key: InstrumentKey,
  symbol: string,
  b: BrokerPosition,
  currency: Currency,
): void {
  Alert.alert(
    `Remove ${symbol} from ${b.platform}?`,
    `${b.buys.length} ${b.buys.length === 1 ? 'buy' : 'buys'} (${formatQuantity(b.quantity, currency)} shares) will be deleted.`,
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          void portfolioStore
            .getState()
            .removeFromBroker(key, b.platform)
            .then((ok) => ok && toastStore.getState().show(`Removed from ${b.platform}.`));
        },
      },
    ],
  );
}

/** S02c Edit buys grouped by broker (LLD §4.4; not in Stitch, Obsidian style). */
export function EditBuysScreen({ holdingKey }: { readonly holdingKey: InstrumentKey }): React.JSX.Element {
  const holding = useHolding(holdingKey);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.appBar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={10}
          onPress={() => router.back()}
        >
          <MaterialCommunityIcons name="arrow-left" size={24} color={colors.textPrimary} />
        </Pressable>
        <View style={styles.flex}>
          <Text style={styles.title} numberOfLines={1}>
            {holding ? `Edit buys · ${holding.symbol}` : 'Edit buys'}
          </Text>
          {holding ? (
            <Text style={styles.sub} numberOfLines={1}>
              {holding.name}
            </Text>
          ) : null}
        </View>
      </View>

      {!holding ? (
        <View style={styles.center}>
          <Text style={styles.sub}>No buys left for this stock.</Text>
          <Button label="Back to portfolio" variant="secondary" onPress={() => router.back()} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          {holding.brokers.map((b) => (
            <View key={b.platform} style={styles.card}>
              <View style={styles.brokerHead}>
                <Text style={styles.broker}>{b.platform}</Text>
                <Text style={styles.sub}>
                  {`${formatQuantity(b.quantity, holding.currency)} shares · Avg ${formatMoney(b.avgPrice, holding.currency)} · ${formatMoney(b.invested, holding.currency)}`}
                </Text>
              </View>
              {b.buys.map((tx) => (
                <View key={tx.id} style={styles.buy}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Edit buy on ${formatDate(tx.tradeDate)}`}
                    style={styles.buyMain}
                    onPress={() => router.push({ pathname: '/sheets/add-buy', params: { txId: tx.id } })}
                  >
                    <Text style={styles.buyDate}>{formatDate(tx.tradeDate)}</Text>
                    <Text style={styles.sub}>
                      {`${formatQuantity(tx.quantity, holding.currency)} × ${formatMoney(tx.price, holding.currency)}${tx.source === 'CSV' ? ' · CSV' : ''}`}
                    </Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Delete buy on ${formatDate(tx.tradeDate)}`}
                    hitSlop={8}
                    style={styles.iconBtn}
                    onPress={() => confirmDeleteBuy(tx, holding.currency)}
                  >
                    <MaterialCommunityIcons name="delete-outline" size={20} color={colors.loss} />
                  </Pressable>
                </View>
              ))}
              <View style={styles.brokerActions}>
                <Button
                  label="Add buy"
                  variant="link"
                  onPress={() =>
                    router.push({
                      pathname: '/sheets/add-buy',
                      params: { key: holding.key, platform: b.platform },
                    })
                  }
                />
                <Button
                  label={`Remove from ${b.platform}`}
                  variant="destructiveLink"
                  onPress={() => confirmRemoveBroker(holding.key, holding.symbol, b, holding.currency)}
                />
              </View>
            </View>
          ))}
          <Button
            label="Add buy on another platform"
            variant="secondary"
            onPress={() => router.push({ pathname: '/sheets/add-buy', params: { key: holding.key } })}
          />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.canvas },
  flex: { flex: 1 },
  appBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.margin,
    paddingVertical: spacing.md,
  },
  title: { ...typography.headlineSm, color: colors.textPrimary },
  sub: { ...typography.labelMd, color: colors.textSecondary },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.lg },
  content: { padding: spacing.margin, gap: spacing.lg, paddingBottom: spacing.xl * 2 },
  card: {
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: spacing.gutter,
    gap: spacing.sm,
  },
  brokerHead: { gap: 2, paddingBottom: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  broker: { ...typography.metricMd, color: colors.textPrimary },
  buy: { flexDirection: 'row', alignItems: 'center', minHeight: MIN_TOUCH },
  buyMain: { flex: 1, paddingVertical: spacing.xs },
  buyDate: { ...typography.bodyLg, color: colors.textPrimary },
  iconBtn: { width: MIN_TOUCH, height: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' },
  brokerActions: { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap' },
});
