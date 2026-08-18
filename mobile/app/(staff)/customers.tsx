import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, ApiError, type AccountView, type AdminUserRow } from '../../src/api';
import { useAuth } from '../../src/auth';
import { confirmAction } from '../../src/confirm';
import {
  Card,
  EmptyState,
  ErrorBanner,
  LoadingScreen,
  Pill,
} from '../../src/components';
import { formatAccountNumber, formatMoney } from '../../src/format';
import { colors, radius, spacing, typography } from '../../src/theme';
import { useApiData } from '../../src/useApiData';
export default function Customers() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [search, setSearch] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyAccountId, setBusyAccountId] = useState<string | null>(null);
  const { data, error, loading, refreshing, refresh, reload } = useApiData(
    useCallback(() => api.adminUsers(search), [search]),
  );
  const isAdmin = user?.role === 'ADMIN';
  const toggleFreeze = useCallback(
    async (account: AccountView) => {
      const next = account.status === 'FROZEN' ? 'ACTIVE' : 'FROZEN';
      setActionError(null);
      setBusyAccountId(account.id);
      try {
        await api.setAccountStatus(account.id, next);
        await reload();
      } catch (err) {
        setActionError(
          err instanceof ApiError ? err.message : 'Could not update the account.',
        );
      } finally {
        setBusyAccountId(null);
      }
    },
    [reload],
  );
  const confirmToggle = useCallback(
    async (account: AccountView) => {
      const freezing = account.status !== 'FROZEN';
      const confirmed = await confirmAction({
        title: freezing ? 'Freeze account?' : 'Unfreeze account?',
        message: freezing
          ? `${formatAccountNumber(account.accountNumber)} will be blocked from deposits, withdrawals and transfers.`
          : `${formatAccountNumber(account.accountNumber)} will be able to transact again.`,
        confirmLabel: freezing ? 'Freeze' : 'Unfreeze',
        destructive: freezing,
      });
      if (confirmed) await toggleFreeze(account);
    },
    [toggleFreeze],
  );
  if (loading && !data) return <LoadingScreen label="Loading customers" />;
  return (
    <View style={[styles.flex, { paddingTop: insets.top + spacing.lg }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Customers</Text>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search by name, email or account number"
          placeholderTextColor={colors.textMuted}
          style={styles.search}
          autoCapitalize="none"
          returnKeyType="search"
        />
      </View>
      <FlatList
        data={data?.data ?? []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} />
        }
        ListHeaderComponent={
          <>
            <ErrorBanner message={error} />
            <ErrorBanner message={actionError} />
            {!isAdmin ? (
              <Text style={styles.readOnly}>
                Managers have read-only access. Freezing an account requires an
                administrator.
              </Text>
            ) : null}
          </>
        }
        ListEmptyComponent={
          <Card>
            <EmptyState message="No customers match that search." />
          </Card>
        }
        renderItem={({ item }) => (
          <CustomerCard
            customer={item}
            isAdmin={isAdmin}
            busyAccountId={busyAccountId}
            onToggleFreeze={confirmToggle}
          />
        )}
      />
    </View>
  );
}
function CustomerCard({
  customer,
  isAdmin,
  busyAccountId,
  onToggleFreeze,
}: {
  customer: AdminUserRow;
  isAdmin: boolean;
  busyAccountId: string | null;
  onToggleFreeze: (account: AccountView) => void | Promise<void>;
}) {
  return (
    <Card style={styles.card}>
      <View style={styles.cardTop}>
        <View style={styles.cardIdentity}>
          <Text style={styles.name}>{customer.fullName}</Text>
          <Text style={styles.email}>{customer.email}</Text>
        </View>
        <View style={styles.badges}>
          {!customer.isActive ? <Pill label="Inactive" tone="danger" /> : null}
          {customer.isLocked ? <Pill label="Locked" tone="warning" /> : null}
        </View>
      </View>
      <View style={styles.totalRow}>
        <Text style={styles.totalLabel}>Total held</Text>
        <Text style={styles.totalValue}>
          {formatMoney(customer.totalBalance)}
        </Text>
      </View>
      {customer.accounts.map((account) => (
        <View key={account.id} style={styles.accountRow}>
          <View style={styles.accountInfo}>
            <Text style={styles.accountNumber}>
              {formatAccountNumber(account.accountNumber)}
            </Text>
            <Text style={styles.accountMeta}>
              {account.type === 'CHECKING' ? 'Current' : 'Savings'} ·{' '}
              {formatMoney(account.balance)} {account.currency}
            </Text>
          </View>
          {account.status === 'FROZEN' ? (
            <Pill label="Frozen" tone="warning" />
          ) : null}
          {isAdmin ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => void onToggleFreeze(account)}
              disabled={busyAccountId === account.id}
              style={({ pressed }) => [
                styles.freezeButton,
                account.status === 'FROZEN' && styles.unfreezeButton,
                pressed && { opacity: 0.7 },
              ]}
            >
              {busyAccountId === account.id ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Text
                  style={[
                    styles.freezeText,
                    account.status === 'FROZEN' && styles.unfreezeText,
                  ]}
                >
                  {account.status === 'FROZEN' ? 'Unfreeze' : 'Freeze'}
                </Text>
              )}
            </Pressable>
          ) : null}
        </View>
      ))}
    </Card>
  );
}
const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  header: { paddingHorizontal: spacing.xl, marginBottom: spacing.lg },
  title: { ...typography.title, color: colors.text, marginBottom: spacing.md },
  search: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    fontSize: 15,
    color: colors.text,
  },
  list: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxl,
    gap: spacing.md,
  },
  readOnly: {
    ...typography.caption,
    color: colors.textMuted,
    marginBottom: spacing.md,
  },
  card: {},
  cardTop: { flexDirection: 'row', justifyContent: 'space-between' },
  cardIdentity: { flex: 1, paddingRight: spacing.md },
  name: { ...typography.heading, color: colors.text },
  email: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  badges: { gap: spacing.xs, alignItems: 'flex-end' },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.md,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  totalLabel: { ...typography.label, color: colors.textMuted },
  totalValue: { ...typography.heading, color: colors.text },
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingTop: spacing.md,
  },
  accountInfo: { flex: 1 },
  accountNumber: { ...typography.body, color: colors.text, letterSpacing: 1 },
  accountMeta: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  freezeButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.debit,
    minWidth: 76,
    alignItems: 'center',
  },
  unfreezeButton: { borderColor: colors.credit },
  freezeText: { ...typography.caption, color: colors.debit, fontWeight: '600' },
  unfreezeText: { color: colors.credit },
});
