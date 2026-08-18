import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, ApiError, type MovementView } from '../../src/api';
import { useAuth } from '../../src/auth';
import {
  Card,
  EmptyState,
  ErrorBanner,
  LoadingScreen,
  Pill,
  SectionTitle,
} from '../../src/components';
import { confirmAction } from '../../src/confirm';
import {
  formatAccountNumber,
  formatDateTime,
  formatMoney,
} from '../../src/format';
import { colors, radius, spacing, typography } from '../../src/theme';
import { useApiData } from '../../src/useApiData';

/**
 * The cash desk queue.
 *
 * A deposit here is an unverified claim — the manager's job is to check the
 * slip reference against the branch's own records before approving, because
 * approving is what creates the money in the customer's account.
 *
 * A withdrawal is the opposite: the money is already held, and approving just
 * records that the cash was handed over.
 */
export default function CashQueue() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const isManager = user?.role === 'MANAGER';

  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const { data, loading, refreshing, refresh, reload } = useApiData(
    useCallback(() => api.pendingMovements(), []),
  );

  const decide = useCallback(
    async (movement: MovementView, approve: boolean) => {
      setError(null);

      const isDeposit = movement.direction === 'DEPOSIT';
      const ok = await confirmAction({
        title: approve
          ? isDeposit
            ? 'Confirm this deposit?'
            : 'Confirm cash handed over?'
          : 'Reject this request?',
        message: approve
          ? isDeposit
            ? `${formatMoney(movement.amount)} ${movement.currency} will be credited to ${movement.accountHolder}. Check slip ${movement.slipReference} against the branch record first.`
            : `${formatMoney(movement.amount)} ${movement.currency} has already been held. Confirm only if the customer collected the cash.`
          : isDeposit
            ? 'Nothing will be credited.'
            : `${formatMoney(movement.amount)} ${movement.currency} will be returned to the customer.`,
        confirmLabel: approve ? 'Confirm' : 'Reject',
        destructive: !approve,
      });
      if (!ok) return;

      setBusyId(movement.id);
      try {
        if (approve) {
          await api.approveMovement(movement.id, 'Verified at branch');
        } else {
          await api.rejectMovement(
            movement.id,
            isDeposit
              ? 'No matching deposit found at the branch'
              : 'Cash was not collected',
          );
        }
        await reload();
      } catch (err) {
        setError(
          err instanceof ApiError ? err.message : 'Could not record the decision.',
        );
      } finally {
        setBusyId(null);
      }
    },
    [reload],
  );

  if (loading && !data) return <LoadingScreen label="Loading cash desk" />;

  const rows = data?.data ?? [];
  const deposits = rows.filter((r) => r.direction === 'DEPOSIT');
  const withdrawals = rows.filter((r) => r.direction === 'WITHDRAWAL');

  return (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + spacing.lg },
      ]}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={refresh} />
      }
    >
      <Text style={styles.title}>Cash desk</Text>
      <Text style={styles.note}>
        {isManager
          ? 'Check each deposit slip against the branch record before confirming — approving is what credits the money.'
          : 'Read only. Confirming cash movements requires a branch manager.'}
      </Text>

      <ErrorBanner message={error} />

      <SectionTitle>Deposits to verify ({deposits.length})</SectionTitle>
      {deposits.length === 0 ? (
        <Card>
          <EmptyState message="No deposit claims waiting." />
        </Card>
      ) : (
        deposits.map((movement) => (
          <MovementRow
            key={movement.id}
            movement={movement}
            canDecide={isManager}
            busy={busyId === movement.id}
            onDecide={decide}
          />
        ))
      )}

      <View style={styles.spacer} />

      <SectionTitle>Cash to hand over ({withdrawals.length})</SectionTitle>
      {withdrawals.length === 0 ? (
        <Card>
          <EmptyState message="No withdrawals waiting for collection." />
        </Card>
      ) : (
        withdrawals.map((movement) => (
          <MovementRow
            key={movement.id}
            movement={movement}
            canDecide={isManager}
            busy={busyId === movement.id}
            onDecide={decide}
          />
        ))
      )}
    </ScrollView>
  );
}

function MovementRow({
  movement,
  canDecide,
  busy,
  onDecide,
}: {
  movement: MovementView;
  canDecide: boolean;
  busy: boolean;
  onDecide: (movement: MovementView, approve: boolean) => void | Promise<void>;
}) {
  const isDeposit = movement.direction === 'DEPOSIT';

  return (
    <Card style={styles.card}>
      <View style={styles.cardTop}>
        <View style={styles.identity}>
          <Text style={styles.holder}>{movement.accountHolder}</Text>
          <Text style={styles.account}>
            {formatAccountNumber(movement.accountNumber)}
          </Text>
        </View>
        <View style={styles.right}>
          <Text style={styles.amount}>
            {formatMoney(movement.amount)} {movement.currency}
          </Text>
          <Pill
            label={isDeposit ? 'claim' : 'held'}
            tone={isDeposit ? 'warning' : 'neutral'}
          />
        </View>
      </View>

      {movement.slipReference ? (
        <Text style={styles.slip}>Slip {movement.slipReference}</Text>
      ) : null}

      <Text style={styles.meta}>
        {movement.branchName} · raised {formatDateTime(movement.createdAt)}
      </Text>

      {canDecide ? (
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => void onDecide(movement, false)}
            style={({ pressed }) => [
              styles.action,
              styles.reject,
              pressed && { opacity: 0.7 },
            ]}
          >
            <Text style={styles.rejectText}>Reject</Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => void onDecide(movement, true)}
            style={({ pressed }) => [
              styles.action,
              styles.approve,
              pressed && { opacity: 0.7 },
            ]}
          >
            {busy ? (
              <ActivityIndicator size="small" color={colors.textInverse} />
            ) : (
              <Text style={styles.approveText}>
                {isDeposit ? 'Confirm deposit' : 'Cash handed over'}
              </Text>
            )}
          </Pressable>
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl },
  title: { ...typography.title, color: colors.text },
  note: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: spacing.xs,
    marginBottom: spacing.lg,
    lineHeight: 18,
  },
  spacer: { height: spacing.xl },
  card: { marginBottom: spacing.md },
  cardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  identity: { flex: 1, paddingRight: spacing.md },
  holder: { ...typography.heading, color: colors.text },
  account: { ...typography.caption, color: colors.textMuted, letterSpacing: 1 },
  right: { alignItems: 'flex-end', gap: spacing.xs },
  amount: { ...typography.heading, color: colors.text },
  slip: {
    ...typography.body,
    color: colors.primary,
    marginTop: spacing.sm,
    letterSpacing: 1,
  },
  meta: { ...typography.caption, color: colors.textMuted, marginTop: spacing.xs },
  actions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg },
  action: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  reject: { borderWidth: 1, borderColor: colors.debit },
  rejectText: { ...typography.label, color: colors.debit },
  approve: { backgroundColor: colors.primary },
  approveText: { ...typography.label, color: colors.textInverse },
});
