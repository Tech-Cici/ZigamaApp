import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../../src/api';
import { useAuth } from '../../src/auth';
import {
  Card,
  ErrorBanner,
  LoadingScreen,
  Pill,
  SectionTitle,
} from '../../src/components';
import { formatMoney } from '../../src/format';
import { colors, radius, spacing, typography } from '../../src/theme';
import { useApiData } from '../../src/useApiData';

export default function Overview() {
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const { data, error, loading, refreshing, refresh } = useApiData(() =>
    api.adminStats(),
  );

  if (loading && !data) return <LoadingScreen label="Loading platform stats" />;

  return (
    <View style={styles.flex}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.lg }]}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.greeting}>{user?.fullName}</Text>
            <Text style={styles.role}>
              {user?.role === 'ADMIN' ? 'Administrator' : 'Branch manager'}
            </Text>
          </View>
          <Pill
            label={user?.role === 'ADMIN' ? 'Full access' : 'Read only'}
            tone={user?.role === 'ADMIN' ? 'positive' : 'neutral'}
          />
        </View>

        <View style={styles.holdingsBlock}>
          <Text style={styles.holdingsLabel}>Total customer holdings</Text>
          <Text style={styles.holdingsValue}>
            {data ? formatMoney(data.totalHoldings) : '—'}
            <Text style={styles.currency}> {data?.currency ?? 'RWF'}</Text>
          </Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} />
        }
      >
        <ErrorBanner message={error} />

        <SectionTitle>Today</SectionTitle>
        <View style={styles.grid}>
          <Stat
            label="Transactions"
            value={data ? String(data.transactionsToday) : '—'}
          />
          <Stat
            label="Volume moved"
            value={data ? formatMoney(data.volumeToday) : '—'}
          />
        </View>

        <SectionTitle>Customers</SectionTitle>
        <View style={styles.grid}>
          <Stat
            label="Approved"
            value={data ? String(data.activeCustomers) : '—'}
          />
          <Stat
            label="Awaiting approval"
            value={data ? String(data.pendingApprovals) : '—'}
            tone={data && data.pendingApprovals > 0 ? 'warning' : 'neutral'}
          />
        </View>

        <SectionTitle>Accounts</SectionTitle>
        <View style={styles.grid}>
          <Stat
            label="Open accounts"
            value={data ? String(data.totalAccounts) : '—'}
          />
          <Stat
            label="Frozen"
            value={data ? String(data.frozenAccounts) : '—'}
            tone={data && data.frozenAccounts > 0 ? 'warning' : 'neutral'}
          />
        </View>

        <SectionTitle>All time</SectionTitle>
        <Card>
          <Text style={styles.statLabel}>Total volume processed</Text>
          <Text style={styles.statValue}>
            {data ? formatMoney(data.volumeAllTime) : '—'}{' '}
            <Text style={styles.statUnit}>{data?.currency}</Text>
          </Text>
        </Card>
      </ScrollView>
    </View>
  );
}

function Stat({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  tone?: 'neutral' | 'warning';
}) {
  return (
    <Card style={styles.statCard}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text
        style={[
          styles.statValue,
          tone === 'warning' && { color: colors.warning },
        ]}
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {value}
      </Text>
    </Card>
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
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  greeting: { ...typography.heading, color: colors.textInverse },
  role: { ...typography.caption, color: colors.surfaceMuted, opacity: 0.8 },
  holdingsBlock: { marginTop: spacing.xl },
  holdingsLabel: {
    ...typography.caption,
    color: colors.surfaceMuted,
    opacity: 0.8,
  },
  holdingsValue: {
    ...typography.display,
    color: colors.textInverse,
    marginTop: spacing.xs,
  },
  currency: { ...typography.body, color: colors.accent },
  content: { padding: spacing.xl, paddingBottom: spacing.xxl },
  grid: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  statCard: { flex: 1 },
  statLabel: { ...typography.caption, color: colors.textMuted },
  statValue: {
    ...typography.title,
    color: colors.text,
    marginTop: spacing.xs,
  },
  statUnit: { ...typography.caption, color: colors.textMuted },
});
