import { useRouter } from 'expo-router';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, type AccountView, type TransactionView } from '../../src/api';
import { useAuth } from '../../src/auth';
import {
  Card,
  EmptyState,
  ErrorBanner,
  LoadingScreen,
  Pill,
  SectionTitle,
} from '../../src/components';
import {
  formatAccountNumber,
  formatDate,
  formatMoney,
  transactionLabel,
} from '../../src/format';
import { colors, radius, spacing, typography } from '../../src/theme';
import { useApiData } from '../../src/useApiData';

export default function Dashboard() {
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { data, error, loading, refreshing, refresh } = useApiData(
    () => api.dashboard(),
  );

  if (loading && !data) return <LoadingScreen label="Loading your accounts" />;

  return (
    <View style={styles.flex}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.lg }]}>
        <Text style={styles.greeting}>Welcome back</Text>
        <Text style={styles.name}>{user?.fullName}</Text>

        <View style={styles.totalBlock}>
          <Text style={styles.totalLabel}>Total balance</Text>
          <Text style={styles.totalValue}>
            {data ? formatMoney(data.totalBalance) : '—'}
            <Text style={styles.currency}> {data?.currency ?? 'RWF'}</Text>
          </Text>
        </View>
      </View>

      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} />
        }
      >
        <ErrorBanner message={error} />

        <View style={styles.actions}>
          <QuickAction
            label="Deposit"
            onPress={() => router.push('/(customer)/move?action=deposit')}
          />
          <QuickAction
            label="Withdraw"
            onPress={() => router.push('/(customer)/move?action=withdraw')}
          />
          <QuickAction
            label="Transfer"
            onPress={() => router.push('/(customer)/move?action=transfer')}
          />
        </View>

        <SectionTitle>Your accounts</SectionTitle>
        {data?.accounts.map((account) => (
          <AccountCard key={account.id} account={account} />
        ))}

        <View style={styles.recentHeader}>
          <SectionTitle>Recent activity</SectionTitle>
          <Pressable onPress={() => router.push('/(customer)/activity')}>
            <Text style={styles.link}>See all</Text>
          </Pressable>
        </View>

        <Card>
          {data && data.recentTransactions.length > 0 ? (
            data.recentTransactions.map((transaction, index) => (
              <TransactionRow
                key={transaction.id}
                transaction={transaction}
                isLast={index === data.recentTransactions.length - 1}
              />
            ))
          ) : (
            <EmptyState message="No transactions yet. Make a deposit to get started." />
          )}
        </Card>
      </ScrollView>
    </View>
  );
}

function QuickAction({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}
    >
      <Text style={styles.actionText}>{label}</Text>
    </Pressable>
  );
}

function AccountCard({ account }: { account: AccountView }) {
  return (
    <Card style={styles.accountCard}>
      <View style={styles.accountTop}>
        <View>
          <Text style={styles.accountType}>
            {account.type === 'CHECKING' ? 'Current account' : 'Savings account'}
          </Text>
          <Text style={styles.accountNumber}>
            {formatAccountNumber(account.accountNumber)}
          </Text>
        </View>
        {account.status !== 'ACTIVE' ? (
          <Pill
            label={account.status === 'FROZEN' ? 'Frozen' : 'Closed'}
            tone={account.status === 'FROZEN' ? 'warning' : 'danger'}
          />
        ) : (
          <Pill label="Active" tone="positive" />
        )}
      </View>
      <Text style={styles.accountBalance}>
        {formatMoney(account.balance)}
        <Text style={styles.accountCurrency}> {account.currency}</Text>
      </Text>
      {account.status === 'FROZEN' ? (
        <Text style={styles.frozenNote}>
          This account is frozen. Contact support to restore access.
        </Text>
      ) : null}
    </Card>
  );
}

export function TransactionRow({
  transaction,
  isLast,
}: {
  transaction: TransactionView;
  isLast?: boolean;
}) {
  const isCredit = transaction.direction === '+';

  return (
    <View style={[styles.txRow, !isLast && styles.txRowDivider]}>
      <View style={styles.txInfo}>
        <Text style={styles.txLabel}>{transactionLabel(transaction.type)}</Text>
        <Text style={styles.txMeta} numberOfLines={1}>
          {transaction.counterpartyAccountNumber
            ? `${transaction.counterpartyAccountNumber} · `
            : ''}
          {formatDate(transaction.createdAt)}
        </Text>
      </View>
      <View style={styles.txAmounts}>
        <Text
          style={[
            styles.txAmount,
            { color: isCredit ? colors.credit : colors.debit },
          ]}
        >
          {transaction.direction}
          {formatMoney(transaction.amount)}
        </Text>
        <Text style={styles.txBalance}>
          {formatMoney(transaction.balanceAfter)}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  header: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xl,
    borderBottomLeftRadius: radius.lg,
    borderBottomRightRadius: radius.lg,
  },
  greeting: { ...typography.caption, color: colors.surfaceMuted, opacity: 0.8 },
  name: { ...typography.heading, color: colors.textInverse },
  totalBlock: { marginTop: spacing.xl },
  totalLabel: { ...typography.caption, color: colors.surfaceMuted, opacity: 0.8 },
  totalValue: {
    ...typography.display,
    color: colors.textInverse,
    marginTop: spacing.xs,
  },
  currency: { ...typography.body, color: colors.accent },
  content: { padding: spacing.xl, paddingBottom: spacing.xxl },
  actions: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.xl,
  },
  action: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: spacing.lg,
    alignItems: 'center',
  },
  actionPressed: { backgroundColor: colors.surfaceMuted },
  actionText: { ...typography.label, color: colors.primary },
  accountCard: { marginBottom: spacing.md },
  accountTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  accountType: { ...typography.label, color: colors.textMuted },
  accountNumber: {
    ...typography.body,
    color: colors.text,
    marginTop: spacing.xs,
    letterSpacing: 1,
  },
  accountBalance: {
    ...typography.title,
    color: colors.text,
    marginTop: spacing.lg,
  },
  accountCurrency: { ...typography.caption, color: colors.textMuted },
  frozenNote: {
    ...typography.caption,
    color: colors.warning,
    marginTop: spacing.sm,
  },
  recentHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.xl,
  },
  link: {
    ...typography.label,
    color: colors.primaryLight,
    marginBottom: spacing.md,
  },
  txRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  txRowDivider: { borderBottomWidth: 1, borderBottomColor: colors.border },
  txInfo: { flex: 1, paddingRight: spacing.md },
  txLabel: { ...typography.body, color: colors.text, fontWeight: '600' },
  txMeta: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  txAmounts: { alignItems: 'flex-end' },
  txAmount: { ...typography.body, fontWeight: '700' },
  txBalance: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
});
