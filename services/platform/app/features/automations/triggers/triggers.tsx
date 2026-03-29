'use client';

import { ContentArea } from '@/app/components/layout/content-area';

import { EventsSection } from './components/events-section';
import { SchedulesSection } from './components/schedules-section';
import { WebhooksSection } from './components/webhooks-section';

interface TriggersProps {
  automationId: string;
  organizationId: string;
  orgSlug: string;
  workflowSlug: string;
}

export function Triggers({
  automationId,
  organizationId,
  orgSlug,
  workflowSlug,
}: TriggersProps) {
  return (
    <ContentArea gap={6}>
      <SchedulesSection
        workflowRootId={automationId}
        organizationId={organizationId}
        orgSlug={orgSlug}
        workflowSlug={workflowSlug}
      />
      <WebhooksSection
        workflowRootId={automationId}
        organizationId={organizationId}
        orgSlug={orgSlug}
        workflowSlug={workflowSlug}
      />
      <EventsSection
        workflowRootId={automationId}
        organizationId={organizationId}
        orgSlug={orgSlug}
        workflowSlug={workflowSlug}
      />
    </ContentArea>
  );
}
