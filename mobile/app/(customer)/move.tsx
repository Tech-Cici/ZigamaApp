import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, ApiError, type AccountView } from '../../src/api';
import {
  Button,
  Card,
  ErrorBanner,
  Field,
  LoadingScreen,
  SuccessBanner,
} from '../../src/components';
import { formatAccountNumber, formatMoney } from '../../src/format';
import { colors, radius, spacing, typography } from '../../src/theme';
import { useApiData } from '../../src/useApiData';

type Action = 'deposit' | 'withdraw' | 'transfer';

const ACTIONS: { key: Action; label: string }[] = [
  { key: 'deposit', label: 'Deposit' },
  { key: 'withdraw', label: 'Withdraw' },
  { key: 'transfer', label: 'Transfer' },
];

export default function MoveMoney() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ action?: string }>();

  const [action, setAction] = useState<Action>('deposit');
  const [accountId, setAccountId] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [recipient, setRecipient] = useState('');
  const [recipientName, setRecipientName] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const { data: accounts, loading, reload } = useApiData(() =>
    api.dashboard().then((dashboard) => dashboard.accounts),
  );

  // Honour the action passed from the dashboard's quick buttons.
  useEffect(() => {
    if (params.action && ACTIONS.some((item) => item.key === params.action)) {
      setAction(params.action as Action);
    }
  }, [params.action]);

  // Default to the first account that can actually transact.
  useEffect(() => {
    if (!accountId && accounts?.length) {
      const usable = accounts.find((item) => item.status === 'ACTIVE');
      setAccountId(usable?.id ?? accounts[0].id);
    }
  }, [accounts, accountId]);

  const selected = accounts?.find((item) => item.id === accountId) ?? null;

  // Confirm the recipient exists before the customer commits to a transfer.
  useEffect(() => {
    if (action !== 'transfer' || recipient.length !== 10) {
      setRecipientName(null);
      return;
    }
    let cancelled = false;
    api
      .lookupAccount(recipient)
      .then((result) => {
        if (!cancelled) setRecipientName(result.accountHolder);
      })
      .catch(() => {
        if (!cancelled) setRecipientName(null);
      });
    return () => {
      cancelled = true;
    };
  }, [action, recipient]);

  if (loading && !accounts) return <LoadingScreen label="Loading accounts" />;

  async function submit() {
    if (!accountId) return;
    setError(null);
    setSuccess(null);
    setSubmitting(true);

    try {
      const note = description.trim() || undefined;
      const result =
        action === 'deposit'
          ? await api.deposit(accountId, amount.trim(), note)
          : action === 'withdraw'
            ? await api.withdraw(accountId, amount.trim(), note)
            : await api.transfer(accountId, recipient.trim(), amount.trim(), note);

      setSuccess(
        `${labelFor(action)} of ${formatMoney(result.amount)} ${result.currency} completed. ` +
          `New balance ${formatMoney(result.balanceAfter)}.`,
      );
      setAmount('');
      setDescription('');
      if (action === 'transfer') setRecipient('');
      await reload();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'The request could not be completed.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  const amountValid = /^\d+(\.\d{1,2})?$/.test(amount.trim()) && Number(amount) > 0;
  const canSubmit =
    !!accountId &&
    amountValid &&
    selected?.status === 'ACTIVE' &&
    (action !== 'transfer' || recipient.length === 10);

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

        {action === 'transfer' ? (
          <Field
            label="Recipient account number"
            value={recipient}
            onChangeText={(text) =>
              setRecipient(text.replace(/\D/g, '').slice(0, 10))
            }
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
        ) : null}

        <Field
          label={`Amount (${selected?.currency ?? 'RWF'})`}
          value={amount}
          onChangeText={(text) => setAmount(text.replace(/[^\d.]/g, ''))}
          placeholder="0.00"
          keyboardType="decimal-pad"
          hint="Up to 2 decimal places"
        />

        <Field
          label="Note (optional)"
          value={description}
          onChangeText={setDescription}
          placeholder={
            action === 'transfer' ? 'Rent share' : 'What is this for?'
          }
          maxLength={140}
        />

        {selected && selected.status !== 'ACTIVE' ? (
          <ErrorBanner
            message={`This account is ${selected.status.toLowerCase()} and cannot be used.`}
          />
        ) : null}

        <Button
          label={`${labelFor(action)}${amountValid ? ` ${formatMoney(amount)}` : ''}`}
          onPress={submit}
          loading={submitting}
          disabled={!canSubmit}
        />
      </ScrollView>
    </KeyboardAvoidingView>
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

function labelFor(action: Action): string {
  return action === 'deposit'
    ? 'Deposit'
    : action === 'withdraw'
      ? 'Withdraw'
      : 'Transfer';
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  content: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxl,
  },
  title: { ...typography.title, color: colors.text, marginBottom: spacing.lg },
  switcher: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    padding: spacing.xs,
    marginBottom: spacing.xl,
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
});
