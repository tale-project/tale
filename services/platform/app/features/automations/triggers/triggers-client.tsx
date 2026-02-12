'use client';

import type { Id } from '@/convex/_generated/dataModel';

import { Skeleton } from '@/app/components/ui/feedback/skeleton';
import { Stack } from '@/app/components/ui/layout/layout';

import { useWorkflow } from '../hooks/queries';
import { EventsSection } from './components/events-section';
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
  const { data: workflow } = useWorkflow(automationId);

  if (!workflow) {
    return (
      <div className="w-full px-4 py-6">
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
    <div className="w-full px-4 py-6">
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
