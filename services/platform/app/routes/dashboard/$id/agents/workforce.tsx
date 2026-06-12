import { Button } from '@tale/ui/button';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';

import { ContentArea } from '@/app/components/layout/content-area';
import { PageHeader } from '@/app/components/layout/page-header';
import { useAbility } from '@/app/hooks/use-ability';
import { useT } from '@/lib/i18n/client';
import { lazyComponent } from '@/lib/utils/lazy-component';
import { seo } from '@/lib/utils/seo';

const WorkforceDashboard = lazyComponent(() =>
  import('@/app/features/agents/workforce/workforce-dashboard').then((mod) => ({
    default: mod.WorkforceDashboard,
  })),
);

export const Route = createFileRoute('/dashboard/$id/agents/workforce')({
  head: () => ({
    meta: seo('agents'),
  }),
  // Warm the Recharts chunk during the loader (it's heavy).
  loader: () => {
    void import('@/app/features/agents/workforce/workforce-dashboard');
  },
  component: WorkforcePage,
});

function WorkforcePage() {
  const { id: organizationId } = Route.useParams();
  const { t } = useT('workforce');
  const ability = useAbility();
  const canToggle = ability.can('read', 'orgSettings');

  return (
    <ContentArea gap={6} className="py-4">
      <PageHeader
        as="h2"
        title={t('title')}
        description={t('subtitle')}
        action={
          <Button asChild size="sm" variant="ghost" icon={ArrowLeft}>
            <Link to="/dashboard/$id/agents" params={{ id: organizationId }}>
              {t('backToAgents')}
            </Link>
          </Button>
        }
      />
      <WorkforceDashboard
        organizationId={organizationId}
        canToggle={canToggle}
      />
    </ContentArea>
  );
}
