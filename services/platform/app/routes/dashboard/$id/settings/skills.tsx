import { Outlet, createFileRoute } from '@tanstack/react-router';

import { AccessDenied } from '@/app/components/layout/access-denied';
import { SettingsListPageSkeleton } from '@/app/features/settings/components/settings-skeleton';
import { useAbility, useAbilityLoading } from '@/app/hooks/use-ability';
import { useT } from '@/lib/i18n/client';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute('/dashboard/$id/settings/skills')({
  head: () => ({
    meta: seo('skills'),
  }),
  component: SkillsLayout,
});

function SkillsLayout() {
  const { t: tAccessDenied } = useT('accessDenied');
  const ability = useAbility();
  const abilityLoading = useAbilityLoading();

  if (abilityLoading) {
    return <SettingsListPageSkeleton />;
  }

  // Skills CRUD changes capability bindings that flow into agent runtime
  // tool grants, so the route mirrors the backend gate at
  // `requireOrgAdminOrDeveloper`. The outer `/settings` layout already
  // provides the page chrome (PageLayout + tabs) — this file only owns
  // the gate + the child outlet.
  if (ability.cannot('read', 'developerSettings')) {
    return <AccessDenied message={tAccessDenied('skills')} />;
  }

  return <Outlet />;
}
