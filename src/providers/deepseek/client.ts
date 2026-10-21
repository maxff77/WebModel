export const DEEPSEEK_WEB_BASE_URL = 'https://chat.deepseek.com';

/** localStorage key where the web client persists its x-device-id. */
export const DEEPSEEK_DEVICE_ID_KEY = 'deepseek-device-id:chat';

/** Identity headers the web client sends on every /api/v0 request. */
export const DEEPSEEK_CLIENT_HEADER_KEYS = [
  'x-client-platform',
  'x-client-version',
  'x-client-locale',
  'x-client-timezone-offset',
  'x-client-bundle-id',
  'x-device-id',
  'x-device-model',
] as const;

/** Pick the identity headers from a request captured off the live page. */
export function pickClientHeaders(
  headers: Record<string, string | undefined>,
): Record<string, string> {
  const picked: Record<string, string> = {};
  for (const key of DEEPSEEK_CLIENT_HEADER_KEYS) {
    const value = headers[key];
    if (value !== undefined) picked[key] = value;
  }
  return picked;
}

/**
 * Identity headers the DeepSeek web client sends on every /api/v0 call.
 * Captured from a live Chrome session on 2026-10-20 (client version 2.5.0).
 * Without them the bridge's requests look like a non-web client.
 */
export function deepseekClientHeaders(deviceId: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    'x-client-platform': 'web',
    'x-client-version': '2.5.0',
    'x-client-locale': 'en_US',
    'x-client-timezone-offset': String(-new Date().getTimezoneOffset() * 60),
    'x-client-bundle-id': 'com.deepseek.chat',
    'x-device-model': '',
  };
  if (deviceId) headers['x-device-id'] = deviceId;
  return headers;
}
