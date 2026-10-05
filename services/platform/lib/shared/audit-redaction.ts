import { isRecord } from '../utils/type-utils.ts';

const SENSITIVE_FIELDS = new Set(
  [
    'password',
    'passwordHash',
    'secret',
    'apiKey',
    'apiSecret',
    'token',
    'accessToken',
    'refreshToken',
    'privateKey',
    'clientSecret',
    'credentials',
    'authorization',
    'auth',
    'bearer',
    'jwt',
    'sessionToken',
    'cookieValue',
    'oauthToken',
    'encryptionKey',
    'decryptionKey',
    'symmetricKey',
    'asymmetricKey',
    'salt',
    'iv',
    'nonce',
    'hmac',
    'signature',
    'totpcode',
    'totpsecret',
    'backupcode',
    'backupcodes',
  ].map((key) => key.toLowerCase()),
);

function isSensitiveKey(key: string): boolean {
  const lowerKey = key.toLowerCase();
  return (
    SENSITIVE_FIELDS.has(lowerKey) ||
    lowerKey.includes('password') ||
    lowerKey.includes('secret') ||
    lowerKey.includes('token') ||
    lowerKey.includes('apikey') ||
    lowerKey.includes('api_key') ||
    lowerKey.includes('credential') ||
    lowerKey.includes('totp') ||
    lowerKey.includes('backupcode')
  );
}

function redactValue(value: unknown): unknown {
  if (isRecord(value)) return redactSensitiveFields(value);
  if (Array.isArray(value)) return value.map(redactValue);
  return value;
}

export function redactSensitiveFields(
  obj: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!obj || typeof obj !== 'object') return obj;
  return Object.fromEntries(
    Object.entries(obj).map(([key, value]) => [
      key,
      isSensitiveKey(key) ? '[REDACTED]' : redactValue(value),
    ]),
  );
}
