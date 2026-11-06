import { Text } from '@tale/ui/text';
import { createFileRoute } from '@tanstack/react-router';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';

import { ApiKeyScopeFilter } from '@/app/features/settings/api-keys/components/api-key-scope-filter';
import { ApiKeysTable } from '@/app/features/settings/api-keys/components/api-keys-table';
import {
  apiKeysQuery,
  useApiKeys,
} from '@/app/features/settings/api-keys/hooks/use-api-keys';
import type { ApiKeyListScope } from '@/app/features/settings/api-keys/types';
import { SettingsPage } from '@/app/features/settings/components/settings-page';
import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { useApiSettingsAccess } from '@/app/features/settings/model-endpoints/hooks/use-api-settings-access';
import { useCurrentMemberContext } from '@/app/hooks/use-current-member-context';
import { cachedAbility } from '@/app/lib/loader-preload';
import { useT } from '@/lib/i18n/client';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute('/dashboard/$id/settings/api/rest')({
  head: () => ({ meta: seo('apiKeys') }),
  // Warm the hook's cache without gating navigation on an unbounded list.
  // Offline reads pause rather than reject, so even a caught/awaited read
  // can prevent page paint. The table owns loading, error recovery and the
  // Create action's placement once the initial result is known.
  loader: ({ context, params }) => {
    const ability = cachedAbility(context, params.id);
    if (ability !== null && ability.cannot('read', 'developerSettings')) {
      return;
    }
    void context.queryClient.prefetchQuery(apiKeysQuery(params.id));
  },
  component: ApiRestPage,
});

function ApiRestPage() {
  const { id: organizationId } = Route.useParams();
  const { t: tNav } = useT('navigation');
  const { t: tSettings } = useT('settings');

  // The parent layout waited for it; a member whose right lapsed still opens
  // this page for the keys they hold. A key for oneself from a session bound
  // to this organization works here alone.
  const { createApiKeys, sessionBoundHere, modelApi, modelApiEnabled } =
    useApiSettingsAccess(organizationId);
  // Owners and Admins also make keys for a member, a team, a project or the
  // organization — never acting above their own role — and may list every
  // key that works here, the members' own keys included.
  const { data: memberContext } = useCurrentMemberContext(organizationId);
  const viewer = memberContext?.status === 'ok' ? memberContext : undefined;
  const canSeeAll = viewer?.isAdmin === true;
  const [chosen, setChosen] = useState<ApiKeyListScope>('managed');
  // Only an Owner or Admin chooses; anyone else sees the keys they manage.
  const scope: ApiKeyListScope = canSeeAll ? chosen : 'managed';

  const { data: apiKeys, error, refetch } = useApiKeys(organizationId, scope);
  // A session that covers this organization alone ends none of the keys
  // that work everywhere: the list offers no way to, and this says why.
  const everywhereKeysListed =
    sessionBoundHere &&
    (apiKeys ?? []).some((apiKey) => apiKey.owner.kind === 'user');

  // Access is gated by the parent `api` route layout. Section title (not a
  // page title) — the settings rail already names the page.
  // Standard SettingsPage measure (max-w-3xl): the keys table's ~676px column
  // floor fits it; the table stays non-sticky per #2381.
  return (
    <SettingsPage>
      <SettingsSection
        title={tNav('apiKeys')}
        description={
          // API callers need the organization ID, but the value itself lives
          // with the org's other identity fields — link there instead of
          // duplicating the field on two pages.
          <span>
            {scope === 'all'
              ? tSettings('apiKeys.allKeysDescription')
              : tSettings('menu.apiKeys.description')}{' '}
            <Link
              to="/dashboard/$id/settings/organization"
              params={{ id: organizationId }}
              className="text-primary hover:underline"
            >
              {tSettings('organization.organizationId')}
            </Link>
          </span>
        }
      >
        <ApiKeysTable
          apiKeys={apiKeys}
          organizationId={organizationId}
          canCreate={createApiKeys}
          canCreateForOthers={canSeeAll}
          {...(viewer !== undefined
            ? { viewerUserId: viewer.userId, viewerRole: viewer.role }
            : {})}
          sessionBoundHere={sessionBoundHere}
          {...(modelApiEnabled !== undefined
            ? { modelApi: { enabled: modelApiEnabled, mayCall: modelApi } }
            : {})}
          scope={scope}
          {...(canSeeAll
            ? {
                filters: (
                  <ApiKeyScopeFilter scope={scope} onScopeChange={setChosen} />
                ),
              }
            : {})}
          error={error}
          onRetry={() => void refetch()}
        />
        {everywhereKeysListed && (
          <Text variant="muted" className="mt-3">
            {tSettings('apiKeys.everywhereKeysAfterPassword')}
          </Text>
        )}
      </SettingsSection>
    </SettingsPage>
  );
}
