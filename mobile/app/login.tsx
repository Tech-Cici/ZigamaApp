import { Redirect } from 'expo-router';
import { useState } from 'react';
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
import { ApiError } from '../src/api';
import { useAuth } from '../src/auth';
import { Button, ErrorBanner, Field, LoadingScreen } from '../src/components';
import { colors, radius, spacing, typography } from '../src/theme';

type Mode = 'customer' | 'staff';

export default function Login() {
  const { user, restoring, signInCustomer, signInStaff } = useAuth();
  const insets = useSafeAreaInsets();

  const [mode, setMode] = useState<Mode>('customer');
  const [accountNumber, setAccountNumber] = useState('');
  const [pin, setPin] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (restoring) return <LoadingScreen label="Restoring your session" />;
  if (user) {
    return user.role === 'CUSTOMER' ? (
      <Redirect href="/(customer)/dashboard" />
    ) : (
      <Redirect href="/(staff)/overview" />
    );
  }

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      if (mode === 'customer') {
        await signInCustomer(accountNumber.trim(), pin.trim());
      } else {
        await signInStaff(email.trim(), password);
      }
      // Navigation happens through the redirect above once `user` is set.
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Something went wrong. Try again.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmit =
    mode === 'customer'
      ? accountNumber.trim().length === 10 && pin.trim().length >= 4
      : email.includes('@') && password.length >= 8;

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + spacing.xxl },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.brand}>
          <View style={styles.logo}>
            <Text style={styles.logoText}>Z</Text>
          </View>
          <Text style={styles.title}>Zigama Bank</Text>
          <Text style={styles.subtitle}>
            {mode === 'customer'
              ? 'Sign in with your account number and PIN'
              : 'Staff sign in'}
          </Text>
        </View>

        <View style={styles.switcher}>
          <ModeTab
            label="Customer"
            active={mode === 'customer'}
            onPress={() => {
              setMode('customer');
              setError(null);
            }}
          />
          <ModeTab
            label="Staff"
            active={mode === 'staff'}
            onPress={() => {
              setMode('staff');
              setError(null);
            }}
          />
        </View>

        <ErrorBanner message={error} />

        {mode === 'customer' ? (
          <>
            <Field
              label="Account number"
              value={accountNumber}
              onChangeText={(text) =>
                setAccountNumber(text.replace(/\D/g, '').slice(0, 10))
              }
              placeholder="1000000001"
              keyboardType="number-pad"
              autoComplete="off"
              maxLength={10}
              hint="10 digits, shown on your card and statements"
            />
            <Field
              label="PIN"
              value={pin}
              onChangeText={(text) => setPin(text.replace(/\D/g, '').slice(0, 6))}
              placeholder="••••"
              keyboardType="number-pad"
              secureTextEntry
              maxLength={6}
            />
          </>
        ) : (
          <>
            <Field
              label="Work email"
              value={email}
              onChangeText={setEmail}
              placeholder="admin@zigama.test"
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="off"
            />
            <Field
              label="Password"
              value={password}
              onChangeText={setPassword}
              placeholder="••••••••"
              secureTextEntry
              autoCapitalize="none"
            />
          </>
        )}

        <Button
          label="Sign in"
          onPress={submit}
          loading={submitting}
          disabled={!canSubmit}
        />


        <View style={styles.demoBox}>
          <Text style={styles.demoTitle}>Demo credentials</Text>
          <Text style={styles.demoLine}>
            {mode === 'customer'
              ? 'Account 1000000001 · PIN 1234'
              : 'admin@zigama.test · Admin@12345'}
          </Text>
          <Text style={styles.demoLine}>
            {mode === 'customer'
              ? 'Account 1000000002 · PIN 2345'
              : 'manager@zigama.test · Manager@12345'}
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function ModeTab({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[styles.tab, active && styles.tabActive]}
    >
      <Text style={[styles.tabText, active && styles.tabTextActive]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  scroll: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxl,
  },
  brand: { alignItems: 'center', marginBottom: spacing.xl },
  logo: {
    width: 64,
    height: 64,
    borderRadius: radius.lg,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  logoText: { ...typography.display, color: colors.accent },
  title: { ...typography.title, color: colors.text },
  subtitle: {
    ...typography.body,
    color: colors.textMuted,
    marginTop: spacing.xs,
    textAlign: 'center',
  },
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
  demoBox: {
    marginTop: spacing.xxl,
    padding: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
  },
  demoTitle: {
    ...typography.label,
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },
  demoLine: { ...typography.caption, color: colors.textMuted, lineHeight: 20 },
});
