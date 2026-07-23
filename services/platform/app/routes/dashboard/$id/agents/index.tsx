import { createFileRoute, useNavigate } from '@tanstack/react-router';

import {
  AdaptiveHeaderRoot,
  AdaptiveHeaderTitle,
} from '@/app/components/layout/adaptive-header';
import { ContentArea } from '@/app/components/layout/content-area';
import { PageLayout } from '@/app/components/layout/page-layout';
import { AgentsRoster } from '@/app/features/agents/components/agents-roster';
import { useT } from '@/lib/i18n/client';

export const Route = createFileRoute('/dashboard/$id/agents/')({
  component: AgentsIndexPage,
});

function AgentsIndexPage() {
  const { id: organizationId } = Route.useParams();
  const navigate = useNavigate();
  const { t } = useT('settings');

  return (
    <PageLayout
      header={
        <AdaptiveHeaderRoot standalone={false}>
          <AdaptiveHeaderTitle>{t('agents.title')}</AdaptiveHeaderTitle>
        </AdaptiveHeaderRoot>
      }
      organizationId={organizationId}
    >
      <ContentArea className="min-h-0 flex-1 py-4">
        <AgentsRoster
          organizationId={organizationId}
          onOpen={(slug) =>
            void navigate({
              to: '/dashboard/$id/agents/$agentId',
              params: { id: organizationId, agentId: slug },
            })
          }
        />
      </ContentArea>
    </PageLayout>
  );
}
