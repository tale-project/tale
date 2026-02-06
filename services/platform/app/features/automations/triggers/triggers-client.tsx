'use client';

import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from '@/app/components/ui/navigation/tabs';
import { Stack } from '@/app/components/ui/layout/layout';
import { Skeleton } from '@/app/components/ui/feedback/skeleton';
import { useT } from '@/lib/i18n/client';
import { SchedulesSection } from './components/schedules-section';
import { WebhooksSection } from './components/webhooks-section';

interface TriggersClientProps {
  automationId: Id<'wfDefinitions'>;
  organizationId: string;
}

export function TriggersClient({
  automationId,
  organizationId,
}: TriggersClientProps) {
  const { t } = useT('automations');

  const workflow = useQuery(api.wf_definitions.queries.getWorkflowPublic, {
    wfDefinitionId: automationId,
  });

  if (!workflow) {
    return (
      <div className="py-6 px-4 w-full">
        <Stack gap={4}>
          <Skeleton className="h-10 w-80" />
          <Skeleton className="h-64 w-full" />
        </Stack>
      </div>
    );
  }

  const workflowRootId = (workflow.rootVersionId ??
    workflow._id) as Id<'wfDefinitions'>;

  return (
    <div className="py-6 px-4 w-full">
      <Tabs defaultValue="schedules" className="w-full">
        <TabsList aria-label={t('triggers.tabsLabel')}>
          <TabsTrigger value="schedules">
            {t('triggers.schedules.title')}
          </TabsTrigger>
          <TabsTrigger value="webhooks">
            {t('triggers.webhooks.title')}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="schedules" className="w-full">
          <SchedulesSection
            workflowRootId={workflowRootId}
            organizationId={organizationId}
          />
        </TabsContent>

        <TabsContent value="webhooks" className="w-full">
          <WebhooksSection
            workflowRootId={workflowRootId}
            organizationId={organizationId}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
