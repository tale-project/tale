'use client';

import { ContentArea } from '@/app/components/layout/content-area';

import { EventsSection } from './components/events-section';
import { SchedulesSection } from './components/schedules-section';
import { WebhooksSection } from './components/webhooks-section';

interface TriggersProps {
  workflowId: string;
  organizationId: string;
  workflowSlug: string;
}

export function Triggers({
  workflowId,
  organizationId,
  workflowSlug,
}: TriggersProps) {
  return (
    <ContentArea gap={6}>
      <SchedulesSection
        workflowRootId={workflowId}
        organizationId={organizationId}
        workflowSlug={workflowSlug}
      />
      <WebhooksSection
        workflowRootId={workflowId}
        organizationId={organizationId}
        workflowSlug={workflowSlug}
      />
      <EventsSection
        workflowRootId={workflowId}
        organizationId={organizationId}
        workflowSlug={workflowSlug}
      />
    </ContentArea>
  );
}
