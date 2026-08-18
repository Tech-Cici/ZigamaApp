import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, type TransactionView } from '../../src/api';
import {
  Card,
  EmptyState,
  ErrorBanner,
  LoadingScreen,
} from '../../src/components';
import { formatDateTime, formatMoney, transactionLabel } from '../../src/format';
import { colors, spacing, typography } from '../../src/theme';
import { useApiData } from '../../src/useApiData';

export default function Activity() {
  const insets = useSafeAreaInsets();
  const { data, error, loading, refreshing, refresh } = useApiData(() =>
    api.history(1, 50),
  );

  if (loading && !data) return <LoadingScreen label="Loading your activity" />;

  return (
    <View style={[styles.flex, { paddingTop: insets.top + spacing.lg }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Activity</Text>
        {data ? (
          <Text style={styles.subtitle}>
            {data.pagination.total} transaction
            {data.pagination.total === 1 ? '' : 's'}
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
            <EmptyState message="Nothing here yet. Your deposits, withdrawals and transfers will appear here." />
          </Card>
        }
        renderItem={({ item }) => <ActivityRow transaction={item} />}
      />
    </View>
  );
}

function ActivityRow({ transaction }: { transaction: TransactionView }) {
  const isCredit = transaction.direction === '+';

  return (
    <Card style={styles.row}>
      <View style={styles.rowTop}>
        <Text style={styles.label}>{transactionLabel(transaction.type)}</Text>
        <Text
          style={[
            styles.amount,
            { color: isCredit ? colors.credit : colors.debit },
          ]}
        >
          {transaction.direction}
          {formatMoney(transaction.amount)} {transaction.currency}
        </Text>
      </View>

      {transaction.description ? (
        <Text style={styles.description}>{transaction.description}</Text>
      ) : null}

      <View style={styles.rowBottom}>
        <Text style={styles.meta}>
          {formatDateTime(transaction.createdAt)}
          {transaction.counterpartyAccountNumber
            ? ` · ${isCredit ? 'from' : 'to'} ${transaction.counterpartyAccountNumber}`
            : ''}
        </Text>
        <Text style={styles.meta}>
          Balance {formatMoney(transaction.balanceAfter)}
        </Text>
      </View>

      <Text style={styles.reference}>{transaction.reference}</Text>
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
  row: {},
  rowTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  label: { ...typography.body, color: colors.text, fontWeight: '600' },
  amount: { ...typography.body, fontWeight: '700' },
  description: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: spacing.xs,
  },
  rowBottom: {
    marginTop: spacing.sm,
    flexDirection: 'row',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  meta: { ...typography.caption, color: colors.textMuted },
  reference: {
    ...typography.caption,
    color: colors.border,
    marginTop: spacing.xs,
  },
});
