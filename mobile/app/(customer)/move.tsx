import { useLocalSearchParams } from 'expo-router';
import { Fragment, useCallback, useEffect, useState } from 'react';
import * as Crypto from 'expo-crypto';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  api,
  ApiError,
  type AccountView,
  type MovementView,
} from '../../src/api';
import {
  Button,
  Card,
  ErrorBanner,
  Field,
  LoadingScreen,
  Pill,
  SectionTitle,
  SuccessBanner,
} from '../../src/components';
import { confirmAction } from '../../src/confirm';
import {
  formatAccountNumber,
  formatDateTime,
  formatMoney,
} from '../../src/format';
import { colors, radius, spacing, typography } from '../../src/theme';
import { useApiData } from '../../src/useApiData';

type Action = 'deposit' | 'withdraw' | 'transfer';
type Channel = 'BRANCH_CASH' | 'MOBILE_MONEY';

const ACTIONS: { key: Action; label: string }[] = [
  { key: 'deposit', label: 'Deposit' },
  { key: 'withdraw', label: 'Withdraw' },
  { key: 'transfer', label: 'Transfer' },
];

/**
 * Cash no longer moves the moment the customer taps a button.
 *
 * A deposit is a *claim* that money was paid in at a branch, and it changes
 * nothing until a manager checks it. A withdrawal reserves the money straight
 * away — otherwise the same balance could back several pending requests — and
 * is handed over at the branch. Only a transfer settles immediately, because
 * both accounts are ours and nothing physical has to happen.
 */
