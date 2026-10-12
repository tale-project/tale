import { transactSerializable } from '@tale/shared/db/serializable';
import {
  managedAgentInstructionsSchema,
  managedAgentModelSchema,
  managedAgentToolsSchema,
  managedProjectInstructionsSchema,
} from '@tale/shared/schemas/managed-configuration';
import type { SettingsEffect } from '@tale/shared/schemas/settings-kinds';
import { configurationHash } from '@tale/shared/utils/configuration-hash';
import type { Sql, TransactionSql } from 'postgres';

import { defineAbilityFor } from '../../../lib/permissions/ability.ts';
import { isRecord } from '../../../lib/utils/type-utils.ts';
import {
  callerEmail,
  identityOf,
  pageOfRead,
  parseSettingsConfig,
  SettingsRefusalError,
} from '../mcp/settings/kit.ts';
import type {
  SettingsChange,
  SettingsContext,
  SettingsKindHandler,
  SettingsPage,
  SettingsResource,
} from '../mcp/settings/registry.ts';
import {
  assertProjectActive,
  assertWritable,
  checkAgentModelConfiguration,
  getProjectAgent,
  getProjectAuthContext,
  listProjectAgents,
  listProjects,
  loadProjectOrThrow,
  type ProjectAuthContext,
  readAgentInstructionsConfiguration,
  readAgentModelConfiguration,
  readAgentToolsConfiguration,
  readProjectInstructionsConfiguration,
  updateAgentInstructionsConfiguration,
  updateAgentModelConfiguration,
  updateAgentToolsConfiguration,
  updateProjectInstructions,
} from './service.ts';

/**
 * A project's standing instructions and its agents' instructions, tools and
 * model as settings kinds over MCP (`project-instructions`,
 * `agent-instructions`, `agent-tools`, `agent-model`): read and changed through the writers a declaration
 * applied by the CLI goes through, behind the project's own access rules —
 * reading takes access to the project, changing takes its editor role on a
 * project that is not archived, and an agent Tale manages changes in Tale
 * alone. Each config carries the ids of what it belongs to, as a
 * declaration names them.
 */

/** Who the caller is to the projects' access rules. */
export async function projectAuthOf(
  ctx: SettingsContext,
): Promise<ProjectAuthContext> {
  return getProjectAuthContext(
    ctx.sql,
    {
      organizationId: ctx.caller.organizationId,
      userId: ctx.caller.userId,
      role: ctx.caller.role,
    },
    await callerEmail(ctx),
  );
}

/** A managed read as a resource: its config always exists while what it
 * belongs to does, so it always has a revision. */
export function managedResource(
  id: string,
  snapshot: { config: unknown; hash: string | null },
): SettingsResource {
  if (snapshot.hash === null) {
    throw new Error(`The managed setting ${id} read without a revision`);
  }
  return { id, config: snapshot.config, hash: snapshot.hash };
}

/** The ids an id joins with slashes; `count` of them, none empty. */
export function idParts(
  kind: SettingsChange['kind'],
  id: string,
  count: number,
  form: string,
): string[] {
  const parts = id.split('/');
  if (parts.length !== count || parts.some((part) => part === '')) {
    throw new SettingsRefusalError(
      'SETTINGS_ID_INVALID',
      `"${id}" names no ${kind}`,
      { hint: `the id is ${form}` },
    );
  }
  return parts;
}

/** The id a managed config carries: its owners' ids, joined. */
function carriedId(change: SettingsChange, fields: readonly string[]) {
  if (change.op !== 'set' || !isRecord(change.config)) return undefined;
  const config = change.config;
  const values = fields.map((field) => config[field]);
  return values.every((value) => typeof value === 'string' && value !== '')
    ? values.join('/')
    : undefined;
}

/** What a role may do with projects, as the access matrix says in
 * general; each project's own rules decide. */
function projectAccess(role: string) {
  const ability = defineAbilityFor(role);
  return {
    read: ability.can('read', 'projects'),
    write: ability.can('write', 'projects'),
  };
}

/** Refuse a change the project's own rules refuse: no editor role on it,
 * or an archived project. */
async function assertProjectEditable(
  sql: Sql,
  auth: ProjectAuthContext,
  projectId: string,
): Promise<void> {
  const project = await loadProjectOrThrow(sql, projectId);
  assertWritable(project, auth);
  assertProjectActive(project);
}

/** Refuse a change to an agent Tale manages: it changes in Tale alone. */
async function assertAgentEditable(
  sql: Sql,
  auth: ProjectAuthContext,
  projectId: string,
  agentId: string,
): Promise<void> {
  await assertProjectEditable(sql, auth, projectId);
  const agent = await getProjectAgent(sql, auth, projectId, agentId);
  if (agent?.managed === true) {
    throw new SettingsRefusalError(
      'PROJECT_AGENT_MANAGED',
      'Managed agent configuration is read-only',
      {
        status: 409,
        hint: 'an agent Tale manages changes in Tale alone',
      },
    );
  }
}

