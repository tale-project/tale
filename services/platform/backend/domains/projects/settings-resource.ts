import { transactSerializable } from '@tale/shared/db/serializable';
import {
  managedAgentInstructionsSchema,
  managedAgentModelSchema,
  managedAgentToolsSchema,
  managedProjectInstructionsSchema,
} from '@tale/shared/schemas/managed-configuration';
import { configurationHash } from '@tale/shared/utils/configuration-hash';
import type { Sql, TransactionSql } from 'postgres';

import { defineAbilityFor } from '../../../lib/permissions/ability.ts';
import { isRecord } from '../../../lib/utils/type-utils.ts';
import {
  callerEmail,
  identityOf,
  pageOf,
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
      await spec.gate(ctx.sql, await projectAuthOf(ctx), partsOf(id));
      return {
        after,
        unchanged:
          current !== null &&
          configurationHash(after) === configurationHash(current.config),
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

/** One page of the caller's projects that are not archived, `size` at a
 * time. */
async function projectPage(
  ctx: SettingsContext,
  auth: ProjectAuthContext,
  cursor: string | undefined,
  size: number,
) {
  const projects = await listProjects(ctx.sql, auth, { summary: true });
  return pageOf(
    projects.map((project) => project.id),
    cursor,
    size,
  );
}

/** Every agent resource of one page of the caller's projects. */
function agentListPage(read: ManagedKind['read']): ManagedKind['listPage'] {
  return async (ctx, auth, cursor) => {
    const page = await projectPage(ctx, auth, cursor, 10);
    const items: SettingsResource[] = [];
    for (const projectId of page.items) {
      for (const agent of await listProjectAgents(ctx.sql, auth, projectId)) {
        items.push(
          managedResource(
            `${projectId}/${agent.id}`,
            await read(ctx.sql, auth, [projectId, agent.id]),
          ),
        );
      }
    }
    return { items, nextCursor: page.nextCursor };
  };
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
  listPage: async (ctx, auth, cursor) => {
    const page = await projectPage(ctx, auth, cursor, 50);
    const items: SettingsResource[] = [];
    for (const projectId of page.items) {
      items.push(
        managedResource(
          projectId,
          await readProjectInstructionsConfiguration(ctx.sql, auth, projectId),
        ),
      );
    }
    return { items, nextCursor: page.nextCursor };
  },
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

export const agentModelSettings = managedKind({
  kind: 'agent-model',
  idFields: ['projectId', 'agentId'],
  idForm: '<projectId>/<agentId>',
  what: "the agent's model",
  schema: managedAgentModelSchema,
  read: readAgentModel,
  gate: gateAgent,
  write: (tx, auth, config, expectedHash) =>
    updateAgentModelConfiguration(
      tx,
      auth,
      managedAgentModelSchema.parse(config),
      expectedHash,
    ),
  listPage: agentListPage(readAgentModel),
});
