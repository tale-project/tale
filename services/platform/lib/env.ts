declare global {
  interface Window {
    __ENV__?: {
      SITE_URL?: string;
      BASE_PATH?: string;
      TRUSTED_HEADERS_ENABLED?: boolean;
      FILE_EVENTS_ENABLED?: boolean;
      SENTRY_DSN?: string;
      SENTRY_TRACES_SAMPLE_RATE?: number;
      TALE_VERSION?: string;
      SESSION_IDLE_TIMEOUT_MINUTES?: number;
    };
    __ACCEPT_LANGUAGE__?: string;
  }
}

export function getEnv(key: 'SITE_URL'): string;
export function getEnv(key: 'BASE_PATH'): string;
export function getEnv(key: 'TRUSTED_HEADERS_ENABLED'): boolean;
export function getEnv(key: 'FILE_EVENTS_ENABLED'): boolean;
export function getEnv(key: 'SENTRY_DSN'): string | undefined;
export function getEnv(key: 'SENTRY_TRACES_SAMPLE_RATE'): number;
export function getEnv(key: 'TALE_VERSION'): string | undefined;
export function getEnv(key: 'SESSION_IDLE_TIMEOUT_MINUTES'): number | undefined;
export function getEnv(
  key:
    | 'SITE_URL'
    | 'BASE_PATH'
    | 'TRUSTED_HEADERS_ENABLED'
    | 'FILE_EVENTS_ENABLED'
    | 'SENTRY_DSN'
    | 'SENTRY_TRACES_SAMPLE_RATE'
    | 'TALE_VERSION'
    | 'SESSION_IDLE_TIMEOUT_MINUTES',
): string | boolean | number | undefined {
  const value = window.__ENV__?.[key];
  if (value === undefined) {
    if (key === 'BASE_PATH') {
      return '';
    }
    if (key === 'TRUSTED_HEADERS_ENABLED' || key === 'FILE_EVENTS_ENABLED') {
      return false;
    }
    if (
      key === 'SENTRY_DSN' ||
      key === 'TALE_VERSION' ||
      key === 'SESSION_IDLE_TIMEOUT_MINUTES'
    ) {
      return undefined;
    }
    if (key === 'SENTRY_TRACES_SAMPLE_RATE') {
      return 1.0;
    }
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}
