import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
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
import { api, ApiError, type PendingCustomer } from '../../src/api';
import { useAuth } from '../../src/auth';
import {
  Button,
  Card,
  EmptyState,
  ErrorBanner,
  Field,
  LoadingScreen,
  Pill,
  SectionTitle,
  SuccessBanner,
} from '../../src/components';
import { confirmAction } from '../../src/confirm';
import { formatAccountNumber, formatDate } from '../../src/format';
import { colors, radius, spacing, typography } from '../../src/theme';
import { useApiData } from '../../src/useApiData';

/**
 * Onboarding is deliberately split by role: an administrator opens the record,
 * a manager signs it off. Each sees only the half they are allowed to perform,
 * so the separation of duties is visible in the product, not just enforced by
 * the API.
 */
export default function Onboarding() {
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const isAdmin = user?.role === 'ADMIN';

  const { data, error, loading, refreshing, refresh, reload } = useApiData(
    useCallback(() => api.pendingCustomers(), []),
  );

  if (loading && !data) return <LoadingScreen label="Loading applications" />;

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
          <RefreshControl refreshing={refreshing} onRefresh={refresh} />
        }
      >
        <Text style={styles.title}>Onboarding</Text>
        <ErrorBanner message={error} />

        {isAdmin ? (
          <NewCustomerForm onCreated={reload} />
        ) : (
          <ApprovalQueue
            applications={data?.data ?? []}
            currentUserId={user?.id ?? ''}
            onDecided={reload}
          />
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// -----------------------------------------------------------------------
// Admin: open a new account
// -----------------------------------------------------------------------

function NewCustomerForm({ onCreated }: { onCreated: () => void }) {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const canSubmit =
    fullName.trim().length >= 3 && email.includes('@') && pin.length >= 4;

  async function submit() {
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      const created = await api.createCustomer({
        fullName: fullName.trim(),
        email: email.trim(),
        phone: phone.trim() || undefined,
        pin,
      });
      setSuccess(
        `Account ${formatAccountNumber(created.accounts[0].accountNumber)} opened for ${created.fullName}. ` +
          'A branch manager must approve it before they can sign in.',
      );
      setFullName('');
      setEmail('');
      setPhone('');
      setPin('');
      onCreated();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Could not open the account.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <SectionTitle>Open a customer account</SectionTitle>
      <Text style={styles.note}>
        You cannot approve accounts you open. A branch manager reviews them.
      </Text>

      <ErrorBanner message={error} />
      <SuccessBanner message={success} />

      <Field
        label="Full name"
        value={fullName}
        onChangeText={setFullName}
        placeholder="Grace Uwase"
        autoCapitalize="words"
      />
      <Field
        label="Email"
        value={email}
        onChangeText={setEmail}
        placeholder="customer@example.com"
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="off"
      />
      <Field
        label="Phone (optional)"
        value={phone}
        onChangeText={setPhone}
        placeholder="+250 780 000 000"
        keyboardType="phone-pad"
      />
      <Field
        label="Initial PIN"
        value={pin}
        onChangeText={(text) => setPin(text.replace(/\D/g, '').slice(0, 6))}
        placeholder="••••"
        keyboardType="number-pad"
        secureTextEntry
        maxLength={6}
        hint="Chosen by the customer at the desk. Not a repeated digit or a run like 1234."
      />

      <Button
        label="Open account"
        onPress={submit}
        loading={submitting}
        disabled={!canSubmit}
      />
    </>
  );
}

// -----------------------------------------------------------------------
// Manager: approve or reject
// -----------------------------------------------------------------------

function ApprovalQueue({
  applications,
  currentUserId,
  onDecided,
}: {
  applications: PendingCustomer[];
  currentUserId: string;
  onDecided: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const decide = useCallback(
    async (application: PendingCustomer, approve: boolean) => {
      setError(null);

      if (approve) {
        const ok = await confirmAction({
          title: 'Approve this application?',
          message: `${application.fullName} will be able to sign in and transact.`,
          confirmLabel: 'Approve',
        });
        if (!ok) return;
      }

      setBusyId(application.id);
      try {
        if (approve) {
          await api.approveCustomer(application.id);
        } else {
          await api.rejectCustomer(
            application.id,
            'Declined during branch review',
          );
        }
        onDecided();
      } catch (err) {
        setError(
          err instanceof ApiError ? err.message : 'Could not record the decision.',
        );
      } finally {
        setBusyId(null);
      }
    },
    [onDecided],
  );

  return (
    <>
      <SectionTitle>Awaiting your approval</SectionTitle>
      <Text style={styles.note}>
        You cannot approve an application you created yourself.
      </Text>

      <ErrorBanner message={error} />

      {applications.length === 0 ? (
        <Card>
          <EmptyState message="Nothing waiting. New applications from an administrator will appear here." />
        </Card>
      ) : (
        applications.map((application) => {
          const ownWork = application.createdBy?.id === currentUserId;
          const busy = busyId === application.id;

          return (
            <Card key={application.id} style={styles.card}>
              <View style={styles.cardTop}>
                <View style={styles.identity}>
                  <Text style={styles.name}>{application.fullName}</Text>
                  <Text style={styles.email}>{application.email}</Text>
                </View>
                <Pill label="Pending" tone="warning" />
              </View>

              {application.accounts.map((account) => (
                <Text key={account.accountNumber} style={styles.accountLine}>
                  {formatAccountNumber(account.accountNumber)} ·{' '}
                  {account.type === 'CHECKING' ? 'Current' : 'Savings'}
                </Text>
              ))}

              <Text style={styles.meta}>
                Opened by {application.createdBy?.fullName ?? 'unknown'} on{' '}
                {formatDate(application.createdAt)}
              </Text>

              {ownWork ? (
                <Text style={styles.blocked}>
                  You opened this account, so someone else must approve it.
                </Text>
              ) : (
                <View style={styles.actions}>
                  <Pressable
                    accessibilityRole="button"
                    disabled={busy}
                    onPress={() => void decide(application, false)}
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
                    onPress={() => void decide(application, true)}
                    style={({ pressed }) => [
                      styles.action,
                      styles.approve,
                      pressed && { opacity: 0.7 },
                    ]}
                  >
                    {busy ? (
                      <ActivityIndicator size="small" color={colors.textInverse} />
                    ) : (
                      <Text style={styles.approveText}>Approve</Text>
                    )}
                  </Pressable>
                </View>
              )}
            </Card>
          );
        })
      )}
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  content: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxl,
  },
  title: { ...typography.title, color: colors.text, marginBottom: spacing.lg },
  note: {
    ...typography.caption,
    color: colors.textMuted,
    marginBottom: spacing.lg,
  },
  card: { marginBottom: spacing.md },
  cardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  identity: { flex: 1, paddingRight: spacing.md },
  name: { ...typography.heading, color: colors.text },
  email: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  accountLine: {
    ...typography.body,
    color: colors.text,
    letterSpacing: 1,
    marginTop: spacing.sm,
  },
  meta: { ...typography.caption, color: colors.textMuted, marginTop: spacing.sm },
  blocked: {
    ...typography.caption,
    color: colors.warning,
    marginTop: spacing.md,
  },
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
