import { expectedConfigurationHashSchema } from '@tale/shared/schemas/configuration';
import {
  managedAgentInstructionsSchema,
  managedAgentModelSchema,
  managedAgentToolsSchema,
  managedProjectAgentSchema,
  managedProjectSchema,
  type ManagedObservation,
} from '@tale/shared/schemas/managed-configuration';
import type { Sql, TransactionSql } from 'postgres';
import { z } from 'zod';

import { assertExpectedHash } from '../../core/lib/config_store/precondition.ts';
import { managedConfigurationHash } from '../../core/lib/config_store/value_hash.ts';
import { ensureDefaultProjectLabels } from '../tasks/service.ts';
import {
  assertCanCreateProjects,
  assertReadable,
  createProject,
  createProjectAgent,
  getProjectAgent,
  loadProjectOrThrow,
  ProjectError,
  updateProjectAgent,
  updateProjectIdentity,
  updateProjectSharing,
  type ProjectAgentRow,
  type ProjectAuthContext,
  type ProjectRow,
} from './service.ts';

/**
 * Projects and project agents as managed configuration declares them
 * (`project`, `project-agent`): read in the shape a declaration states, and
 * created under the stable UUID the declaration chose or brought in line
 * with it — always through the writers the app's own screens use, so their
 * roles, limits, audit rows and hints hold unchanged. A declaration that
 * leaves a field out keeps what is stored (`keptWhenOmitted` in
 * `@tale/shared/config/platform-resources`); a resource absent from a
 * declaration is never deleted.
 */

/** Whether a row of `table` holds the id, in any organization: only an id
 * nothing holds reads as absent, so a creation under it can succeed. */
async function idTaken(
  sql: Sql | TransactionSql,
  table: 'projects' | 'project_agents',
  id: string,
): Promise<boolean> {
  const rows =
    table === 'projects'
      ? await sql<
          { id: string }[]
        >`SELECT id FROM app.projects WHERE id = ${id}`
      : await sql<
          { id: string }[]
        >`SELECT id FROM app.project_agents WHERE id = ${id}`;
  return rows.length > 0;
}

/** A project in the shape its declaration reads. */
export function managedProjectView(
  project: ProjectRow,
): ManagedObservation<'project'> {
  return {
    projectId: project.id,
    name: project.name,
    description: project.description,
    teamIds: project.teamIds,
  };
}

/** A project as managed configuration reads it, or `null` with no hash when
 * none exists under the id and the declaration may create it. An id another
 * organization holds is not found, as it is everywhere. */
export async function readManagedProject(
  sql: Sql | TransactionSql,
  auth: ProjectAuthContext,
  projectId: string,
  createIfMissing = false,
) {
  if (createIfMissing && !(await idTaken(sql, 'projects', projectId)))
    return { config: null, hash: null };
  const project = await loadProjectOrThrow(sql, projectId);
  assertReadable(project, auth);
  const config = managedProjectView(project);
  return { config, hash: managedConfigurationHash(config) };
}

export const managedProjectWriteSchema = z.strictObject({
  config: managedProjectSchema,
  expectedHash: expectedConfigurationHashSchema,
  createIfMissing: z.literal(true).optional(),
  key: z.string().optional(),
});

/**
 * Create the declared project under its UUID — with the default labels a
 * project created in the app gets — or bring an existing one's name,
 * description and audience in line, each through its own writer: renaming
 * takes whoever may edit the project, its audience an owner or admin. The
 * project's key is chosen once, when it is created. Compare-and-set on the
 * hash the declaration's plan read, in the caller's serializable
 * transaction.
 */
export async function writeManagedProject(
  tx: TransactionSql,
  auth: ProjectAuthContext,
  args: z.infer<typeof managedProjectWriteSchema>,
): Promise<void> {
  const config = managedProjectSchema.parse(args.config);
  const rows = await tx<{ id: string }[]>`
    SELECT id FROM app.projects WHERE id = ${config.projectId} FOR UPDATE
  `;
  if (rows.length === 0) {
    if (args.createIfMissing !== true)
      throw new ProjectError('PROJECT_NOT_FOUND', 'Project not found', 404);
    assertExpectedHash(null, args.expectedHash);
    assertCanCreateProjects(auth);
    await createProject(
      tx,
      auth,
      {
        name: config.name,
        ...(config.description != null
          ? { description: config.description }
          : {}),
        ...(config.teamIds !== undefined ? { teamIds: config.teamIds } : {}),
        ...(args.key !== undefined ? { key: args.key } : {}),
      },
      { projectId: config.projectId },
    );
    await ensureDefaultProjectLabels(tx, {
      organizationId: auth.organizationId,
      projectId: config.projectId,
      createdBy: auth.userId,
    });
    return;
  }
  const project = await loadProjectOrThrow(tx, config.projectId);
  assertReadable(project, auth);
  assertExpectedHash(
    managedConfigurationHash(managedProjectView(project)),
    args.expectedHash,
  );
  await updateProjectIdentity(tx, auth, {
    projectId: config.projectId,
    name: config.name,
    ...(config.description !== undefined
      ? { description: config.description }
      : {}),
  });
  // Only a changed audience goes through its writer, which takes an owner or
  // admin even to restate it: an editor renaming the project while its
  // declaration names the teams it already has is not changing who sees it.
  // Order counts: the first team is the project's owning team.
  if (
    config.teamIds !== undefined &&
    config.teamIds.join('\u0000') !== project.teamIds.join('\u0000')
  )
    await updateProjectSharing(tx, auth, {
      projectId: config.projectId,
      teamIds: config.teamIds,
    });
}

