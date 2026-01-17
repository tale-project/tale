declare global {
  interface Window {
    __ENV__?: {
      SITE_URL?: string;
      MICROSOFT_AUTH_ENABLED?: boolean;
    };
  }
}

export function getEnv(key: 'SITE_URL'): string;
export function getEnv(key: 'MICROSOFT_AUTH_ENABLED'): boolean;
export function getEnv(key: 'SITE_URL' | 'MICROSOFT_AUTH_ENABLED'): string | boolean {
  const value = window.__ENV__?.[key];
  if (value === undefined) {
    if (key === 'MICROSOFT_AUTH_ENABLED') {
      return false;
    }
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}
