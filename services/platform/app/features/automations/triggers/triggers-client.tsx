'use client';

import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { Stack } from '@/app/components/ui/layout/layout';
import { Skeleton } from '@/app/components/ui/feedback/skeleton';
import { SchedulesSection } from './components/schedules-section';
import { WebhooksSection } from './components/webhooks-section';
import { EventsSection } from './components/events-section';

interface TriggersClientProps {
  automationId: Id<'wfDefinitions'>;
  organizationId: string;
}

export function TriggersClient({
  automationId,
  organizationId,
}: TriggersClientProps) {
  const workflow = useQuery(api.wf_definitions.queries.getWorkflow, {
    wfDefinitionId: automationId,
  });

  if (!workflow) {
    return (
      <div className="py-6 px-4 w-full">
        <Stack gap={4}>
          <Skeleton className="h-10 w-80" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-10 w-80" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-10 w-80" />
          <Skeleton className="h-32 w-full" />
        </Stack>
      </div>
    );
  }

  const workflowRootId = workflow.rootVersionId ?? workflow._id;

  return (
    <div className="py-6 px-4 w-full">
      <Stack gap={6}>
        <SchedulesSection
          workflowRootId={workflowRootId}
          organizationId={organizationId}
        />
        <WebhooksSection
          workflowRootId={workflowRootId}
          organizationId={organizationId}
        />
        <EventsSection
          workflowRootId={workflowRootId}
          organizationId={organizationId}
        />
      </Stack>
    </div>
  );
}
