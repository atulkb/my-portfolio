import type { Exchange, Market } from '@portfolio/core';
import { StyleSheet, Text, View } from 'react-native';

import { colors, radii, spacing, typography } from '@/theme/tokens';

/** Square ticker tile on stock cards (first 4–5 characters of the symbol). */
export function SymbolTile({ symbol }: { readonly symbol: string }): React.JSX.Element {
  return (
    <View style={styles.tile} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Text style={styles.tileText} numberOfLines={1} adjustsFontSizeToFit>
        {symbol.slice(0, 5)}
      </Text>
    </View>
  );
}

/** "IN" / "US" market badge. */
export function MarketBadge({ market }: { readonly market: Market }): React.JSX.Element {
  return (
    <Text style={styles.market} accessibilityLabel={market === 'IN' ? 'India' : 'United States'}>
      {market}
    </Text>
  );
}

/** Exchange label ("NSE", "NYSE ARCA"). */
export function ExchangeBadge({ exchange }: { readonly exchange: Exchange }): React.JSX.Element {
  return <Text style={styles.exchange}>{exchange.replace('_', ' ')}</Text>;
}

const styles = StyleSheet.create({
  tile: {
    width: 44,
    height: 44,
    borderRadius: radii.md,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
  },
  tileText: { ...typography.microBadge, color: colors.textPrimary },
  market: { ...typography.microBadge, color: colors.textSecondary },
  exchange: {
    ...typography.microBadge,
    color: colors.textSecondary,
    backgroundColor: colors.surface2,
    borderRadius: radii.base,
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    overflow: 'hidden',
  },
});
