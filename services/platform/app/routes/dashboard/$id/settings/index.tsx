import { useIsMobile } from '@tale/ui/use-is-mobile';
import {
  createFileRoute,
  useLoaderData,
  useNavigate,
} from '@tanstack/react-router';
import { useEffect } from 'react';

import { SettingsSectionList } from '@/app/features/settings/components/settings-section-list';
import { useSettingsMenuGroups } from '@/app/features/settings/components/use-settings-menu-groups';
import { memberContextQuery } from '@/app/lib/backend/org';
import { useT } from '@/lib/i18n/client';
import { getDefaultSettingsRoute } from '@/lib/permissions/get-default-settings-route';

export const Route = createFileRoute('/dashboard/$id/settings/')({
  loader: async ({ context, params }) => {
    const memberContext = await context.queryClient
      .ensureQueryData(memberContextQuery(params.id))
      .catch((error: unknown) => {
        console.warn('Failed to load member context for settings index', error);
        return null;
      });

    return { role: memberContext?.role ?? null };
  },
  component: SettingsIndex,
});

/**
 * Workspace settings overview (mobile). Shows the `workspace` + `governance`
 * groups — the personal-settings counterpart lives at
 * `/settings/personal`. Desktop bounces to the default permission-aware
 * leaf so the user lands on something useful instead of an empty list.
 */
function SettingsIndex() {
  const { id: organizationId } = Route.useParams();
  const { role } = useLoaderData({ from: Route.id });
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const { t: tNav } = useT('navigation');

  useEffect(() => {
    if (!isMobile) {
      void navigate({
        to: getDefaultSettingsRoute(role),
        params: { id: organizationId },
        replace: true,
      });
    }
  }, [isMobile, navigate, organizationId, role]);

  const groups = useSettingsMenuGroups(organizationId, 'workspace');

  if (!isMobile) return null;

  return (
    <SettingsSectionList groups={groups} ariaLabel={tNav('userSettings')} />
  );
}
