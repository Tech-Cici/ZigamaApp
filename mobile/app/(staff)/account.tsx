import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../src/auth';
import { Button, Card, SectionTitle } from '../../src/components';
import { API_URL } from '../../src/config';
import { colors, spacing, typography } from '../../src/theme';

export default function StaffAccount() {
  const { user, signOut } = useAuth();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const isAdmin = user?.role === 'ADMIN';

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
      <Text style={styles.title}>Account</Text>

      <Card style={styles.card}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {user?.fullName?.[0]?.toUpperCase() ?? '?'}
          </Text>
        </View>
        <Text style={styles.name}>{user?.fullName}</Text>
        <Text style={styles.email}>{user?.email}</Text>
        <Text style={styles.role}>
          {isAdmin ? 'Administrator' : 'Branch manager'}
        </Text>
      </Card>

      <SectionTitle>What you can do</SectionTitle>
      <Card style={styles.card}>
        <Permission label="View platform statistics" allowed />
        <Permission label="View all customers and balances" allowed />
        <Permission label="View every transaction" allowed />
        <Permission label="Freeze and unfreeze accounts" allowed={isAdmin} />
        <Permission label="Activate and deactivate users" allowed={isAdmin} />
        <Permission label="Read the audit log" allowed={isAdmin} last />
      </Card>

      <SectionTitle>Connection</SectionTitle>
      <Card style={styles.card}>
        <Text style={styles.rowLabel}>API endpoint</Text>
        <Text style={styles.mono}>{API_URL}</Text>
      </Card>

      <Button label="Sign out" onPress={handleSignOut} variant="secondary" />
    </ScrollView>
  );
}

function Permission({
  label,
  allowed,
  last,
}: {
  label: string;
  allowed: boolean;
  last?: boolean;
}) {
  return (
    <View style={[styles.permission, !last && styles.permissionDivider]}>
      <Text style={styles.permissionLabel}>{label}</Text>
      <Text
        style={[
          styles.permissionValue,
          { color: allowed ? colors.credit : colors.textMuted },
        ]}
      >
        {allowed ? 'Yes' : 'No'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl },
  title: { ...typography.title, color: colors.text, marginBottom: spacing.lg },
  card: { marginBottom: spacing.md },
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
  role: {
    ...typography.label,
    color: colors.primaryLight,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  permission: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  permissionDivider: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  permissionLabel: { ...typography.body, color: colors.text, flex: 1 },
  permissionValue: { ...typography.label },
  rowLabel: { ...typography.label, color: colors.textMuted },
  mono: { ...typography.caption, color: colors.text, marginTop: spacing.xs },
});
