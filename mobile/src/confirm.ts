import { Alert, Platform } from 'react-native';

/**
 * Confirmation prompt for destructive actions.
 *
 * `Alert.alert` is a no-op on react-native-web, which would leave a "Freeze
 * account?" prompt silently doing nothing on the web build — the worst possible
 * outcome for a guard on a destructive action. Web falls back to
 * `window.confirm`.
 */
export function confirmAction(options: {
  title: string;
  message: string;
  confirmLabel: string;
  destructive?: boolean;
}): Promise<boolean> {
  const { title, message, confirmLabel, destructive } = options;

  if (Platform.OS === 'web') {
    const confirmed =
      globalThis.confirm?.(`${title}\n\n${message}`) ?? false;
    return Promise.resolve(confirmed);
  }

  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      {
        text: confirmLabel,
        style: destructive ? 'destructive' : 'default',
        onPress: () => resolve(true),
      },
    ]);
  });
}
