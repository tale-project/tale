import { randomBytes } from 'node:crypto';

/**
 * Bifrost >= 1.6.9 requires at least 12 characters and each of uppercase,
 * lowercase, digit and special character when gateway auth is first enabled.
 * Keep all 32 random bytes (256 bits), appending only missing classes. The
 * base64url alphabet also stays safe in .env files and Basic-auth headers.
 * Callers retain existing credentials; this policy is for new passwords only.
 */
export function generateGatewayAdminPassword(
  entropy: (size: number) => Buffer = randomBytes,
): string {
  let password = entropy(32).toString('base64url');
  if (!/[A-Z]/.test(password)) password += 'A';
  if (!/[a-z]/.test(password)) password += 'a';
  if (!/[0-9]/.test(password)) password += '3';
  if (!/[^A-Za-z0-9]/.test(password)) password += '-';
  return password;
}
