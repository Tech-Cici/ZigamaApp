import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const TOKEN_KEY = 'zigama.session.token';

/**
 * Where the session token is kept.
 *
 * On iOS and Android this is the hardware-backed keychain/keystore via
 * expo-secure-store — the right home for a bearer credential to a bank account.
 *
 * expo-secure-store has no web implementation and throws if called there, so
 * the web build falls back to localStorage. That is deliberately weaker: web
 * storage is readable by any script on the origin, so treat the web target as a
 * development and demo convenience rather than a way to ship a banking client.
 */
const isWeb = Platform.OS === 'web';

export const tokenStore = {
  async get(): Promise<string | null> {
    if (isWeb) {
      try {
        return globalThis.localStorage?.getItem(TOKEN_KEY) ?? null;
      } catch {
        return null;
      }
    }
    return SecureStore.getItemAsync(TOKEN_KEY);
  },

  async set(token: string): Promise<void> {
    if (isWeb) {
      try {
        globalThis.localStorage?.setItem(TOKEN_KEY, token);
      } catch {
        // Private browsing can block storage; the session still works for as
        // long as the tab is open.
      }
      return;
    }
    await SecureStore.setItemAsync(TOKEN_KEY, token);
  },

  async clear(): Promise<void> {
    if (isWeb) {
      try {
        globalThis.localStorage?.removeItem(TOKEN_KEY);
      } catch {
        // Nothing to clean up if storage was unavailable.
      }
      return;
    }
    await SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => {});
  },
};
