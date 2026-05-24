import { useIsMobile } from '@tale/ui/use-is-mobile';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';

import { SettingsSectionList } from '@/app/features/settings/components/settings-section-list';
import { useSettingsMenuGroups } from '@/app/features/settings/components/use-settings-menu-groups';
import { useT } from '@/lib/i18n/client';

export const Route = createFileRoute('/dashboard/$id/settings/personal')({
  component: PersonalSettingsIndex,
});

/**
 * Personal settings overview (mobile). Sibling to the workspace overview at
 * `/settings/`. Shows only the `you` group (account, personalization).
 * Desktop bounces to `/settings/account` so the user doesn't get a sparse
 * two-item list — the standalone tab nav already covers the same ground.
 */
function PersonalSettingsIndex() {
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

  const groups = useSettingsMenuGroups(organizationId, 'personal');

  if (!isMobile) return null;

  return (
    <SettingsSectionList groups={groups} ariaLabel={tNav('userSettings')} />
  );
}
