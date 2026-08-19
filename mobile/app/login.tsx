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

export default function Login() {
  const { user, restoring, signInCustomer } = useAuth();
  const insets = useSafeAreaInsets();

  const [accountNumber, setAccountNumber] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (restoring) return <LoadingScreen label="Restoring your session" />;
  if (user) return <Redirect href="/(customer)/dashboard" />;

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      await signInCustomer(accountNumber.trim(), pin.trim());
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
    accountNumber.trim().length === 10 && pin.trim().length >= 4;

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
            Sign in with your account number and PIN
          </Text>
        </View>

        <ErrorBanner message={error} />

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

        <Button
          label="Sign in"
          onPress={submit}
          loading={submitting}
          disabled={!canSubmit}
        />

        <View style={styles.demoBox}>
          <Text style={styles.demoTitle}>Demo credentials</Text>
          <Text style={styles.demoLine}>Account 1000000001 · PIN 1234</Text>
          <Text style={styles.demoLine}>Account 1000000002 · PIN 2345</Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
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
