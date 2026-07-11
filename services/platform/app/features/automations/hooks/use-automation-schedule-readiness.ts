'use client';

import { useMemo } from 'react';

import { useActionQuery } from '@/app/hooks/use-action-query';
import { api } from '@/convex/_generated/api';

/** One ACTIVE schedule with the required start-schema fields it leaves blank. */
export interface ScheduleReadinessEntry {
  scheduleId: string;
  cronExpression: string;
  projectId?: string;
  missingFields: string[];
}

export interface ScheduleReadiness {
  /** The workflow start schema's required input fields ([] = none declared). */
  required: string[];
  schedules: ScheduleReadinessEntry[];
}

const EMPTY: ScheduleReadiness = { required: [], schedules: [] };

/** Narrow the `getAutomationScheduleReadiness` result read through an
 *  unknown-typed query boundary. */
export function readScheduleReadinessResult(data: unknown): ScheduleReadiness {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- action-boundary read
  return (data as ScheduleReadiness | undefined) ?? EMPTY;
}

/**
 * The required fields still blank on at least one ACTIVE schedule — the union
 * the readiness checklist and the wizard Done step name, in the schema's
 * declared order. Empty when nothing is required or no schedule exists.
 */
export function missingScheduleFieldsOf(
  readiness: ScheduleReadiness,
): string[] {
  return readiness.required.filter((field) =>
    readiness.schedules.some((s) => s.missingFields.includes(field)),
  );
}

/**
 * Schedule-variable readiness for an automation's cron triggers — the third
 * readiness half next to `useAutomationInstallStates` (integrations) and
 * `useAutomationAgentReadiness` (agents). Backed by the
 * `getAutomationScheduleReadiness` action: an active schedule missing a
 * required start-schema field WILL fail at fire time, so the checklist names
 * it and deep-links to the Triggers tab.
 */
export function useAutomationScheduleReadiness(
  organizationId: string,
  automationSlug: string,
  enabled = true,
): {
  readiness: ScheduleReadiness;
  /** Union of blank required fields across active schedules. */
  missingFields: string[];
  isLoading: boolean;
  refetch: () => void;
} {
  const q = useActionQuery(
    ['automations', 'schedule-readiness', organizationId, automationSlug],
    api.automations.schedule_readiness.getAutomationScheduleReadiness,
    { organizationId, automationSlug },
    { enabled: enabled && organizationId !== '' && automationSlug !== '' },
  );

  const readiness = useMemo(
    () => readScheduleReadinessResult(q.data),
    [q.data],
  );
  const missingFields = useMemo(
    () => missingScheduleFieldsOf(readiness),
    [readiness],
  );

  return {
    readiness,
    missingFields,
    isLoading: q.isLoading,
    refetch: () => void q.refetch(),
  };
}
