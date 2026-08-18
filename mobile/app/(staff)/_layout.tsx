import { Redirect, Tabs } from 'expo-router';
import { useAuth } from '../../src/auth';
import { LoadingScreen } from '../../src/components';
import { Icon } from '../../src/icons';
import { colors } from '../../src/theme';

export default function StaffLayout() {
  const { user, restoring } = useAuth();

  if (restoring) return <LoadingScreen />;
  if (!user) return <Redirect href="/login" />;
  if (user.role === 'CUSTOMER') return <Redirect href="/(customer)/dashboard" />;

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
        name="overview"
        options={{
          title: 'Overview',
          tabBarIcon: ({ color }) => <Icon name="home" color={color} />,
        }}
      />
      <Tabs.Screen
        name="onboarding"
        options={{
          // An admin opens accounts here; a manager approves them.
          title: user.role === 'ADMIN' ? 'New account' : 'Approvals',
          tabBarIcon: ({ color }) => <Icon name="approve" color={color} />,
        }}
      />
      <Tabs.Screen
        name="cash"
        options={{
          title: 'Cash desk',
          tabBarIcon: ({ color }) => <Icon name="exchange" color={color} />,
        }}
      />
      <Tabs.Screen
        name="customers"
        options={{
          title: 'Customers',
          tabBarIcon: ({ color }) => <Icon name="people" color={color} />,
        }}
      />
      <Tabs.Screen
        name="transactions"
        options={{
          title: 'Transactions',
          tabBarIcon: ({ color }) => <Icon name="activity" color={color} />,
        }}
      />
      <Tabs.Screen
        name="account"
        options={{
          title: 'Account',
          tabBarIcon: ({ color }) => <Icon name="person" color={color} />,
        }}
      />
    </Tabs>
  );
}
