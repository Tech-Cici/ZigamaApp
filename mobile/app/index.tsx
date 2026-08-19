import { Redirect } from 'expo-router';
import { useAuth } from '../src/auth';
import { LoadingScreen } from '../src/components';

/**
 * Entry point.
 *
 * This app is for account holders only — staff use the separate web console,
 * so there is nothing here to route them to.
 */
export default function Index() {
  const { user, restoring } = useAuth();

  if (restoring) return <LoadingScreen label="Restoring your session" />;
  if (!user) return <Redirect href="/login" />;

  return <Redirect href="/(customer)/dashboard" />;
}
