import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  EXCHANGE_META,
  findLikelyDuplicates,
  MIN_TRADE_DATE,
  newBuyTransactionSchema,
  normalisePlatform,
  parseInstrumentKey,
  parsePositiveNumber,
  type Instrument,
  type Listing,
  type Market,
  type NewBuyTransaction,
} from '@portfolio/core';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ExchangeBadge } from '@/components/Badges';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { TextField } from '@/components/TextField';
import { dateFromIso, localIsoDate } from '@/lib/dates';
import { CURRENCY_SYMBOL, formatDate, formatMoney } from '@/lib/format';
import {
  instrumentStore,
  portfolioStore,
  sessionStore,
  toastStore,
  usePortfolio,
  useSession,
} from '@/stores';
import { MIN_TOUCH, radii, spacing, typography } from '@/theme/tokens';
import { makeStyles, useTheme } from '@/theme/theme';

type Selected = { readonly instrument: Instrument; readonly listing: Listing };

/** Route params of `sheets/add-buy` (LLD §4.1). */
export type AddBuyParams = { readonly key?: string; readonly txId?: string; readonly platform?: string };

type FieldErrors = Partial<Record<'stock' | 'price' | 'quantity' | 'tradeDate' | 'platform', string>>;

const ISSUE_FIELD: Readonly<Record<string, keyof FieldErrors>> = {
  symbol: 'stock',
  exchange: 'stock',
  name: 'stock',
  price: 'price',
  quantity: 'quantity',
  tradeDate: 'tradeDate',
  platform: 'platform',
};

function resolveKey(key: string | undefined): Selected | null {
  const ref = key ? parseInstrumentKey(key) : null;
  return ref ? instrumentStore.getState().resolve(ref.exchange, ref.symbol) : null;
}

