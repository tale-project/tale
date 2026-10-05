import {
  managedAutomationDefinitionSchema,
  managedAutomationScheduleSchema,
} from '@tale/shared/schemas/managed-configuration';

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

export function managedScheduleValue(
  projectId: string,
  name: string,
  row: {
    kind: string;
    cron: string | null;
    timezone: string | null;
    enabled: boolean;
  } | null,
) {
  if (row === null) return null;
  // A webhook/event is an ownership conflict, never an absent schedule that
  // a declarative apply may silently replace and revoke.
  if (row.kind !== 'schedule')
    throw new Error('Managed trigger is not a schedule');
  return managedAutomationScheduleSchema.parse({
    projectId,
    name,
    cron: row.cron,
    timezone: row.timezone ?? 'UTC',
    enabled: row.enabled,
  });
}
