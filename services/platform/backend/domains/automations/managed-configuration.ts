import {
  expectedConfigurationHashSchema,
  configurationHashSchema,
} from '@tale/shared/schemas/configuration';
import {
  managedPlatformResourceSchema,
  type ManagedPlatformResource,
} from '@tale/shared/schemas/managed-configuration';
import type { Sql } from 'postgres';
import { z } from 'zod';

import { dispatch } from '../../../lib/engine/api/dispatch';
import { assembleAutomationAuthoringHost } from '../../core/automations/authoring_host';
import { pgAutomationStore } from './dispatch-store';
import {
  managedConfigurationHash,
  managedDefinitionValue,
  managedScheduleValue,
} from './managed-configuration-value';
import {
  AutomationError,
  assertAutomationName,
  automationTombstone,
  bindingProjectIds,
  deployedVersion,
  deploy,
  listTriggers,
  saveVersion,
  versionRow,
  setTrigger,
  triggerWakesOnSlotFreed,
} from './store';

export const managedAutomationKindSchema = z.enum([
  'automation-definition',
  'automation-deployment',
  'automation-schedule',
]);
export const managedAutomationWriteSchema = z
  .strictObject({
    resource: managedPlatformResourceSchema,
    expectedHash: expectedConfigurationHashSchema,
    definitionSha256: configurationHashSchema.optional(),
  })
  .refine(
    (body) => managedAutomationKindSchema.safeParse(body.resource.kind).success,
  );

type Kind = z.infer<typeof managedAutomationKindSchema>;
type Scope = { organizationId: string; name: string; projectId: string };

/** The configuration view only exposes definition fields, never credentials,
 * execution history or trigger tokens. Operational stamps are not desired state. */
export async function readManagedAutomation(
  sql: Sql,
  scope: Scope,
  kind: Kind,
) {
  assertAutomationName(scope.name);
  if (await automationTombstone(sql, scope.organizationId, scope.name))
    throw new AutomationError(
      'AUTOMATION_DELETED',
      'Deleted automation requires explicit recovery before managed adoption.',
      409,
    );
  const latest = await versionRow(
    sql,
    scope.organizationId,
    scope.name,
    undefined,
  );
  if (
    latest !== null &&
    !(await bindingProjectIds(sql, scope.organizationId, scope.name)).includes(
      scope.projectId,
    )
  )
    throw new AutomationError(
      'AUTOMATION_PROJECT_UNKNOWN',
      'Managed automation is not bound to its declared project.',
      409,
    );
  let config: unknown = null;
  if (kind === 'automation-definition')
    config = managedDefinitionValue(scope.projectId, scope.name, latest);
  if (kind === 'automation-deployment') {
    const selected = await deployedVersion(
      sql,
      scope.organizationId,
      scope.name,
    );
    if (selected !== undefined) {
      const row = await versionRow(
        sql,
        scope.organizationId,
        scope.name,
        selected,
      );
      if (row === null)
        throw new AutomationError(
          'AUTOMATION_VERSION_UNKNOWN',
          'Deployed automation version is missing.',
          409,
        );
      config = {
        name: scope.name,
        projectId: scope.projectId,
        definitionSha256: managedConfigurationHash(
          managedDefinitionValue(scope.projectId, scope.name, row),
        ),
      };
    }
  }
  if (kind === 'automation-schedule') {
    const rows = await listTriggers(sql, scope.organizationId, scope.name);
    const row = rows[0] ?? null;
    if (rows.length > 1 || (row && row.kind !== 'schedule'))
      throw new AutomationError(
        'AUTOMATION_TRIGGER_INVALID',
        'Managed configuration requires one schedule, never another trigger kind.',
        409,
      );
    if (row && latest === null)
      throw new AutomationError(
        'AUTOMATION_VERSION_UNKNOWN',
        'An orphaned trigger requires explicit recovery.',
        409,
      );
    config = managedScheduleValue(
      scope.projectId,
      scope.name,
      row === null
        ? null
        : {
            ...row,
            wakeOnSlotFreed: await triggerWakesOnSlotFreed(
              sql,
              scope.organizationId,
              scope.name,
            ),
          },
    );
  }
  return { config, hash: managedConfigurationHash(config) };
}