/** S06 Add / edit buy (LLD §4.4). Last close and "Use close" arrive with market data (M5). */
export function AddBuyForm({ params }: { readonly params: AddBuyParams }): React.JSX.Element {
  const { colors } = useTheme();
  const styles = useStyles();
  const transactions = usePortfolio((s) => s.transactions);
  const platforms = useSession((s) => s.profile?.platforms ?? []);
  const editing = params.txId ? (transactions.find((t) => t.id === params.txId) ?? null) : null;

  const initialSelected: Selected | null = editing
    ? (resolveKey(`${editing.exchange}:${editing.symbol}`) ?? {
        instrument: {
          id: editing.symbol,
          name: editing.name,
          isin: null,
          type: 'EQUITY',
          listings: [],
          industry: null,
        },
        listing: { exchange: editing.exchange, symbol: editing.symbol, providerCode: null },
      })
    : resolveKey(params.key);

  const [selected, setSelected] = useState<Selected | null>(initialSelected);
  const [market, setMarket] = useState<Market>(
    initialSelected ? EXCHANGE_META[initialSelected.listing.exchange].market : 'IN',
  );
  const [query, setQuery] = useState('');
  const [price, setPrice] = useState(editing ? String(editing.price) : '');
  const [quantity, setQuantity] = useState(editing ? String(editing.quantity) : '');
  const [tradeDate, setTradeDate] = useState(editing?.tradeDate ?? localIsoDate());
  const [platform, setPlatform] = useState(editing?.platform ?? params.platform ?? platforms[0] ?? '');
  const [addingPlatform, setAddingPlatform] = useState(platforms.length === 0 && !editing);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);

  const currency = EXCHANGE_META[selected?.listing.exchange ?? (market === 'IN' ? 'NSE' : 'NASDAQ')].currency;
  const hits = useMemo(
    () => (selected || !query ? [] : instrumentStore.getState().search(query, market).slice(0, 6)),
    [query, market, selected],
  );

  const priceNum = parsePositiveNumber(price);
  const qtyNum = parsePositiveNumber(quantity);
  const outlay = priceNum !== null && qtyNum !== null ? priceNum * qtyNum : null;

  const candidate: NewBuyTransaction | null =
    selected && priceNum !== null && qtyNum !== null && platform.trim()
      ? {
          type: 'BUY',
          symbol: selected.listing.symbol,
          exchange: selected.listing.exchange,
          name: selected.instrument.name.slice(0, 120),
          platform: platform.trim(),
          quantity: qtyNum,
          price: priceNum,
          tradeDate,
          source: editing?.source ?? 'MANUAL',
        }
      : null;
  // D31: duplicates are allowed; warn only (ignore the buy being edited).
  const duplicate =
    candidate !== null &&
    findLikelyDuplicates(
      [candidate],
      transactions.filter((t) => t.id !== editing?.id),
    ).length > 0;

  function pickDate(): void {
    DateTimePickerAndroid.open({
      value: dateFromIso(tradeDate),
      mode: 'date',
      minimumDate: dateFromIso(MIN_TRADE_DATE),
      maximumDate: new Date(),
      onChange: (event, date) => {
        if (event.type === 'set' && date) setTradeDate(localIsoDate(date));
      },
    });
  }

  async function submit(): Promise<void> {
    const next: FieldErrors = {};
    if (!selected) next.stock = 'Choose a stock from the list.';
    if (priceNum === null) next.price = 'Enter the price per share.';
    if (qtyNum === null) next.quantity = 'Enter the number of shares.';
    if (!platform.trim()) next.platform = 'Choose or add a platform.';
    if (candidate) {
      const parsed = newBuyTransactionSchema(localIsoDate()).safeParse(candidate);
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          const field = ISSUE_FIELD[String(issue.path[0])];
          if (field && !next[field]) next[field] = issue.message;
        }
      }
    }
    setErrors(next);
    if (Object.keys(next).length > 0 || !candidate) return;

    setBusy(true);
    const ok = editing
      ? await portfolioStore.getState().updateBuy(editing.id, {
          platform: candidate.platform,
          quantity: candidate.quantity,
          price: candidate.price,
          tradeDate: candidate.tradeDate,
        })
      : await portfolioStore.getState().addBuy(candidate);
    setBusy(false);
    if (!ok) return; // the store rolled back and the portfolio screen shows the error toast
    void sessionStore.getState().addPlatforms([candidate.platform]);
    toastStore.getState().show(editing ? 'Buy updated.' : `${candidate.symbol} added.`);
    router.back();
  }

  return (
    <View style={styles.form}>
      <View style={styles.header}>
        <View style={styles.flex}>
          <Text style={styles.title}>{editing ? 'Edit buy' : 'Add stock manually'}</Text>
          <Text style={styles.subtitle}>
            {editing
              ? 'Change the price, shares, date or platform.'
              : 'Enter one buy. Add more buys any time.'}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          hitSlop={10}
          onPress={() => router.back()}
        >
          <MaterialCommunityIcons name="close" size={24} color={colors.textSecondary} />
        </Pressable>
      </View>

      {editing ? null : (
        <View style={styles.chips}>
          <Chip
            label="Indian market (INR ₹)"
            selected={market === 'IN'}
            onPress={() => {
              setMarket('IN');
              setSelected(null);
            }}
          />
          <Chip
            label="US market (USD $)"
            selected={market === 'US'}
            onPress={() => {
              setMarket('US');
              setSelected(null);
            }}
          />
        </View>
      )}

      {selected ? (
        <View style={styles.selected}>
          <View style={styles.flex}>
            <View style={styles.selectedRow}>
              <Text style={styles.symbol}>{selected.listing.symbol}</Text>
              <ExchangeBadge exchange={selected.listing.exchange} />
            </View>
            <Text style={styles.name} numberOfLines={2}>
              {selected.instrument.name}
            </Text>
            {selected.instrument.industry ? (
              <Text style={styles.muted}>{selected.instrument.industry}</Text>
            ) : null}
          </View>
          {editing ? null : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Change stock"
              hitSlop={10}
              onPress={() => setSelected(null)}
            >
              <Text style={styles.link}>Change</Text>
            </Pressable>
          )}
        </View>
      ) : (
        <View style={styles.searchBlock}>
          <TextField
            label="Stock"
            icon="magnify"
            value={query}
            onChangeText={setQuery}
            autoCapitalize="characters"
            autoCorrect={false}
            placeholder={market === 'IN' ? 'RELIANCE, Infosys…' : 'AAPL, Nvidia…'}
            error={errors.stock ?? null}
          />
          {instrumentStore.getState().status !== 'ready' ? (
            <Text style={styles.muted}>Downloading stock list…</Text>
          ) : null}
          {hits.map(({ instrument, listing }) => (
            <Pressable
              key={`${listing.exchange}:${listing.symbol}`}
              accessibilityRole="button"
              accessibilityLabel={`${listing.symbol}, ${instrument.name}, ${listing.exchange}`}
              style={styles.hit}
              onPress={() => {
                setSelected({ instrument, listing });
                setQuery('');
              }}
            >
              <View style={styles.flex}>
                <Text style={styles.symbol}>{listing.symbol}</Text>
                <Text style={styles.muted} numberOfLines={1}>
                  {instrument.name}
                </Text>
              </View>
              <ExchangeBadge exchange={listing.exchange} />
            </Pressable>
          ))}
        </View>
      )}

      <TextField
        label={`Price per share (${CURRENCY_SYMBOL[currency]})`}
        icon="cash"
        value={price}
        onChangeText={setPrice}
        keyboardType="decimal-pad"
        placeholder="0.00"
        error={errors.price ?? null}
      />
      <TextField
        label="Shares"
        icon="numeric"
        value={quantity}
        onChangeText={setQuantity}
        keyboardType={currency === 'INR' ? 'number-pad' : 'decimal-pad'}
        placeholder={currency === 'INR' ? 'Whole shares, e.g. 25' : 'e.g. 12.35 (up to 4 decimals)'}
        error={errors.quantity ?? null}
      />

      <View style={styles.field}>
        <Text style={styles.label}>Buy date</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Buy date ${formatDate(tradeDate)}. Change`}
          style={[styles.dateBox, errors.tradeDate ? styles.errorBox : null]}
          onPress={pickDate}
        >
          <MaterialCommunityIcons name="calendar" size={20} color={colors.textSecondary} />
          <Text style={styles.dateText}>{formatDate(tradeDate)}</Text>
        </Pressable>
        {errors.tradeDate ? <Text style={styles.error}>{errors.tradeDate}</Text> : null}
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>Platform</Text>
        <View style={styles.chipsWrap}>
          {platforms.map((p) => (
            <Chip
              key={p}
              label={p}
              selected={!addingPlatform && normalisePlatform(p) === normalisePlatform(platform)}
              onPress={() => {
                setAddingPlatform(false);
                setPlatform(p);
              }}
            />
          ))}
          <Chip
            label="Add new…"
            selected={addingPlatform}
            onPress={() => {
              setAddingPlatform(true);
              setPlatform('');
            }}
          />
        </View>
        {addingPlatform ? (
          <TextField
            label="New platform"
            icon="bank-outline"
            value={platform}
            onChangeText={setPlatform}
            placeholder="Zerodha, Groww, Robinhood…"
            maxLength={40}
            error={errors.platform ?? null}
          />
        ) : errors.platform ? (
          <Text style={styles.error}>{errors.platform}</Text>
        ) : null}
      </View>

      <View style={styles.summary}>
        <Text style={styles.caption}>ESTIMATED OUTLAY</Text>
        <Text style={styles.metric}>{formatMoney(outlay, currency)}</Text>
        {currency === 'USD' ? (
          <Text style={styles.muted}>
            Shown in USD; the portfolio total converts with the daily ECB rate.
          </Text>
        ) : null}
      </View>

      {duplicate ? (
        <Text style={styles.warning}>
          A buy with the same stock, platform, date and shares already exists. You can still save it.
        </Text>
      ) : null}

      <Button
        label={editing ? 'Save changes' : 'Add to portfolio'}
        loading={busy}
        onPress={() => void submit()}
      />
    </View>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    form: { gap: spacing.lg },
    flex: { flex: 1 },
    header: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
    title: { ...typography.headlineMd, color: colors.textPrimary },
    subtitle: { ...typography.bodyMd, color: colors.textSecondary },
    chips: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
    chipsWrap: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
    searchBlock: { gap: spacing.sm },
    hit: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      minHeight: MIN_TOUCH,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: radii.md,
      backgroundColor: colors.surface1,
    },
    selected: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      backgroundColor: colors.surface1,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.lg,
      padding: spacing.gutter,
    },
    selectedRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    symbol: { ...typography.metricMd, color: colors.textPrimary },
    name: { ...typography.bodyMd, color: colors.textPrimary },
    muted: { ...typography.labelMd, color: colors.textSecondary },
    link: { ...typography.labelMd, color: colors.info },
    field: { gap: spacing.sm },
    label: { ...typography.labelMd, color: colors.textPrimary },
    dateBox: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      minHeight: 48,
      paddingHorizontal: spacing.md,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface1,
    },
    errorBox: { borderColor: colors.loss },
    dateText: { ...typography.bodyLg, color: colors.textPrimary },
    error: { ...typography.labelMd, color: colors.loss },
    summary: {
      backgroundColor: colors.surface1,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.lg,
      padding: spacing.lg,
      gap: spacing.xs,
    },
    caption: { ...typography.labelSm, color: colors.textSecondary },
    metric: { ...typography.metricLg, color: colors.textPrimary },
    warning: { ...typography.bodyMd, color: colors.caution },
  }),
);
