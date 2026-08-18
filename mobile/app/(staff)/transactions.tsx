import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, type AdminTransactionView } from '../../src/api';
import {
  Card,
  EmptyState,
  ErrorBanner,
  LoadingScreen,
} from '../../src/components';
import {
  formatAccountNumber,
  formatDateTime,
  formatMoney,
  transactionLabel,
} from '../../src/format';
import { colors, spacing, typography } from '../../src/theme';
import { useApiData } from '../../src/useApiData';

/** Platform-wide feed: every movement across every customer account. */
export default function Transactions() {
  const insets = useSafeAreaInsets();
  const { data, error, loading, refreshing, refresh } = useApiData(() =>
    api.adminTransactions(1, 50),
  );

  if (loading && !data) return <LoadingScreen label="Loading transactions" />;

  return (
    <View style={[styles.flex, { paddingTop: insets.top + spacing.lg }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Transactions</Text>
        {data ? (
          <Text style={styles.subtitle}>
            Showing {data.data.length} of {data.pagination.total}
          </Text>
        ) : null}
      </View>

      <FlatList
        data={data?.data ?? []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} />
        }
        ListHeaderComponent={<ErrorBanner message={error} />}
        ListEmptyComponent={
          <Card>
            <EmptyState message="No transactions recorded yet." />
          </Card>
        }
        renderItem={({ item }) => <FeedRow transaction={item} />}
      />
    </View>
  );
}

function FeedRow({ transaction }: { transaction: AdminTransactionView }) {
  const isCredit = transaction.direction === '+';

  return (
    <Card>
      <View style={styles.rowTop}>
        <View style={styles.rowIdentity}>
          <Text style={styles.holder}>{transaction.accountHolder}</Text>
          <Text style={styles.account}>
            {formatAccountNumber(transaction.accountNumber)}
          </Text>
        </View>
        <Text
          style={[
            styles.amount,
            { color: isCredit ? colors.credit : colors.debit },
          ]}
        >
          {transaction.direction}
          {formatMoney(transaction.amount)}
        </Text>
      </View>

      <View style={styles.rowBottom}>
        <Text style={styles.meta}>
          {transactionLabel(transaction.type)}
          {transaction.counterpartyAccountNumber
            ? ` · ${isCredit ? 'from' : 'to'} ${transaction.counterpartyAccountNumber}`
            : ''}
        </Text>
        <Text style={styles.meta}>
          Balance {formatMoney(transaction.balanceAfter)}
        </Text>
      </View>

      <Text style={styles.timestamp}>
        {formatDateTime(transaction.createdAt)} · {transaction.reference}
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  header: { paddingHorizontal: spacing.xl, marginBottom: spacing.lg },
  title: { ...typography.title, color: colors.text },
  subtitle: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  list: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxl,
    gap: spacing.md,
  },
  rowTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  rowIdentity: { flex: 1, paddingRight: spacing.md },
  holder: { ...typography.body, color: colors.text, fontWeight: '600' },
  account: { ...typography.caption, color: colors.textMuted, letterSpacing: 1 },
  amount: { ...typography.body, fontWeight: '700' },
  rowBottom: {
    marginTop: spacing.sm,
    flexDirection: 'row',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  meta: { ...typography.caption, color: colors.textMuted },
  timestamp: {
    ...typography.caption,
    color: colors.border,
    marginTop: spacing.xs,
  },
});