/** Existing native authoring dispatch supplies validation, tests and the store
 * gate. Separate resources are crash-recoverable phases, not a second engine. */
export async function writeManagedAutomation(
  sql: Sql,
  organizationId: string,
  actor: string,
  body: z.infer<typeof managedAutomationWriteSchema>,
) {
  const resource: ManagedPlatformResource = body.resource;
  if (!('name' in resource.config))
    throw new AutomationError(
      'AUTOMATION_TRIGGER_INVALID',
      'Invalid managed automation resource.',
    );
  const { name, projectId } = resource.config;
  assertAutomationName(name);
  const scope = { organizationId, actor };
  if (resource.kind === 'automation-schedule') {
    if (!body.definitionSha256)
      throw new AutomationError(
        'AUTOMATION_VERSION_STALE',
        'Managed schedule requires its reviewed definition digest.',
        409,
      );
    const schedule = resource.config;
    await setTrigger(sql, {
      ...scope,
      name,
      trigger: {
        kind: 'schedule',
        ...('cron' in schedule
          ? { cron: schedule.cron }
          : { repeat: schedule.repeat, startDate: schedule.startDate }),
        timezone: schedule.timezone,
        enabled: schedule.enabled,
        ...(schedule.catchUp !== undefined
          ? { catchUp: schedule.catchUp }
          : {}),
        ...(schedule.input !== undefined ? { input: schedule.input } : {}),
        // The declaration is the whole desired state: an absent opt-in
        // turns it off (a native save that omits it keeps it).
        wakeOnSlotFreed: schedule.wakeOnSlotFreed === true,
      },
      managed: {
        projectId,
        expectedHash: body.expectedHash,
        definitionSha256: body.definitionSha256,
      },
    });
    return { ok: true };
  }
  assembleAutomationAuthoringHost();
  const store = pgAutomationStore(sql, scope);
  let storeError: unknown;
  if (resource.kind === 'automation-definition') {
    if (resource.config.document.name !== name)
      throw new AutomationError(
        'AUTOMATION_NAME_INVALID',
        'The managed document must name its declared automation.',
      );
    const result = await dispatch(
      'save_automation',
      { automation: resource.config.document },
      {
        store: {
          ...store,
          save: (document, message, options) =>
            saveVersion(sql, {
              ...scope,
              ...resource.config,
              document,
              origin: { via: 'managed' },
              ...(message === undefined ? {} : { message }),
              ...(options?.testsPassed === undefined
                ? {}
                : { testsPassed: options.testsPassed }),
              managed: { projectId, expectedHash: body.expectedHash },
            }).catch((error: unknown) => {
              storeError = error;
              throw error;
            }),
        },
      },
    );
    if (storeError !== undefined) throw storeError;
    return result;
  }
  if (resource.kind !== 'automation-deployment')
    throw new AutomationError(
      'AUTOMATION_TRIGGER_INVALID',
      'Invalid managed automation resource.',
    );
  const latest = await versionRow(sql, organizationId, name, undefined);
  if (
    latest === null ||
    managedConfigurationHash(
      managedDefinitionValue(projectId, name, latest),
    ) !== resource.config.definitionSha256
  )
    throw new AutomationError(
      'AUTOMATION_VERSION_STALE',
      'Managed deployment requires the exact latest declared definition.',
      409,
    );
  const result = await dispatch(
    'deploy_automation',
    { name, version: latest.version },
    {
      store: {
        ...store,
        deploy: (selectedName, version, options) =>
          deploy(sql, {
            ...scope,
            name: selectedName,
            version,
            ...(options?.testsPassed === undefined
              ? {}
              : { testsPassed: options.testsPassed }),
            managed: {
              projectId,
              expectedHash: body.expectedHash,
              definitionSha256: resource.config.definitionSha256,
            },
          }).catch((error: unknown) => {
            storeError = error;
            throw error;
          }),
      },
    },
  );
  if (storeError !== undefined) throw storeError;
  return result;
}
