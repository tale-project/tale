import type { Sql } from 'postgres';

import type {
  DispatchStore,
  RunDetail,
  RunSummary,
  TriggerView,
  VersionSummary,
} from '../../../lib/engine/api/dispatch.ts';
import type { Automation } from '../../../lib/engine/core/types.ts';
import { defineAbilityFor } from '../../../lib/permissions/ability.ts';
import {
  boundRunTrace,
  truncateRunDetail,
} from '../../core/automations/bound_run_payload.ts';
import { toJson } from '../../db/sql.ts';
import { createAuditLog } from '../audit_logs/service.ts';
import {
  assertAutomationName,
  beginRun,
  cancelRun,
  deleteTrigger,
  deployedVersion,
  deploy as deployVersion,
  getRun,
  listAutomations,
  listRuns,
  listTriggers,
  listVersions,
  saveVersion,
  setTrigger,
  versionRow,
  type TriggerInput,
} from './store.ts';

/**
 * The engine's `DispatchStore` over the 0.5 automations store — what the
 * platform MCP endpoint's engine tools and the builder session drive
 * (`dispatch()` from `lib/engine/api/dispatch`). The 0.4
 * `automationActionStore` twin: reads/writes hop through the same store
 * functions every other caller uses, and the run-control methods AUTHORIZE
 * the actor (an API key proves who is calling; the role decides what the
 * call may do — live start/cancel/trigger-unbind need the developer
 * capability, mock start needs membership).
 */

export class ActorAuthError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'ActorAuthError';
    this.code = code;
  }
}

/** The user an actor string names (`api-key:<userId>` → `<userId>`). */
function actorUserId(actor: string): string {
  const separator = actor.indexOf(':');
  return separator === -1 ? actor : actor.slice(separator + 1);
}

/** The 0.4 `authorizeActorRun`: membership resolved from the (org, user)
 * pair; `developer` additionally needs the developer-settings capability. */
export async function authorizeActorRun(
  sql: Sql,
  organizationId: string,
  actor: string,
  need: 'membership' | 'developer',
): Promise<void> {
  const userId = actorUserId(actor);
  if (userId === '') {
    throw new ActorAuthError(
      'UNAUTHENTICATED',
      'The caller could not be identified.',
    );
  }
  const rows = await sql<{ role: string }[]>`
    SELECT "role" FROM "member"
    WHERE "organizationId" = ${organizationId} AND "userId" = ${userId}
    LIMIT 1
  `;
  const role = rows[0]?.role;
  if (role === undefined || role === 'disabled') {
    throw new ActorAuthError(
      'ORG_FORBIDDEN',
      'The caller is not a member of this organization.',
    );
  }
  if (
    need === 'developer' &&
    defineAbilityFor(role).cannot('read', 'developerSettings')
  ) {
    throw new ActorAuthError(
      'FORBIDDEN_DEVELOPER_SETTINGS',
      `Role "${role}" lacks the developer-settings capability required to perform this action.`,
    );
  }
}

const TRIGGER_KINDS = new Set(['schedule', 'webhook', 'event']);

export interface PgStoreScope {
  organizationId: string;
  /** Who saves/runs are attributed to (`api-key:<userId>` or a user id). */
  actor: string;
  projectId?: string;
}

function toRunSummary(row: {
  id: string;
  name: string;
  version: number;
  status: string;
  mode: string;
  startedBy: string;
  detail: string | null;
  startedAt: number;
  finishedAt: number | null;
}): RunSummary {
  return {
    runId: row.id,
    name: row.name,
    version: row.version,
    status: row.status,
    mode: row.mode,
    startedBy: row.startedBy,
    ...(row.detail !== null ? { detail: row.detail } : {}),
    startedAt: row.startedAt,
    ...(row.finishedAt !== null ? { finishedAt: row.finishedAt } : {}),
  };
}

/** The run row stores `input` as a JSON-encoded string (the stepper's
 * contract); the engine-facing detail hands back the decoded value. */
function decodeRunInput(input: unknown): unknown {
  if (typeof input !== 'string') return input;
  try {
    return JSON.parse(input);
  } catch {
    return input;
  }
}

