import { useActionQuery } from '@/app/hooks/use-action-query';
import { api } from '@/convex/_generated/api';

/**
 * Slack "bring your own app" setup info: the Events API Request URL, the OAuth
 * redirect URL, the bot scopes, and a ready-to-paste Slack App Manifest. Keyed
 * on organizationId (not a credential) so it is available before any Slack
 * credential exists — the admin needs these to create the Slack app first.
 */
export function useSlackSetupInfo(organizationId: string, enabled = true) {
  return useActionQuery(
    ['slack', 'setup-info', organizationId],
    api.integrations.actions.getSlackSetupInfo,
    { organizationId },
    { enabled: enabled && !!organizationId },
  );
}
