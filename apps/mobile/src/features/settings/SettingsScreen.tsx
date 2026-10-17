import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { DefaultSort } from '@portfolio/core';
import * as Clipboard from 'expo-clipboard';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { Screen } from '@/components/Screen';
import { undoImportWithToast } from '@/features/portfolio/csvImport';
import { diagnosticsText } from '@/lib/log';
import { userMessage } from '@/lib/messages';
import { clearableCacheBytes, clearMarketAndAiCache } from '@/services/cache/storage';
import {
  aiStore,
  lockStore,
  sessionStore,
  toastStore,
  uiStore,
  useLock,
  usePortfolio,
  useSession,
} from '@/stores';
import { colors, MIN_TOUCH, radii, spacing, typography } from '@/theme/tokens';
import { AiCard } from './AiCard';
import { MarketDataCard } from './MarketDataCard';
import { StockListCard } from './StockListCard';

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

const SORTS: readonly { value: DefaultSort; label: string }[] = [
  { value: 'VALUE_DESC', label: 'Value' },
  { value: 'PNL_PCT_DESC', label: 'Total return' },
  { value: 'NAME_ASC', label: 'Name' },
];

/** "1.4 (12)" from the app config (version + native build). */
export function appVersionText(): string {
  const version = Constants.expoConfig?.version ?? '—';
  const build = Constants.nativeBuildVersion;
  return build ? `${version} (${build})` : version;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function Section({ title, children }: { readonly title: string; readonly children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.card}>{children}</View>
    </View>
  );
}

