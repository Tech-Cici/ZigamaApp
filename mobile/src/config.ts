import Constants from 'expo-constants';

const API_PORT = 3000;

/**
 * Where the API lives.
 *
 * In development, Metro already knows the machine's LAN address, so the host is
 * derived from it — that makes the app work on a real device over Wi-Fi with no
 * hand-edited IP addresses. `localhost` would mean the phone itself.
 *
 * A standalone build has no Metro, so the URL must be baked in at build time
 * through EXPO_PUBLIC_API_URL. Expo inlines `process.env.EXPO_PUBLIC_*` into the
 * bundle, so it is read at build time, not runtime — changing it means
 * rebuilding.
 */
function resolveApiUrl(): string {
  const explicit = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, '');

  const hostUri =
    Constants.expoConfig?.hostUri ??
    (Constants.expoGoConfig as { debuggerHost?: string } | undefined)
      ?.debuggerHost;

  const host = hostUri?.split(':')[0];
  if (host) return `http://${host}:${API_PORT}/api`;

  // No build-time URL and no Metro: this is a release build that was compiled
  // without EXPO_PUBLIC_API_URL. Falling back to localhost here would produce a
  // silent "could not reach the server" on every screen, and the cause would be
  // invisible from inside the app. Fail loudly instead — the mistake belongs to
  // the build, not the user.
  throw new Error(
    'EXPO_PUBLIC_API_URL was not set when this app was built. ' +
      'Rebuild with: EXPO_PUBLIC_API_URL=https://your-api.example.com/api',
  );
}

export const API_URL = resolveApiUrl();

/** True when the API is a remote deployment rather than a dev machine. */
export const IS_REMOTE_API = /^https:/i.test(API_URL);

export const CURRENCY = 'RWF';
