declare global {
  interface Window {
    __ENV__?: {
      SITE_URL?: string;
      MICROSOFT_AUTH_ENABLED?: boolean;
      SENTRY_DSN?: string;
    };
  }
}

export function getEnv(key: 'SITE_URL'): string;
export function getEnv(key: 'MICROSOFT_AUTH_ENABLED'): boolean;
export function getEnv(key: 'SENTRY_DSN'): string | undefined;
export function getEnv(
  key: 'SITE_URL' | 'MICROSOFT_AUTH_ENABLED' | 'SENTRY_DSN',
): string | boolean | undefined {
  const value = window.__ENV__?.[key];
  if (value === undefined) {
    if (key === 'MICROSOFT_AUTH_ENABLED') {
      return false;
    }
    if (key === 'SENTRY_DSN') {
      return undefined;
    }
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}