interface ManagedKind {
  readonly kind:
    | 'project-instructions'
    | 'agent-instructions'
    | 'agent-tools'
    | 'agent-model';
  /** The config fields that name the resource, in id order. */
  readonly idFields: readonly string[];
  readonly idForm: string;
  readonly what: string;
  readonly schema: Parameters<typeof parseSettingsConfig>[0];
  read(
    sql: Sql | TransactionSql,
    auth: ProjectAuthContext,
    parts: readonly string[],
  ): Promise<{ config: unknown; hash: string | null }>;
  gate(
    sql: Sql,
    auth: ProjectAuthContext,
    parts: readonly string[],
  ): Promise<void>;
  /** The checks the native writer makes of what a change asks for,
   * reading only, so a change it would refuse is refused before anything
   * in the call is applied. */
  check?(
    sql: Sql,
    auth: ProjectAuthContext,
    parts: readonly string[],
    after: unknown,
  ): Promise<void>;
  /** What a change does beyond replacing a value, from what is stored and
   * what it asks for. */
  effects?(current: unknown, after: unknown): readonly SettingsEffect[];
  /** The native writer, given the config a plan took. */
  write(
    tx: TransactionSql,
    auth: ProjectAuthContext,
    config: unknown,
    expectedHash: string,
  ): Promise<void>;
  /** Every resource of one page of the caller's projects. */
  listPage(
    ctx: SettingsContext,
    auth: ProjectAuthContext,
    cursor: string | undefined,
  ): Promise<SettingsPage>;
}

function managedKind(spec: ManagedKind): SettingsKindHandler {
  const idOf = (change: SettingsChange) =>
    identityOf(
      spec.kind,
      change.id,
      carriedId(change, spec.idFields),
      spec.idForm,
    );
  const partsOf = (id: string) =>
    idParts(spec.kind, id, spec.idFields.length, spec.idForm);
  const readOne = async (
    ctx: SettingsContext,
    auth: ProjectAuthContext,
    id: string,
  ): Promise<SettingsResource> =>
    managedResource(id, await spec.read(ctx.sql, auth, partsOf(id)));
  return {
    kind: spec.kind,
    access: async ({ caller }) => projectAccess(caller.role),
    identify: (change) => idOf(change),
    list: async (ctx, query) => {
      const auth = await projectAuthOf(ctx);
      if (query.ids === undefined) {
        return spec.listPage(ctx, auth, query.cursor);
      }
      const items: SettingsResource[] = [];
      for (const id of query.ids) items.push(await readOne(ctx, auth, id));
      return { items, nextCursor: null };
    },
    read: async (ctx, id) =>
      id === null ? null : readOne(ctx, await projectAuthOf(ctx), id),
    plan: async (ctx, change, current) => {
      const id = idOf(change);
      const after = parseSettingsConfig(spec.schema, change.config, spec.what);
      const auth = await projectAuthOf(ctx);
      await spec.gate(ctx.sql, auth, partsOf(id));
      const unchanged =
        current !== null &&
        configurationHash(after) === configurationHash(current.config);
      // A change that writes nothing meets no writer.
      if (!unchanged) await spec.check?.(ctx.sql, auth, partsOf(id), after);
      return {
        after,
        unchanged,
        effects:
          current === null ? [] : (spec.effects?.(current.config, after) ?? []),
      };
    },
    apply: async (ctx, change, expectedHash) => {
      const id = idOf(change);
      const auth = await projectAuthOf(ctx);
      // The resource exists while what it belongs to does, so the change
      // names the hash it read; the plan answered it as stale otherwise.
      if (expectedHash === null) {
        throw new SettingsRefusalError(
          'SETTINGS_STALE',
          `${spec.kind}/${id} exists, so a change names the hash it read`,
          { hint: 'read it with get_settings and apply with its hash' },
        );
      }
      await transactSerializable(ctx.sql, (tx) =>
        spec.write(tx, auth, change.config, expectedHash),
      );
      return { hash: (await readOne(ctx, auth, id)).hash };
    },
  };
}

/** The ids of the caller's projects that are not archived. */
async function readableProjectIds(
  ctx: SettingsContext,
  auth: ProjectAuthContext,
): Promise<string[]> {
  const projects = await listProjects(ctx.sql, auth, { summary: true });
  return projects.map((project) => project.id);
}

/** Every agent of the caller's projects, as the `<project>/<agent>` ids its
 * resources go by — in project order, then each project's own. */
async function agentIds(
  ctx: SettingsContext,
  auth: ProjectAuthContext,
): Promise<string[]> {
  const projectIds = await readableProjectIds(ctx, auth);
  const perProject = await Promise.all(
    projectIds.map(async (projectId) =>
      (await listProjectAgents(ctx.sql, auth, projectId)).map(
        (agent) => `${projectId}/${agent.id}`,
      ),
    ),
  );
  return perProject.flat();
}

