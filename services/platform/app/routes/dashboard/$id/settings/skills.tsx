import { createFileRoute, Outlet } from '@tanstack/react-router';

import { AccessDenied } from '@/app/components/layout/access-denied';
import { useAbility, useAbilityLoading } from '@/app/hooks/use-ability';
import { useT } from '@/lib/i18n/client';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute('/dashboard/$id/settings/skills')({
  head: () => ({
    meta: seo('skills'),
  }),
  component: SkillsLayout,
});

/**
 * Skill-library section gate — mirrors its nav entry (Admin/Developer) and the
 * documented "managing takes Admin or Developer" rule. The backend would let
 * any member manage their own private skills; the page keeps the stricter
 * documented gate so the rail and the route agree.
 */
function SkillsLayout() {
  const { t: tAccessDenied } = useT('accessDenied');
  const ability = useAbility();
  const abilityLoading = useAbilityLoading();

  if (!abilityLoading && ability.cannot('read', 'developerSettings')) {
    return <AccessDenied message={tAccessDenied('skills')} />;
  }

  return <Outlet />;
}
