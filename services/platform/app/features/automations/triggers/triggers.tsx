'use client';

import { ContentArea } from '@/app/components/layout/content-area';

import { EventsSection } from './components/events-section';
import { SchedulesSection } from './components/schedules-section';
import { WebhooksSection } from './components/webhooks-section';

interface TriggersProps {
  automationId: string;
  organizationId: string;
  workflowSlug: string;
}

export function Triggers({
  automationId,
  organizationId,
  workflowSlug,
}: TriggersProps) {
  return (
    <ContentArea gap={6}>
      <SchedulesSection
        workflowRootId={automationId}
        organizationId={organizationId}
        workflowSlug={workflowSlug}
      />
      <WebhooksSection
        workflowRootId={automationId}
        organizationId={organizationId}
        workflowSlug={workflowSlug}
      />
      <EventsSection
        workflowRootId={automationId}
        organizationId={organizationId}
        workflowSlug={workflowSlug}
      />
    </ContentArea>
  );
}
