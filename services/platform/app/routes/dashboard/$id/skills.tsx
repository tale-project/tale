import { createFileRoute, Outlet, useMatch } from '@tanstack/react-router';

import { AccessDenied } from '@/app/components/layout/access-denied';
import {
  AdaptiveHeaderRoot,
  AdaptiveHeaderTitle,
} from '@/app/components/layout/adaptive-header';
import { PageLayout } from '@/app/components/layout/page-layout';
import { useAbility, useAbilityLoading } from '@/app/hooks/use-ability';
import { useT } from '@/lib/i18n/client';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute('/dashboard/$id/skills')({
  head: () => ({
    meta: seo('skills'),
  }),
  component: SkillsLayout,
});

function SkillsLayout() {
  const { id: organizationId } = Route.useParams();
  const { t } = useT('settings');
  const { t: tAccessDenied } = useT('accessDenied');

  const ability = useAbility();
  const abilityLoading = useAbilityLoading();

  const isDetailPage = useMatch({
    from: '/dashboard/$id/skills/$skillSlug',
    shouldThrow: false,
  });

  if (abilityLoading) return null;

  // Skills CRUD changes capability bindings that flow into agent runtime
  // tool grants, so the route mirrors the backend gate at
  // `requireOrgAdminOrDeveloper` (developer-settings capability) rather
  // than the looser membership check used by viewers.
  if (ability.cannot('read', 'developerSettings')) {
    return <AccessDenied message={tAccessDenied('skills')} />;
  }

  return (
    <PageLayout
      organizationId={organizationId}
      header={
        !isDetailPage ? (
          <AdaptiveHeaderRoot standalone={false}>
            <AdaptiveHeaderTitle>{t('skills.title')}</AdaptiveHeaderTitle>
          </AdaptiveHeaderRoot>
        ) : undefined
      }
    >
      <Outlet />
    </PageLayout>
  );
}
