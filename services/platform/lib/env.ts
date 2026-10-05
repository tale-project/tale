declare global {
  interface Window {
    __ENV__?: {
      /**
       * The origin THIS page was served from when the deployment answers on
       * several domains (`server.ts` swaps it per request), else the
       * canonical `SITE_URL`. Absolute URLs built from it therefore stay on
       * the domain the browser is already on — where its session cookie is.
       */
      SITE_URL?: string;
      /** Every origin the deployment answers on, canonical first. */
      SITE_ORIGINS?: string[];
      BASE_PATH?: string;
      FILE_EVENTS_ENABLED?: boolean;
      SENTRY_DSN?: string;
      SENTRY_ENVIRONMENT?: string;
      SENTRY_TRACES_SAMPLE_RATE?: number;
      TALE_VERSION?: string;
      SESSION_IDLE_TIMEOUT_MINUTES?: number;
      /** The deployment's own support page, validated http(s) by `server.ts`. */
      TALE_CONTACT_SUPPORT_URL?: string;
    };
    __ACCEPT_LANGUAGE__?: string;
  }
}

export function getEnv(key: 'SITE_URL'): string;
export function getEnv(key: 'BASE_PATH'): string;
export function getEnv(key: 'FILE_EVENTS_ENABLED'): boolean;
export function getEnv(key: 'SENTRY_DSN'): string | undefined;
export function getEnv(key: 'SENTRY_ENVIRONMENT'): string | undefined;
export function getEnv(key: 'SENTRY_TRACES_SAMPLE_RATE'): number;
export function getEnv(key: 'TALE_VERSION'): string | undefined;
export function getEnv(key: 'SESSION_IDLE_TIMEOUT_MINUTES'): number | undefined;
export function getEnv(key: 'TALE_CONTACT_SUPPORT_URL'): string | undefined;
export function getEnv(
  key:
    | 'SITE_URL'
    | 'BASE_PATH'
    | 'FILE_EVENTS_ENABLED'
    | 'SENTRY_DSN'
    | 'SENTRY_ENVIRONMENT'
    | 'SENTRY_TRACES_SAMPLE_RATE'
    | 'TALE_VERSION'
    | 'SESSION_IDLE_TIMEOUT_MINUTES'
    | 'TALE_CONTACT_SUPPORT_URL',
): string | boolean | number | undefined {
  const value = window.__ENV__?.[key];
  if (value === undefined) {
    if (key === 'BASE_PATH') {
      return '';
    }
    if (key === 'FILE_EVENTS_ENABLED') {
      return false;
    }
    if (
      key === 'SENTRY_DSN' ||
      key === 'SENTRY_ENVIRONMENT' ||
      key === 'TALE_VERSION' ||
      key === 'SESSION_IDLE_TIMEOUT_MINUTES' ||
      key === 'TALE_CONTACT_SUPPORT_URL'
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
