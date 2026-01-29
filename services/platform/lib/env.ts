declare global {
  interface Window {
    __ENV__?: {
      SITE_URL?: string;
      MICROSOFT_AUTH_ENABLED?: boolean;
      POSTHOG_KEY?: string;
      POSTHOG_HOST?: string;
    };
  }
}

export function getEnv(key: 'SITE_URL'): string;
export function getEnv(key: 'MICROSOFT_AUTH_ENABLED'): boolean;
export function getEnv(key: 'POSTHOG_KEY'): string | undefined;
export function getEnv(key: 'POSTHOG_HOST'): string;
export function getEnv(
  key: 'SITE_URL' | 'MICROSOFT_AUTH_ENABLED' | 'POSTHOG_KEY' | 'POSTHOG_HOST',
): string | boolean | undefined {
  const value = window.__ENV__?.[key];
  if (value === undefined) {
    if (key === 'MICROSOFT_AUTH_ENABLED') {
      return false;
    }
    if (key === 'POSTHOG_KEY') {
      return undefined;
    }
    if (key === 'POSTHOG_HOST') {
      return 'https://us.i.posthog.com';
    }
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}
