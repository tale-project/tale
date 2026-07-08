'use client';

import { Stack } from '@tale/ui/layout';

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
  // No ContentArea here — the caller owns padding (the automation Editor's
  // sibling tabs and the standalone route both wrap this), so Triggers never
  // double-pads. Mirrors how ExecutionsTable renders bare.
  return (
    <Stack gap={6}>
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
    </Stack>
  );
}