export function pgAutomationStore(
  sql: Sql,
  scope: PgStoreScope,
): DispatchStore {
  const { organizationId, actor } = scope;
  return {
    list: async () =>
      (await listAutomations(sql, organizationId)).map((row) => ({
        name: row.name,
        latest: row.latestVersion,
      })),
    get: async (name, version) => {
      const row = await versionRow(sql, organizationId, name, version);
      return row
        ? { meta: { version: row.version }, automation: row.document }
        : null;
    },
    deployedVersion: async (name) =>
      (await deployedVersion(sql, organizationId, name)) ?? null,
    save: async (automation, message) => {
      const name = assertAutomationName(automation.name ?? '');
      // Ownership travels with the scope: a builder session started from a
      // project surface pins its first save to that project (0.4 parity).
      return saveVersion(sql, {
        organizationId,
        name,
        document: automation,
        actor,
        ...(message !== undefined && message !== '' ? { message } : {}),
        ...(scope.projectId !== undefined
          ? { projectId: scope.projectId }
          : {}),
      });
    },
    deploy: (name, version) =>
      deployVersion(sql, { organizationId, name, version, actor }),
    setTrigger: async (name, trigger) => {
      const automation = assertAutomationName(name);
      if (!TRIGGER_KINDS.has(trigger.kind)) {
        throw new Error(
          `unknown trigger kind "${trigger.kind}" — one of schedule, webhook, event`,
        );
      }
      // Cron/timezone/event validation lives in the store's `setTrigger`
      // (`assertTriggerValid`) so this engine door and the HTTP door converge
      // on ONE validation — a schedule that cannot parse is refused there with
      // an actionable AutomationError rather than saving green.
      // The store may mint a webhook token; its plaintext is deliberately
      // DISCARDED here — an engine tool call is not a surface that can show
      // it to a person once (the REST trigger door rotates to reveal).
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the kind was validated above; the store validates the rest
      const input = trigger as unknown as TriggerInput;
      await setTrigger(sql, {
        organizationId,
        name: automation,
        trigger: input,
        actor,
      });
    },
    recordRun: async (name, version, result, mode) => {
      // A one-piece run (`run_deployed`) is born terminal — this insert IS
      // its exactly-once terminal transition, so a LIVE one also writes the
      // provenance audit row (the 0.4 contract).
      const now = Date.now();
      const status = result.status === 'success' ? 'success' : 'failed';
      const detail =
        result.error?.message !== undefined
          ? truncateRunDetail(result.error.message)
          : undefined;
      await sql.begin(async (tx) => {
        const inserted = await tx<{ id: string }[]>`
          INSERT INTO app.automation_runs (
            org_id, name, version, status, mode, started_by, input, output,
            checkpoints, trace, effects, detail, claim_epoch, started_at_ms,
            finished_at_ms
          ) VALUES (
            ${organizationId}, ${name}, ${version}, ${status}, ${mode},
            ${actor}, ${tx.json(toJson(JSON.stringify(null)))},
            ${result.output === undefined ? null : tx.json(toJson(result.output))},
            ${tx.json(toJson({ nodes: {}, executions: 0 }))},
            ${tx.json(toJson(boundRunTrace(result.trace)))},
            ${tx.json(toJson(result.effects))}, ${detail ?? null}, 0, ${now},
            ${now}
          )
          RETURNING id
        `;
        const runId = inserted[0]?.id;
        if (!runId) throw new Error('run insert failed');
        if (mode === 'live') {
          await createAuditLog(tx, {
            organizationId,
            actorId: actor,
            actorType: 'system',
            action: `automation.run.${status}`,
            category: 'ai',
            resourceType: 'automation_run',
            resourceId: runId,
            resourceName: `${name}@${version}`,
            status: status === 'success' ? 'success' : 'failure',
            ...(detail !== undefined ? { errorMessage: detail } : {}),
            metadata: { effectsCount: result.effects.length, executions: 0 },
          });
        }
      });
    },
    startRun: async (name, input, mode, version, projectId) => {
      await authorizeActorRun(
        sql,
        organizationId,
        actor,
        mode === 'live' ? 'developer' : 'membership',
      );
      if (projectId !== undefined) {
        const projects = await sql<{ id: string }[]>`
          SELECT id FROM app.projects
          WHERE id = ${projectId} AND org_id = ${organizationId}
          LIMIT 1
        `;
        if (projects.length === 0) {
          throw new ActorAuthError(
            'PROJECT_NOT_FOUND',
            `No such project: ${projectId}`,
          );
        }
      }
      return beginRun(sql, {
        organizationId,
        name,
        input: input ?? {},
        mode,
        startedBy: actor,
        ...(version !== undefined ? { version } : {}),
        ...(projectId !== undefined ? { projectId } : {}),
      });
    },
    cancelRun: async (runId) => {
      await authorizeActorRun(sql, organizationId, actor, 'developer');
      // The store answers `{ cancelled: false }` for a missing or terminal
      // run and never null; a throw here is a real failure (audit write,
      // session stop, the database) and must surface as such, not be
      // laundered into `no run`.
      return cancelRun(sql, organizationId, runId);
    },
    deleteTrigger: async (name) => {
      await authorizeActorRun(sql, organizationId, actor, 'developer');
      await deleteTrigger(sql, organizationId, name);
    },
    listRuns: async (options) =>
      (
        await listRuns(sql, organizationId, {
          ...(options.name !== undefined ? { name: options.name } : {}),
          ...(options.limit !== undefined ? { limit: options.limit } : {}),
        })
      ).map(toRunSummary),
    getRun: async (runId): Promise<RunDetail | null> => {
      const row = await getRun(sql, organizationId, runId);
      if (!row) return null;
      return {
        ...toRunSummary(row),
        input: decodeRunInput(row.input),
        ...(row.output !== null && row.output !== undefined
          ? { output: row.output }
          : {}),
        ...(row.trace !== null && row.trace !== undefined
          ? { trace: row.trace }
          : {}),
        ...(row.effects !== null && row.effects !== undefined
          ? { effects: row.effects }
          : {}),
      };
    },
    listVersions: async (name): Promise<VersionSummary[]> => {
      const versions: VersionSummary[] = [];
      for (const row of await listVersions(sql, organizationId, name)) {
        const version: VersionSummary = {
          version: row.version,
          createdBy: row.createdBy,
          createdAt: row.createdAt,
        };
        if (row.message !== null) version.message = row.message;
        if (row.testsPassed !== null) version.testsPassed = row.testsPassed;
        versions.push(version);
      }
      return versions;
    },
    listTriggers: async (name): Promise<TriggerView[]> => {
      const views: TriggerView[] = [];
      for (const row of await listTriggers(sql, organizationId, name)) {
        const view: TriggerView = {
          name: row.name,
          kind: row.kind,
          hasToken: row.hasToken,
          enabled: row.enabled,
        };
        if (row.cron !== null) view.cron = row.cron;
        if (row.timezone !== null) view.timezone = row.timezone;
        if (row.event !== null) view.event = row.event;
        if (row.lastFiredAt !== null) view.lastFiredAt = row.lastFiredAt;
        views.push(view);
      }
      return views;
    },
  } satisfies DispatchStore & {
    save(
      automation: Automation,
      message?: string,
    ): Promise<{ name: string; version: number }>;
  };
}