function LinkRow({
  icon,
  title,
  subtitle,
  onPress,
}: {
  readonly icon?: IconName;
  readonly title: string;
  readonly subtitle?: string;
  readonly onPress: () => void;
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      style={({ pressed }) => [styles.linkRow, pressed && styles.pressed]}
    >
      {icon ? <MaterialCommunityIcons name={icon} size={20} color={colors.textSecondary} /> : null}
      <View style={styles.flex}>
        <Text style={styles.rowTitle}>{title}</Text>
        {subtitle ? (
          <Text style={styles.sub} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <MaterialCommunityIcons name="chevron-right" size={22} color={colors.textSecondary} />
    </Pressable>
  );
}

/** S09 Settings (LLD §4.4): account, display, security, AI, data, about, sign out, delete. */
export function SettingsScreen(): React.JSX.Element {
  const profile = useSession((s) => s.profile);
  const busy = useSession((s) => s.busy);
  const lastImport = usePortfolio((s) => s.lastImport);
  const lockEnabled = useLock((s) => s.enabled);
  const lockError = useLock((s) => s.error);
  const [cacheBytes, setCacheBytes] = useState(() => clearableCacheBytes());
  const currency = profile?.settings.summaryCurrency ?? 'INR';
  const sort = profile?.settings.defaultSort ?? 'VALUE_DESC';
  const email = profile?.authProvider === 'password';
  const initials = (profile?.displayName ?? '?')
    .split(/\s+/)
    .map((w) => w[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const changePassword = (): void => {
    if (!profile) return;
    void sessionStore
      .getState()
      .sendPasswordReset(profile.email)
      .then((ok) =>
        toastStore
          .getState()
          .show(ok ? `Password reset link sent to ${profile.email}` : 'Couldn’t send the reset email.'),
      );
  };

  const setSort = (value: DefaultSort): void => {
    void sessionStore.getState().updateSettings({ defaultSort: value });
    // The new default applies to the holdings list right away.
    const ui = uiStore.getState();
    ui.setPortfolioFilters({ ...ui.portfolioFilters, sort: value });
  };

  const clearCache = (): void =>
    Alert.alert(
      'Clear local cache?',
      'Cached prices, exchange rates and AI answers are removed and fetched again on the next refresh. Your portfolio, watchlists and rules are not affected.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: () => {
            clearMarketAndAiCache();
            aiStore.getState().reset();
            setCacheBytes(clearableCacheBytes());
            toastStore.getState().show('Local cache cleared.');
          },
        },
      ],
    );

  const copyDiagnostics = (): void => {
    void Clipboard.setStringAsync(diagnosticsText([`app=${appVersionText()}`, `platform=android`])).then(() =>
      toastStore.getState().show('Diagnostics copied (no personal data).'),
    );
  };

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
        <Text style={styles.title}>Settings</Text>
      </View>

      <Section title="ACCOUNT">
        <View style={styles.account}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
          <View style={styles.flex}>
            <Text style={styles.name} numberOfLines={1}>
              {profile?.displayName ?? '—'}
            </Text>
            <Text style={styles.sub} numberOfLines={1}>
              {profile?.email ?? '—'}
            </Text>
          </View>
          <Text style={styles.badge}>{email ? 'Email' : 'Google'}</Text>
        </View>
        {email ? <LinkRow icon="lock-reset" title="Change password" onPress={changePassword} /> : null}
      </Section>

      <Section title="DISPLAY">
        <View style={styles.block}>
          <Text style={styles.rowTitle}>Portfolio summary currency</Text>
          <View style={styles.chips}>
            {(['INR', 'USD'] as const).map((c) => (
              <Chip
                key={c}
                label={c === 'INR' ? 'INR ₹' : 'USD $'}
                selected={currency === c}
                onPress={() => void sessionStore.getState().updateSettings({ summaryCurrency: c })}
              />
            ))}
          </View>
          <Text style={styles.sub}>Individual holdings always show their own currency.</Text>
        </View>
        <View style={styles.block}>
          <Text style={styles.rowTitle}>Sort holdings by default</Text>
          <View style={styles.chips}>
            {SORTS.map((s) => (
              <Chip
                key={s.value}
                label={s.label}
                selected={sort === s.value}
                onPress={() => setSort(s.value)}
              />
            ))}
          </View>
        </View>
      </Section>

      <Section title="SECURITY">
        <View style={styles.switchRow}>
          <View style={styles.flex}>
            <Text style={styles.rowTitle}>Biometric app lock</Text>
            <Text style={styles.sub}>
              Require fingerprint, face or device PIN when opening the app and after 5 minutes away.
            </Text>
          </View>
          <Switch
            accessibilityLabel="Biometric app lock"
            value={lockEnabled}
            onValueChange={(v) => void lockStore.getState().setEnabled(v)}
            trackColor={{ true: colors.gain, false: colors.surface2 }}
          />
        </View>
        {lockError ? <Text style={styles.warn}>{userMessage(lockError)}</Text> : null}
      </Section>

      <AiCard />

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>DATA</Text>
        <StockListCard />
        <MarketDataCard />
        <View style={styles.card}>
          <LinkRow
            icon="bank-outline"
            title="Platforms"
            subtitle={
              profile && profile.platforms.length > 0
                ? `Manage broker names: ${profile.platforms.join(', ')}`
                : 'No brokers yet'
            }
            onPress={() => router.push('/settings/platforms')}
          />
          <View style={styles.switchRow}>
            <View style={styles.flex}>
              <Text style={styles.rowTitle}>Clear local cache</Text>
              <Text style={styles.sub}>{`${formatBytes(cacheBytes)} of cached prices and AI answers`}</Text>
            </View>
            <Button label="Clear" variant="secondary" onPress={clearCache} />
          </View>
          {lastImport ? (
            <View style={styles.switchRow}>
              <View style={styles.flex}>
                <Text style={styles.rowTitle}>Undo last import</Text>
                <Text style={styles.sub}>
                  {`${lastImport.count} ${lastImport.count === 1 ? 'buy' : 'buys'} · ${new Date(lastImport.importedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`}
                </Text>
              </View>
              <Button label="Undo" variant="secondary" onPress={() => void undoImportWithToast()} />
            </View>
          ) : null}
        </View>
      </View>

      <Section title="ABOUT">
        <View style={styles.switchRow}>
          <Text style={[styles.rowTitle, styles.flex]}>App version</Text>
          <Text style={styles.sub}>{appVersionText()}</Text>
        </View>
        <LinkRow
          title="Privacy policy"
          onPress={() => router.push({ pathname: '/settings/legal/[doc]', params: { doc: 'privacy' } })}
        />
        <LinkRow
          title="Disclaimer"
          onPress={() => router.push({ pathname: '/settings/legal/[doc]', params: { doc: 'disclaimer' } })}
        />
        <LinkRow
          title="Copy diagnostics"
          subtitle="Recent events and error codes, no personal data"
          onPress={copyDiagnostics}
        />
      </Section>

      <Button
        label="Sign out"
        variant="secondary"
        loading={busy}
        onPress={() => void sessionStore.getState().signOut()}
      />
      <Button
        label="Delete account"
        variant="destructive"
        onPress={() => router.push('/sheets/delete-account')}
      />
      <Text style={styles.footnote}>Permanently deletes your portfolio, watchlists and rules.</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  appBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  title: { ...typography.headlineMd, color: colors.textPrimary },
  section: { gap: spacing.sm },
  sectionTitle: { ...typography.microBadge, color: colors.textSecondary },
  card: {
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: spacing.gutter,
    gap: spacing.md,
  },
  account: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: radii.lg,
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { ...typography.headlineSm, color: colors.gain },
  name: { ...typography.headlineSm, color: colors.textPrimary },
  badge: {
    ...typography.labelSm,
    color: colors.textPrimary,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.base,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  block: { gap: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: MIN_TOUCH },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: MIN_TOUCH },
  pressed: { opacity: 0.7 },
  rowTitle: { ...typography.bodyLg, color: colors.textPrimary },
  sub: { ...typography.labelMd, color: colors.textSecondary },
  warn: { ...typography.labelMd, color: colors.caution },
  footnote: { ...typography.labelSm, color: colors.textMuted, textAlign: 'center', marginBottom: spacing.lg },
});
