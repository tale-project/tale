import { hashPassword } from 'better-auth/crypto';
import { z } from 'zod';

import { passwordPolicyViolations } from '../../../../../services/platform/lib/shared/schemas/password';

/** Better Auth's credential hash (`hashPassword` in the pinned 1.6 line): a
 * 16-byte hex salt and a 64-byte scrypt key. Anything else could never verify
 * at sign-in, so a declaration carrying it is refused before any write. */
export const passwordHashSchema = z
  .string()
  .regex(/^[0-9a-f]{32}:[0-9a-f]{128}(?![\s\S])/);

/** The platform's default password policy rules this password fails, by name. */
export function passwordPolicyFailures(password: string): string[] {
  return passwordPolicyViolations(password);
}

/** Hash exactly as the platform stores a credential password. */
export async function hashAccountPassword(password: string): Promise<string> {
  return passwordHashSchema.parse(await hashPassword(password));
}
