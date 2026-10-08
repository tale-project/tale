import { useIsMobile } from '@tale/ui/use-is-mobile';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';

import { SettingsSectionList } from '@/app/features/settings/components/settings-section-list';
import { useSettingsMenuGroups } from '@/app/features/settings/components/use-settings-menu-groups';
import { useT } from '@/lib/i18n/client';

export const Route = createFileRoute('/dashboard/$id/settings/')({
  component: SettingsIndex,
});

/**
 * Workspace settings overview (mobile). Shows the `workspace` + `governance`
 * groups — the personal-settings counterpart lives at
 * `/settings/personal`. A computer has the Settings panel beside the page, so
 * the index opens the panel's first row, Account, for every role: the rail's
 * Settings tile always lands on the same first page.
 */
function SettingsIndex() {
  const { id: organizationId } = Route.useParams();
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const { t: tNav } = useT('navigation');

  useEffect(() => {
    if (!isMobile) {
      void navigate({
        to: '/dashboard/$id/settings/account',
        params: { id: organizationId },
        replace: true,
      });
    }
  }, [isMobile, navigate, organizationId]);

  const groups = useSettingsMenuGroups(organizationId, 'workspace');

  if (!isMobile) return null;

  return (
    <SettingsSectionList groups={groups} ariaLabel={tNav('userSettings')} />
  );
}
