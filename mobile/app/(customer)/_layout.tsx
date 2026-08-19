import { Redirect, Tabs } from 'expo-router';
import { useAuth } from '../../src/auth';
import { LoadingScreen } from '../../src/components';
import { Icon } from '../../src/icons';
import { colors } from '../../src/theme';

export default function CustomerLayout() {
  const { user, restoring } = useAuth();

  if (restoring) return <LoadingScreen />;
  if (!user) return <Redirect href="/login" />;
  // Staff cannot sign in here at all — the login screen only accepts an account
  // number and PIN — but if a staff token somehow reaches this app, send them
  // back rather than rendering an empty customer dashboard.
  if (user.role !== 'CUSTOMER') return <Redirect href="/login" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      }}
    >
      <Tabs.Screen
        name="dashboard"
        options={{
          title: 'Home',
          tabBarIcon: ({ color }) => <Icon name="home" color={color} />,
        }}
      />
      <Tabs.Screen
        name="move"
        options={{
          title: 'Move money',
          tabBarIcon: ({ color }) => <Icon name="exchange" color={color} />,
        }}
      />
      <Tabs.Screen
        name="activity"
        options={{
          title: 'Activity',
          tabBarIcon: ({ color }) => <Icon name="activity" color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color }) => <Icon name="person" color={color} />,
        }}
      />
    </Tabs>
  );
}
