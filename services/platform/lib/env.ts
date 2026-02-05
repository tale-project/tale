declare global {
  interface Window {
    __ENV__?: {
      SITE_URL?: string;
      MICROSOFT_AUTH_ENABLED?: boolean;
      SENTRY_DSN?: string;
      SENTRY_TRACES_SAMPLE_RATE?: number;
      TALE_VERSION?: string;
    };
  }
}

export function getEnv(key: 'SITE_URL'): string;
export function getEnv(key: 'MICROSOFT_AUTH_ENABLED'): boolean;
export function getEnv(key: 'SENTRY_DSN'): string | undefined;
export function getEnv(key: 'SENTRY_TRACES_SAMPLE_RATE'): number;
export function getEnv(key: 'TALE_VERSION'): string | undefined;
export function getEnv(
  key:
    | 'SITE_URL'
    | 'MICROSOFT_AUTH_ENABLED'
    | 'SENTRY_DSN'
    | 'SENTRY_TRACES_SAMPLE_RATE'
    | 'TALE_VERSION',
): string | boolean | number | undefined {
  const value = window.__ENV__?.[key];
  if (value === undefined) {
    if (key === 'MICROSOFT_AUTH_ENABLED') {
      return false;
    }
    if (key === 'SENTRY_DSN' || key === 'TALE_VERSION') {
      return undefined;
    }
    if (key === 'SENTRY_TRACES_SAMPLE_RATE') {
      return 1.0;
    }
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}
