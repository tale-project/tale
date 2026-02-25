'use client';

import type { Id } from '@/convex/_generated/dataModel';

import { ContentArea } from '@/app/components/layout/content-area';
import { Skeleton } from '@/app/components/ui/feedback/skeleton';

import { useWorkflow } from '../hooks/queries';
import { EventsSection } from './components/events-section';
import { SchedulesSection } from './components/schedules-section';
import { WebhooksSection } from './components/webhooks-section';

interface TriggersProps {
  automationId: Id<'wfDefinitions'>;
  organizationId: string;
}

export function Triggers({ automationId, organizationId }: TriggersProps) {
  const { data: workflow } = useWorkflow(automationId);

  if (!workflow) {
    return (
      <ContentArea gap={4}>
        <Skeleton className="h-10 w-80" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-10 w-80" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-10 w-80" />
        <Skeleton className="h-32 w-full" />
      </ContentArea>
    );
  }

  const workflowRootId = workflow.rootVersionId ?? workflow._id;

  return (
    <ContentArea gap={6}>
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
    </ContentArea>
  );
}
