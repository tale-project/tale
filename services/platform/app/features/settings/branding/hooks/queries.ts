import { configKeys } from '@/app/hooks/config-query-keys';
import { useActionQuery } from '@/app/hooks/use-action-query';

/**
 * Read branding for an organization. Pass the org id to read that org's
 * branding; omit it to read the platform `default` bucket (the pre-auth shell,
 * which has no org in scope). The org id is part of the query key, so switching
 * orgs swaps to that org's cached branding instead of showing the previous
 * org's stale values.
 */
export function useBranding(organizationId?: string) {
  return useActionQuery(
    [...configKeys.type('branding'), organizationId ?? 'default'],
    'branding/file_actions:readBranding',
    organizationId ? { organizationId } : {},
  );
}
