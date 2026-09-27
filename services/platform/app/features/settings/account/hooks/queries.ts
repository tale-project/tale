import {
  passwordPolicyConfigSchema,
  type PasswordPolicyConfig,
} from '@tale/shared/schemas/governance';
import { useMemo } from 'react';

import { useBackendQuery } from '@/app/hooks/use-backend-query';

/**
 * The rules the signed-in user's OWN password is held to: the strictest
 * password policy across every organization they belong to, which is what
 * the password write enforces. Any member can read it; the per-organization
 * policy (`usePasswordPolicy`) is an admin read.
 *
 * `null` while the read is in flight, or after it failed. A form then asks
 * for nothing beyond a value and lets the write's `password_policy_violation`
 * decide: `DEFAULT_PASSWORD_POLICY` would be a guess, looser than a stricter
 * organization's rules or tighter than a relaxed one's.
 */
export function useMyPasswordPolicy(): PasswordPolicyConfig | null {
  const { data } = useBackendQuery('users/queries:getMyPasswordPolicy');
  return useMemo(() => {
    const parsed = passwordPolicyConfigSchema.safeParse(data);
    return parsed.success ? parsed.data : null;
  }, [data]);
}
