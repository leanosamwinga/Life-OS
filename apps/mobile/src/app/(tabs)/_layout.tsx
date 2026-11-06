import { Tabs } from 'expo-router/js-tabs';
import { View } from 'react-native';
import { colors } from '@/theme';

/** Wireframe tab icon: a rounded square, filled when the tab is active. */
function TabIcon({ focused }: { focused: boolean }) {
  return (
    <View
      style={{
        width: 24,
        height: 24,
        borderRadius: 6,
        borderWidth: 2,
        borderColor: focused ? colors.fill : colors.textSecondary,
        backgroundColor: focused ? colors.fill : 'transparent',
      }}
    />
  );
}

const TABS = [
  { name: 'index', title: 'Today' },
  { name: 'health', title: 'Health' },
  { name: 'week', title: 'Week' },
  { name: 'money', title: 'Money' },
  { name: 'me', title: 'Me' },
] as const;

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.text,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarLabelStyle: { fontSize: 12, fontWeight: '600' },
        tabBarStyle: { backgroundColor: colors.background, borderTopColor: colors.border },
      }}
    >
      {TABS.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            title: tab.title,
            tabBarAccessibilityLabel: tab.title,
            tabBarButtonTestID: `tab-${tab.title.toLowerCase()}`,
            tabBarIcon: ({ focused }) => <TabIcon focused={focused} />,
          }}
        />
      ))}
    </Tabs>
  );
}
