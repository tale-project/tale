import { createFileRoute } from '@tanstack/react-router';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';

import { ApiKeyScopeFilter } from '@/app/features/settings/api-keys/components/api-key-scope-filter';
import { ApiKeysTable } from '@/app/features/settings/api-keys/components/api-keys-table';
import { PersonalKeysListNotice } from '@/app/features/settings/api-keys/components/personal-keys-list-notice';
import { PersonalKeysNotice } from '@/app/features/settings/api-keys/components/personal-keys-notice';
import { PersonalKeysPolicyEditor } from '@/app/features/settings/api-keys/components/personal-keys-policy-editor';
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
  // this page for the keys they hold.
  const { createApiKeys } = useApiSettingsAccess(organizationId);
  // Owners and Admins also make keys for a member, a team, a project or the
  // organization — never acting above their own role — and may list every
  // key that works here, the members' own keys included.
  const { data: memberContext } = useCurrentMemberContext(organizationId);
  const viewer = memberContext?.status === 'ok' ? memberContext : undefined;
  const canSeeAll = viewer?.isAdmin === true;
  const [chosen, setChosen] = useState<ApiKeyListScope>('managed');
  // Only an Owner or Admin chooses; anyone else sees the keys they manage.
  const scope: ApiKeyListScope = canSeeAll ? chosen : 'managed';

  const { data: listing, error, refetch } = useApiKeys(organizationId, scope);

  // Access is gated by the parent `api` route layout. Section title (not a
  // page title) — the settings rail already names the page.
  // Standard SettingsPage measure (max-w-3xl): the keys table's ~676px column
  // floor fits it; the table stays non-sticky per #2381.
  return (
    <SettingsPage>
      {/* Says when the keys the reader makes for themselves don't work in
          this organization; an Owner or Admin reads it in the setting below
          instead, so it waits until the reader is known. */}
      {viewer !== undefined && !viewer.isAdmin && (
        <PersonalKeysNotice organizationId={organizationId} />
      )}
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
        {/* Every key that works here leaves out the members' own keys while
            the organization refuses them, and says why. */}
        {scope === 'all' && (
          <PersonalKeysListNotice standing={listing?.personalKeys} />
        )}
        <ApiKeysTable
          apiKeys={listing?.keys}
          organizationId={organizationId}
          canCreate={createApiKeys}
          canCreateForOthers={canSeeAll}
          {...(viewer !== undefined
            ? { viewerUserId: viewer.userId, viewerRole: viewer.role }
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
      </SettingsSection>
      {/* Whether the members' own keys work here is an Owner's or Admin's
          call; the switch checks the ability itself too. */}
      {viewer?.isAdmin === true && (
        <PersonalKeysPolicyEditor organizationId={organizationId} />
      )}
    </SettingsPage>
  );
}
