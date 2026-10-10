import {
  managedAutomationDefinitionSchema,
  managedAutomationScheduleSchema,
} from '@tale/shared/schemas/managed-configuration';
import type { ScheduleRule } from '@tale/shared/schemas/schedule-rule';

export { managedConfigurationHash } from '../../core/lib/config_store/value_hash';

export function managedDefinitionValue(
  projectId: string,
  name: string,
  row: {
    document: unknown;
    settings?: unknown;
    presentation?: unknown;
    taskContract?: unknown;
  } | null,
) {
  return row === null
    ? null
    : managedAutomationDefinitionSchema.parse({
        projectId,
        name,
        document: row.document,
        settings: row.settings ?? null,
        presentation: row.presentation ?? null,
        taskContract: row.taskContract ?? null,
      });
}

/** A schedule row as the managed value reads it, whichever door wrote it. */
export interface ManagedScheduleSource {
  kind: string;
  cron: string | null;
  timezone: string | null;
  enabled: boolean;
  repeat: ScheduleRule | null;
  startDate: string | null;
  catchUp: 'latest' | 'skip' | null;
  input: Readonly<Record<string, unknown>> | null;
  /** The slot-wake opt-in (#4540); absent reads as off. */
  wakeOnSlotFreed?: boolean;
}

export function managedScheduleValue(
  projectId: string,
  name: string,
  row: ManagedScheduleSource | null,
) {
  if (row === null) return null;
  // A webhook/event is an ownership conflict, never an absent schedule that
  // a declarative apply may silently replace and revoke.
  if (row.kind !== 'schedule')
    throw new Error('Managed trigger is not a schedule');
  const extras = {
    ...(row.catchUp === 'skip' ? { catchUp: 'skip' as const } : {}),
    ...(row.input !== null ? { input: row.input } : {}),
    ...(row.wakeOnSlotFreed === true ? { wakeOnSlotFreed: true as const } : {}),
  };
  // A non-empty cron wins over a rule, as when the schedule runs.
  const cron = row.cron?.trim() ?? '';
  return managedAutomationScheduleSchema.parse(
    cron === '' && row.repeat !== null
      ? {
          projectId,
          name,
          repeat: row.repeat,
          startDate: row.startDate,
          timezone: row.timezone,
          enabled: row.enabled,
          ...extras,
        }
      : {
          projectId,
          name,
          cron: row.cron,
          timezone: row.timezone ?? 'UTC',
          enabled: row.enabled,
          ...extras,
        },
  );
}