/** The agents a page holds at most, however small their configurations. */
const AGENT_PAGE_SIZE = 50;

/** One page of the agent resources of the caller's projects, over the
 * (project, agent) pairs and cut by the size of what the page read. */
function agentListPage(read: ManagedKind['read']): ManagedKind['listPage'] {
  return async (ctx, auth, cursor) =>
    pageOfRead(
      await agentIds(ctx, auth),
      cursor,
      AGENT_PAGE_SIZE,
      async (id) => {
        const [projectId = '', agentId = ''] = id.split('/');
        return managedResource(
          id,
          await read(ctx.sql, auth, [projectId, agentId]),
        );
      },
    );
}

const readAgentInstructions: ManagedKind['read'] = (
  sql,
  auth,
  [projectId, agentId],
) =>
  readAgentInstructionsConfiguration(sql, auth, projectId ?? '', agentId ?? '');

const readAgentTools: ManagedKind['read'] = (sql, auth, [projectId, agentId]) =>
  readAgentToolsConfiguration(sql, auth, projectId ?? '', agentId ?? '');

const readAgentModel: ManagedKind['read'] = (sql, auth, [projectId, agentId]) =>
  readAgentModelConfiguration(sql, auth, projectId ?? '', agentId ?? '');

const gateAgent: ManagedKind['gate'] = (sql, auth, [projectId, agentId]) =>
  assertAgentEditable(sql, auth, projectId ?? '', agentId ?? '');

export const projectInstructionsSettings = managedKind({
  kind: 'project-instructions',
  idFields: ['projectId'],
  idForm: 'the project id',
  what: "the project's instructions",
  schema: managedProjectInstructionsSchema,
  read: (sql, auth, [projectId]) =>
    readProjectInstructionsConfiguration(sql, auth, projectId ?? ''),
  gate: (sql, auth, [projectId]) =>
    assertProjectEditable(sql, auth, projectId ?? ''),
  write: (tx, auth, config, expectedHash) => {
    const { projectId, instructions } =
      managedProjectInstructionsSchema.parse(config);
    return updateProjectInstructions(
      tx,
      auth,
      projectId,
      instructions,
      expectedHash,
    );
  },
  listPage: async (ctx, auth, cursor) =>
    pageOfRead(
      await readableProjectIds(ctx, auth),
      cursor,
      50,
      async (projectId) =>
        managedResource(
          projectId,
          await readProjectInstructionsConfiguration(ctx.sql, auth, projectId),
        ),
    ),
});

export const agentInstructionsSettings = managedKind({
  kind: 'agent-instructions',
  idFields: ['projectId', 'agentId'],
  idForm: '<projectId>/<agentId>',
  what: "the agent's instructions",
  schema: managedAgentInstructionsSchema,
  read: readAgentInstructions,
  gate: gateAgent,
  write: (tx, auth, config, expectedHash) =>
    updateAgentInstructionsConfiguration(
      tx,
      auth,
      managedAgentInstructionsSchema.parse(config),
      expectedHash,
    ),
  listPage: agentListPage(readAgentInstructions),
});

export const agentToolsSettings = managedKind({
  kind: 'agent-tools',
  idFields: ['projectId', 'agentId'],
  idForm: '<projectId>/<agentId>',
  what: "the agent's tools",
  schema: managedAgentToolsSchema,
  read: readAgentTools,
  gate: gateAgent,
  write: (tx, auth, config, expectedHash) =>
    updateAgentToolsConfiguration(
      tx,
      auth,
      managedAgentToolsSchema.parse(config),
      expectedHash,
    ),
  listPage: agentListPage(readAgentTools),
});

/** What serves an agent's runs: its runtime, its model and their provider. */
function servingOf(config: unknown): unknown {
  return isRecord(config)
    ? [
        config.harness ?? null,
        config.model ?? null,
        config.modelProvider ?? null,
      ]
    : null;
}

export const agentModelSettings = managedKind({
  kind: 'agent-model',
  idFields: ['projectId', 'agentId'],
  idForm: '<projectId>/<agentId>',
  what: "the agent's model",
  schema: managedAgentModelSchema,
  read: readAgentModel,
  gate: gateAgent,
  check: async (sql, auth, [projectId = '', agentId = ''], after) => {
    const agent = await getProjectAgent(sql, auth, projectId, agentId);
    if (agent === null) return;
    await checkAgentModelConfiguration(
      sql,
      auth,
      agent,
      managedAgentModelSchema.parse(after),
    );
  },
  // Another runtime, model or provider serves the agent's next runs.
  effects: (current, after) =>
    configurationHash(servingOf(current)) ===
    configurationHash(servingOf(after))
      ? []
      : ['changes-serving-account'],
  write: (tx, auth, config, expectedHash) =>
    updateAgentModelConfiguration(
      tx,
      auth,
      managedAgentModelSchema.parse(config),
      expectedHash,
    ),
  listPage: agentListPage(readAgentModel),
});
