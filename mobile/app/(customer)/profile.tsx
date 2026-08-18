import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../../src/api';
import { useAuth } from '../../src/auth';
import { Button, Card, SectionTitle } from '../../src/components';
import { API_URL } from '../../src/config';
import { formatAccountNumber, formatMoney } from '../../src/format';
import { colors, spacing, typography } from '../../src/theme';
import { useApiData } from '../../src/useApiData';

export default function Profile() {
  const { user, signOut } = useAuth();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { data } = useApiData(() => api.dashboard());

  async function handleSignOut() {
    await signOut();
    router.replace('/login');
  }

  return (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + spacing.lg },
      ]}
    >
      <Text style={styles.title}>Profile</Text>

      <Card style={styles.card}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {user?.fullName?.[0]?.toUpperCase() ?? '?'}
          </Text>
        </View>
        <Text style={styles.name}>{user?.fullName}</Text>
        <Text style={styles.email}>{user?.email}</Text>
      </Card>

      <SectionTitle>Accounts</SectionTitle>
      {data?.accounts.map((account) => (
        <Card key={account.id} style={styles.card}>
          <View style={styles.rowBetween}>
            <Text style={styles.rowLabel}>
              {account.type === 'CHECKING' ? 'Current' : 'Savings'}
            </Text>
            <Text style={styles.rowValue}>
              {formatMoney(account.balance)} {account.currency}
            </Text>
          </View>
          <Text style={styles.accountNumber}>
            {formatAccountNumber(account.accountNumber)}
          </Text>
        </Card>
      ))}

      <SectionTitle>Connection</SectionTitle>
      <Card style={styles.card}>
        <Text style={styles.rowLabel}>API endpoint</Text>
        <Text style={styles.mono}>{API_URL}</Text>
      </Card>

      <Button label="Sign out" onPress={handleSignOut} variant="secondary" />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl },
  title: { ...typography.title, color: colors.text, marginBottom: spacing.lg },
  card: { marginBottom: spacing.md, alignItems: 'stretch' },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: spacing.md,
  },
  avatarText: { ...typography.title, color: colors.accent },
  name: { ...typography.heading, color: colors.text, textAlign: 'center' },
  email: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: 2,
  },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  rowLabel: { ...typography.label, color: colors.textMuted },
  rowValue: { ...typography.body, color: colors.text, fontWeight: '600' },
  accountNumber: {
    ...typography.body,
    color: colors.text,
    letterSpacing: 1,
    marginTop: spacing.xs,
  },
  mono: {
    ...typography.caption,
    color: colors.text,
    marginTop: spacing.xs,
  },
});