const byName = (left: string, right: string) =>
  left < right ? -1 : left > right ? 1 : 0;

/** A project agent in the shape its declaration reads: its equipment as
 * sets, in one order. */
export function managedProjectAgentView(
  agent: ProjectAgentRow,
): ManagedObservation<'project-agent'> {
  return {
    projectId: agent.projectId,
    agentId: agent.id,
    name: agent.name,
    connectors: [...agent.connectors].sort(byName),
    secrets: [...agent.secrets].sort(byName),
    skills: [...agent.skills].sort(byName),
    connectorCredentials: Object.fromEntries(
      Object.entries(agent.connectorCredentials).sort(([left], [right]) =>
        byName(left, right),
      ),
    ),
    gitIdentity: agent.gitIdentity,
  };
}

/** A project agent as managed configuration reads it, or `null` with no
 * hash when none exists under the id and the declaration may create it. */
export async function readManagedProjectAgent(
  sql: Sql | TransactionSql,
  auth: ProjectAuthContext,
  projectId: string,
  agentId: string,
  createIfMissing = false,
) {
  const agent = await getProjectAgent(sql, auth, projectId, agentId);
  if (agent === null) {
    if (createIfMissing && !(await idTaken(sql, 'project_agents', agentId)))
      return { config: null, hash: null };
    throw new ProjectError('PROJECT_AGENT_NOT_FOUND', 'Agent not found', 404);
  }
  const config = managedProjectAgentView(agent);
  return { config, hash: managedConfigurationHash(config) };
}

/** What a new agent starts with that other kinds own: the runtime and model
 * its declared `agent-model` names, and the instructions and tools its
 * declared `agent-instructions` and `agent-tools` name, so it never runs a
 * moment on anything else. */
const managedProjectAgentSeedSchema = z.strictObject({
  harness: managedAgentModelSchema.shape.harness,
  model: managedAgentModelSchema.shape.model,
  modelProvider: managedAgentModelSchema.shape.modelProvider,
  instructions: managedAgentInstructionsSchema.shape.instructions.optional(),
  tools: managedAgentToolsSchema.shape.tools.optional(),
});

export const managedProjectAgentWriteSchema = z.strictObject({
  config: managedProjectAgentSchema,
  expectedHash: expectedConfigurationHashSchema,
  createIfMissing: z.literal(true).optional(),
  seed: managedProjectAgentSeedSchema.optional(),
});

/**
 * Create the declared agent under its UUID with its seed, or bring an
 * existing one's name and equipment in line, through the writers the
 * project's Agents tab uses: the editor role on an active project, the
 * project's equipment, secret grants and credential pins only from who may
 * grant them, and a secret or credential the organization does not hold
 * refused rather than dropped. The
 * organization's standard agent is never changed here. Its runtime, model,
 * instructions and tools stay as stored.
 */
export async function writeManagedProjectAgent(
  tx: TransactionSql,
  auth: ProjectAuthContext,
  args: z.infer<typeof managedProjectAgentWriteSchema>,
): Promise<void> {
  const config = managedProjectAgentSchema.parse(args.config);
  await tx`
    SELECT id FROM app.project_agents WHERE id = ${config.agentId} FOR UPDATE
  `;
  const agent = await getProjectAgent(
    tx,
    auth,
    config.projectId,
    config.agentId,
  );
  assertExpectedHash(
    agent === null
      ? null
      : managedConfigurationHash(managedProjectAgentView(agent)),
    args.expectedHash,
  );
  if (agent === null) {
    if (args.createIfMissing !== true)
      throw new ProjectError('PROJECT_AGENT_NOT_FOUND', 'Agent not found', 404);
    if (args.seed === undefined)
      throw new ProjectError(
        'PROJECT_AGENT_SEED_REQUIRED',
        'A created agent needs the runtime and model its declaration names',
      );
    await createProjectAgent(
      tx,
      auth,
      {
        projectId: config.projectId,
        name: config.name,
        harness: args.seed.harness,
        model: args.seed.model,
        modelProvider: args.seed.modelProvider,
        skills: config.skills ?? [],
        connectors: config.connectors ?? [],
        ...(args.seed.tools !== undefined ? { tools: args.seed.tools } : {}),
        secrets: config.secrets ?? [],
        connectorCredentials: config.connectorCredentials ?? {},
        gitIdentity: config.gitIdentity ?? null,
        ...(args.seed.instructions !== undefined
          ? { instructions: args.seed.instructions }
          : {}),
        unknownSecrets: 'refuse',
      },
      { agentId: config.agentId },
    );
    return;
  }
  // The full-agent writer replaces every field: what this kind does not
  // own goes back as stored.
  await updateProjectAgent(tx, auth, {
    agentId: agent.id,
    name: config.name,
    harness: agent.harness,
    model: agent.model,
    ...(agent.modelProvider !== null
      ? { modelProvider: agent.modelProvider }
      : {}),
    skills: config.skills ?? agent.skills,
    connectors: config.connectors ?? agent.connectors,
    tools: agent.tools,
    secrets: config.secrets ?? agent.secrets,
    connectorCredentials:
      config.connectorCredentials ?? agent.connectorCredentials,
    gitIdentity:
      config.gitIdentity !== undefined ? config.gitIdentity : agent.gitIdentity,
    ...(agent.instructions !== null
      ? { instructions: agent.instructions }
      : {}),
    unknownSecrets: 'refuse',
  });
}
