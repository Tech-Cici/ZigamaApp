import { Redirect } from 'expo-router';
import { useAuth } from '../src/auth';
import { LoadingScreen } from '../src/components';

/**
 * Entry point. Role decides the destination: customers get the banking
 * dashboard, managers and admins get the oversight console.
 */
export default function Index() {
  const { user, restoring } = useAuth();

  if (restoring) return <LoadingScreen label="Restoring your session" />;
  if (!user) return <Redirect href="/login" />;

  return user.role === 'CUSTOMER' ? (
    <Redirect href="/(customer)/dashboard" />
  ) : (
    <Redirect href="/(staff)/overview" />
  );
}
