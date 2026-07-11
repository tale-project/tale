/**
 * Pure helpers for an automation schedule's RUNTIME variables — the values a
 * cron tick sends as the workflow's `input`. One shared vocabulary so
 * "configured" means the same thing everywhere it's judged: the install-time
 * seeding (`install_actions.ts#syncAutomationSchedules`), the reconcile merge
 * (`install_mutations.ts#reconcileAutomationSchedules`), the scheduler's
 * fire-time merge (`workflow_engine/helpers/scheduler/scan_and_trigger.ts`),
 * and the readiness check (`schedule_readiness.ts`).
 */

import type { WorkflowJsonConfig } from '../../lib/shared/schemas/workflows';
import { isRecord } from '../../lib/utils/type-utils';

/** A workflow start step's `inputSchema` — the contract a schedule's
 *  `variables` must satisfy for a cron run to succeed. */
export interface ScheduleInputSchema {
  properties: Record<string, unknown>;
  required?: string[];
}

/**
 * The start step's `inputSchema`, when the workflow declares one. Step configs
 * are free-form records, so the shape is re-validated rather than trusted.
 */
export function startInputSchemaOf(
  workflow: Pick<WorkflowJsonConfig, 'steps'> | undefined,
): ScheduleInputSchema | undefined {
  const start = workflow?.steps?.find((step) => step.stepType === 'start');
  const schema = start?.config['inputSchema'];
  if (!isRecord(schema) || !isRecord(schema.properties)) return undefined;
  const required = Array.isArray(schema.required)
    ? schema.required.filter((key): key is string => typeof key === 'string')
    : undefined;
  return {
    properties: schema.properties,
    ...(required !== undefined && { required }),
  };
}

/**
 * A required value counts as "unconfigured" when it's absent, null/undefined,
 * a blank string, or an empty collection. Numbers (`0`) and booleans (`false`)
 * are accepted as configured — they're indistinguishable from a deliberate
 * value. Server-side twin of `isUnconfigured` in
 * `app/features/workflows/utils/input-schema-template.ts` (Convex code cannot
 * import from `app/`); keep the two in step.
 */
export function isUnconfiguredScheduleValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value).length === 0;
  return false;
}

/**
 * Converge a schedule row's `variables` toward the desired (file-declared +
 * install-seeded) defaults. An operator-set row value always wins — EXCEPT a
 * blank placeholder (the `""`/`null` skeleton the schedule dialog and the
 * input-schema template pre-fill), which must not shadow a real default: that
 * is how the install wizard's chosen project finally lands in
 * `variables.projectId` on reconcile (#2607) instead of being blocked by the
 * empty string an earlier edit left behind.
 */
export function mergeScheduleVariables(
  defaults: Record<string, unknown> | undefined,
  existing: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...defaults };
  for (const [key, value] of Object.entries(existing ?? {})) {
    const fallback = merged[key];
    if (
      isUnconfiguredScheduleValue(value) &&
      !isUnconfiguredScheduleValue(fallback)
    ) {
      continue;
    }
    merged[key] = value;
  }
  return merged;
}

/**
 * The input a cron tick actually sends: the schedule's `variables`, with the
 * row's own `projectId` (the project chosen at install/bind time) filled in
 * when the variables carry none — a row that predates the install-time
 * seeding, or whose `projectId` is a blank placeholder, still reaches the
 * workflow with the project it was bound to.
 */
export function effectiveScheduleInput(
  variables: Record<string, unknown> | undefined,
  projectId: string | undefined,
): Record<string, unknown> {
  const input: Record<string, unknown> = { ...variables };
  if (projectId !== undefined && isUnconfiguredScheduleValue(input.projectId)) {
    input.projectId = projectId;
  }
  return input;
}

/**
 * The schema's required top-level fields still unconfigured in `variables` —
 * the gaps the readiness checklist and the install wizard's Done step name.
 */
export function missingRequiredScheduleFields(
  schema: ScheduleInputSchema | undefined,
  variables: Record<string, unknown> | undefined,
): string[] {
  const required = schema?.required ?? [];
  if (required.length === 0) return [];
  return required.filter((key) =>
    isUnconfiguredScheduleValue(variables?.[key]),
  );
}