export default function MoveMoney() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ action?: string }>();

  const [action, setAction] = useState<Action>('deposit');
  const [channel, setChannel] = useState<Channel>('MOBILE_MONEY');
  const [accountId, setAccountId] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [slipReference, setSlipReference] = useState('');
  const [branchName, setBranchName] = useState('');
  const [recipient, setRecipient] = useState('');
  const [recipientName, setRecipientName] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const accountsData = useApiData(
    useCallback(() => api.dashboard().then((d) => d.accounts), []),
  );
  const movements = useApiData(useCallback(() => api.myMovements(), []));

  const accounts = accountsData.data;

  useEffect(() => {
    if (params.action && ACTIONS.some((a) => a.key === params.action)) {
      setAction(params.action as Action);
    }
  }, [params.action]);

  useEffect(() => {
    if (!accountId && accounts?.length) {
      const usable = accounts.find((a) => a.status === 'ACTIVE');
      setAccountId(usable?.id ?? accounts[0].id);
    }
  }, [accounts, accountId]);

  const selected = accounts?.find((a) => a.id === accountId) ?? null;

  useEffect(() => {
    if (action !== 'transfer' || recipient.length !== 10) {
      setRecipientName(null);
      return;
    }
    let cancelled = false;
    api
      .lookupAccount(recipient)
      .then((r) => !cancelled && setRecipientName(r.accountHolder))
      .catch(() => !cancelled && setRecipientName(null));
    return () => {
      cancelled = true;
    };
  }, [action, recipient]);

  const refreshAll = useCallback(async () => {
    await Promise.all([accountsData.reload(), movements.reload()]);
  }, [accountsData, movements]);

  if (accountsData.loading && !accounts) {
    return <LoadingScreen label="Loading accounts" />;
  }

  async function submit() {
    if (!accountId) return;
    setError(null);
    setSuccess(null);
    setSubmitting(true);

    try {
      if (action === 'deposit' && channel === 'MOBILE_MONEY') {
        const result = await api.momoDeposit({
          accountId,
          amount: amount.trim(),
          // A fresh key per attempt, so a retry after a lost response returns
          // the original request instead of starting a second collection.
          idempotencyKey: Crypto.randomUUID(),
        });
        setSuccess(
          `Approve the ${formatMoney(result.amount)} ${result.currency} payment on your phone. ` +
            'Your balance updates as soon as the provider confirms it.',
        );
      } else if (action === 'withdraw' && channel === 'MOBILE_MONEY') {
        const result = await api.momoWithdrawal({
          accountId,
          amount: amount.trim(),
          idempotencyKey: Crypto.randomUUID(),
        });
        setSuccess(
          `${formatMoney(result.amount)} ${result.currency} is on its way to your registered ` +
            'mobile money number. It has been held from your balance.',
        );
      } else if (action === 'deposit') {
        const result = await api.declareBranchDeposit({
          accountId,
          amount: amount.trim(),
          slipReference: slipReference.trim(),
          branchName: branchName.trim(),
        });
        setSuccess(
          `Deposit of ${formatMoney(result.amount)} ${result.currency} submitted. ` +
            'A branch manager will confirm it against the branch records — your ' +
            'balance updates once they do.',
        );
        setSlipReference('');
      } else if (action === 'withdraw') {
        const result = await api.requestBranchWithdrawal({
          accountId,
          amount: amount.trim(),
          branchName: branchName.trim(),
        });
        setSuccess(
          `${formatMoney(result.amount)} ${result.currency} is reserved for collection at ` +
            `${result.branchName}. It has been held from your balance — collect it ` +
            'within 72 hours or it goes back.',
        );
      } else {
        const result = await api.transfer(
          accountId,
          recipient.trim(),
          amount.trim(),
          description.trim() || undefined,
        );
        setSuccess(
          `Transfer of ${formatMoney(result.amount)} ${result.currency} completed. ` +
            `New balance ${formatMoney(result.balanceAfter)}.`,
        );
        setRecipient('');
        setDescription('');
      }

      setAmount('');
      await refreshAll();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'The request could not be completed.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  const cancelRequest = useCallback(
    async (movement: MovementView) => {
      const ok = await confirmAction({
        title: 'Cancel this request?',
        message:
          movement.direction === 'WITHDRAWAL'
            ? `${formatMoney(movement.amount)} ${movement.currency} will go back into your account.`
            : 'This deposit claim will be withdrawn.',
        confirmLabel: 'Cancel request',
        destructive: true,
      });
      if (!ok) return;

      try {
        await api.cancelMovement(movement.id);
        await refreshAll();
      } catch (err) {
        setError(
          err instanceof ApiError ? err.message : 'Could not cancel the request.',
        );
      }
    },
    [refreshAll],
  );

  const amountValid =
    /^\d+(\.\d{1,2})?$/.test(amount.trim()) && Number(amount) > 0;

  const canSubmit =
    !!accountId &&
    amountValid &&
    selected?.status === 'ACTIVE' &&
    (action !== 'transfer' || recipient.length === 10) &&
    (action === 'transfer' ||
      channel === 'MOBILE_MONEY' ||
      (action === 'deposit'
        ? slipReference.trim().length >= 4 && branchName.trim().length >= 2
        : branchName.trim().length >= 2));

  const pending = (movements.data?.data ?? []).filter(
    (m) => m.status === 'PENDING',
  );
  const recent = (movements.data?.data ?? []).filter(
    (m) => m.status !== 'PENDING',
  );

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + spacing.lg },
        ]}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={movements.refreshing}
            onRefresh={movements.refresh}
          />
        }
      >
        <Text style={styles.title}>Move money</Text>

        <View style={styles.switcher}>
          {ACTIONS.map((item) => (
            <Pressable
              key={item.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: action === item.key }}
              onPress={() => {
                setAction(item.key);
                setError(null);
                setSuccess(null);
              }}
              style={[styles.tab, action === item.key && styles.tabActive]}
            >
              <Text
                style={[
                  styles.tabText,
                  action === item.key && styles.tabTextActive,
                ]}
              >
                {item.label}
              </Text>
            </Pressable>
          ))}
        </View>

        {action !== 'transfer' ? (
          <View style={styles.channelRow}>
            {(['MOBILE_MONEY', 'BRANCH_CASH'] as Channel[]).map((option) => (
              <Pressable
                key={option}
                accessibilityRole="radio"
                accessibilityState={{ selected: channel === option }}
                onPress={() => {
                  setChannel(option);
                  setError(null);
                  setSuccess(null);
                }}
                style={[
                  styles.channel,
                  channel === option && styles.channelActive,
                ]}
              >
                <Text
                  style={[
                    styles.channelText,
                    channel === option && styles.channelTextActive,
                  ]}
                >
                  {option === 'MOBILE_MONEY' ? 'Mobile money' : 'At a branch'}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        <Text style={styles.explainer}>
          {action === 'transfer'
            ? 'Send money to another Zigama account. Transfers complete immediately.'
            : channel === 'MOBILE_MONEY'
              ? action === 'deposit'
                ? 'Approve the payment on your phone. Your balance updates once the provider confirms it.'
                : 'Money is sent to the number registered on your account, and is held from your balance straight away.'
              : action === 'deposit'
                ? 'Pay cash in at any branch, then record the slip here. Your balance updates once a manager confirms it.'
                : 'Reserve cash to collect at a branch. The amount is held from your balance straight away.'}
        </Text>

        <ErrorBanner message={error} />
        <SuccessBanner message={success} />

        <Text style={styles.fieldLabel}>
          {action === 'transfer' ? 'From account' : 'Account'}
        </Text>
        <View style={styles.accountList}>
          {accounts?.map((account) => (
            <AccountOption
              key={account.id}
              account={account}
              selected={account.id === accountId}
              onPress={() => setAccountId(account.id)}
            />
          ))}
        </View>

        {/* Keyed so switching action remounts inputs rather than reusing the
            previous one's native keyboard. */}
        {action === 'deposit' && channel === 'BRANCH_CASH' ? (
          <Fragment key="deposit-fields">
            <Field
              key="slip"
              label="Deposit slip reference"
              value={slipReference}
              onChangeText={(t) =>
                setSlipReference(t.toUpperCase().replace(/[^A-Z0-9-]/g, ''))
              }
              placeholder="SLIP-000123"
              autoCapitalize="characters"
              maxLength={40}
              hint="Printed on the slip the teller gave you. Each slip can only be used once."
            />
            <Field
              key="branch-deposit"
              label="Branch"
              value={branchName}
              onChangeText={setBranchName}
              placeholder="Kigali Main"
              maxLength={80}
            />
          </Fragment>
        ) : action === 'withdraw' && channel === 'BRANCH_CASH' ? (
          <Fragment key="withdraw-fields">
            <Field
              key="branch-withdraw"
              label="Collect from branch"
              value={branchName}
              onChangeText={setBranchName}
              placeholder="Kigali Main"
              maxLength={80}
            />
          </Fragment>
        ) : action === 'transfer' ? (
          <Fragment key="transfer-fields">
            <Field
              key="recipient"
              label="Recipient account number"
              value={recipient}
              onChangeText={(t) => setRecipient(t.replace(/\D/g, '').slice(0, 10))}
              placeholder="1000000002"
              keyboardType="number-pad"
              maxLength={10}
              hint={
                recipient.length === 10
                  ? recipientName
                    ? `Sending to ${recipientName}`
                    : 'No account found with that number'
                  : '10 digits'
              }
            />
            <Field
              key="note"
              label="Note (optional)"
              value={description}
              onChangeText={setDescription}
              placeholder="Rent share"
              maxLength={140}
            />
          </Fragment>
        ) : null}

        <Field
          key="amount"
          label={`Amount (${selected?.currency ?? 'RWF'})`}
          value={amount}
          onChangeText={(t) => setAmount(t.replace(/[^\d.]/g, ''))}
          placeholder="0.00"
          keyboardType="decimal-pad"
          hint="Up to 2 decimal places"
        />

        {selected && selected.status !== 'ACTIVE' ? (
          <ErrorBanner
            message={`This account is ${selected.status.toLowerCase()} and cannot be used.`}
          />
        ) : null}

        <Button
          label={
            action === 'transfer'
              ? `Send${amountValid ? ` ${formatMoney(amount)}` : ''}`
              : channel === 'MOBILE_MONEY'
                ? action === 'deposit'
                  ? 'Request payment on my phone'
                  : 'Send to my mobile money'
                : action === 'deposit'
                  ? 'Submit deposit for confirmation'
                  : 'Reserve cash'
          }
          onPress={submit}
          loading={submitting}
          disabled={!canSubmit}
        />

        {pending.length > 0 ? (
          <View style={styles.section}>
            <SectionTitle>Awaiting confirmation</SectionTitle>
            {pending.map((movement) => (
              <MovementCard
                key={movement.id}
                movement={movement}
                onCancel={() => void cancelRequest(movement)}
              />
            ))}
          </View>
        ) : null}

        {recent.length > 0 ? (
          <View style={styles.section}>
            <SectionTitle>Recent requests</SectionTitle>
            {recent.slice(0, 5).map((movement) => (
              <MovementCard key={movement.id} movement={movement} />
            ))}
          </View>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function MovementCard({
  movement,
  onCancel,
}: {
  movement: MovementView;
  onCancel?: () => void;
}) {
  const tone =
    movement.status === 'COMPLETED'
      ? 'positive'
      : movement.status === 'PENDING'
        ? 'warning'
        : 'danger';

  return (
    <Card style={styles.movementCard}>
      <View style={styles.movementTop}>
        <View style={styles.movementInfo}>
          <Text style={styles.movementLabel}>
            {movement.direction === 'DEPOSIT'
              ? 'Branch deposit'
              : 'Cash withdrawal'}
          </Text>
          <Text style={styles.movementMeta}>
            {movement.branchName} · {formatDateTime(movement.createdAt)}
          </Text>
        </View>
        <View style={styles.movementRight}>
          <Text style={styles.movementAmount}>
            {formatMoney(movement.amount)}
          </Text>
          <Pill label={movement.status.toLowerCase()} tone={tone} />
        </View>
      </View>

      {movement.slipReference ? (
        <Text style={styles.movementMeta}>Slip {movement.slipReference}</Text>
      ) : null}

      {movement.decisionNote ? (
        <Text style={styles.movementNote}>{movement.decisionNote}</Text>
      ) : null}

      {onCancel ? (
        <Pressable
          accessibilityRole="button"
          onPress={onCancel}
          style={styles.cancel}
        >
          <Text style={styles.cancelText}>Cancel request</Text>
        </Pressable>
      ) : null}
    </Card>
  );
}

function AccountOption({
  account,
  selected,
  onPress,
}: {
  account: AccountView;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.option, selected && styles.optionSelected]}
    >
      <View style={styles.optionRow}>
        <View>
          <Text style={styles.optionType}>
            {account.type === 'CHECKING' ? 'Current' : 'Savings'}
          </Text>
          <Text style={styles.optionNumber}>
            {formatAccountNumber(account.accountNumber)}
          </Text>
        </View>
        <Text style={styles.optionBalance}>{formatMoney(account.balance)}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl },
  title: { ...typography.title, color: colors.text, marginBottom: spacing.lg },
  switcher: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    padding: spacing.xs,
    marginBottom: spacing.md,
  },
  tab: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: radius.sm,
    alignItems: 'center',
  },
  tabActive: { backgroundColor: colors.surface },
  tabText: { ...typography.label, color: colors.textMuted },
  tabTextActive: { color: colors.primary },
  channelRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  channel: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    backgroundColor: colors.surface,
  },
  channelActive: { borderColor: colors.primary, borderWidth: 2 },
  channelText: { ...typography.caption, color: colors.textMuted },
  channelTextActive: { color: colors.primary, fontWeight: '600' },
  explainer: {
    ...typography.caption,
    color: colors.textMuted,
    marginBottom: spacing.lg,
    lineHeight: 18,
  },
  fieldLabel: {
    ...typography.label,
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },
  accountList: { gap: spacing.sm, marginBottom: spacing.lg },
  option: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.lg,
    backgroundColor: colors.surface,
  },
  optionSelected: { borderColor: colors.primary, borderWidth: 2 },
  optionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  optionType: { ...typography.label, color: colors.textMuted },
  optionNumber: { ...typography.body, color: colors.text, letterSpacing: 1 },
  optionBalance: { ...typography.heading, color: colors.text },
  section: { marginTop: spacing.xxl },
  movementCard: { marginBottom: spacing.md },
  movementTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  movementInfo: { flex: 1, paddingRight: spacing.md },
  movementRight: { alignItems: 'flex-end', gap: spacing.xs },
  movementLabel: { ...typography.body, color: colors.text, fontWeight: '600' },
  movementMeta: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  movementAmount: { ...typography.heading, color: colors.text },
  movementNote: {
    ...typography.caption,
    color: colors.warning,
    marginTop: spacing.sm,
  },
  cancel: { marginTop: spacing.md, alignSelf: 'flex-start' },
  cancelText: { ...typography.label, color: colors.debit },
});
