import type { Sql, TransactionSql } from 'postgres';

import { isHarnessSlug } from '../../../lib/harnesses/types.ts';
import {
  deriveProjectKey,
  isValidProjectKey,
  normalizeProjectKey,
  PROJECT_KEY_MAX,
} from '../../../lib/shared/project_key.ts';
import {
  PROJECT_DESCRIPTION_MAX,
  PROJECT_INSTRUCTIONS_MAX_CHARS,
  PROJECT_NAME_MAX,
  PROJECT_SHARED_TEAMS_MAX,
} from '../../../lib/shared/schemas/projects.ts';
import { getUserTeamIds } from '../../auth/membership.ts';
import {
  ADMIN_ROLES,
  checkProjectAccess,
  EDITOR_ROLES,
  isOrgWideProject,
  normalizeSharing,
} from '../../core/projects/access.ts';
import {
  PROJECT_AUDIT_ACTIONS,
  PROJECT_RESOURCE_TYPE,
} from '../../core/projects/audit_actions.ts';
import { normalizeToolGrants } from '../../core/sandbox/tool_names.ts';
import { emitHintInTx } from '../../realtime/outbox.ts';
import { createAuditLog } from '../audit_logs/service.ts';
import { recordTrashRefusalFromJson } from '../documents/service.ts';
import { emitEvent } from '../events/emit.ts';
import {
  assertNotHeld,
  LegalHoldError,
  loadActiveHolds,
} from '../legal_holds/service.ts';
import { retireTasksInTx } from '../tasks/retire.ts';

/**
 * Projects domain — ported from `convex/projects/*` with the pure access
 * matrix (`convex/projects/access.ts`) and key derivation reused unchanged.
 * Every write runs in the caller's serializable transaction with its audit
 * row; per-org uniqueness of `key`/`externalItemId` is enforced by partial
 * unique indexes (probes remain for friendly error codes).
 *
 * Ledger notes: `attach/detachDocument`, `moveThreadToProject` and the
 * delete-cascade over documents/threads/tasks land with those domains (the
 * cascade counts return 0 until then); the bound-automations delete guard
 * lands with automations; `emitEvent` producers land with events; the
 * `ensureDefaultProjectLabels` seed + overdue rollup land with tasks; secret
 * pruning lands with agent_secrets; the REST v1 surface + upload intents
 * land with the machine door.
 */

// Name/description/instructions/sharing caps come from the shared schema
// file — the editor counts against the same constants.
const PROJECT_EXTERNAL_ITEM_ID_MAX = 256;

const MAX_PROJECT_AGENT_SKILLS = 25;
const MAX_PROJECT_AGENT_CONNECTORS = 25;
const MAX_PROJECT_AGENT_TOOLS = 25;
const MAX_PROJECT_AGENT_SECRETS = 25;
const MAX_PROJECT_AGENTS = 50;
const PROJECT_AGENT_NAME_MAX = 120;
const PROJECT_AGENT_MODEL_MAX = 200;
const PROJECT_AGENT_INSTRUCTIONS_MAX = 20_000;
const PROJECT_AGENT_INELIGIBLE_HARNESSES = new Set(['cursor']);

export class ProjectError extends Error {
  readonly code: string;
  readonly status: 400 | 403 | 404 | 429;
  readonly data: Record<string, unknown> | undefined;

  constructor(
    code: string,
    message: string,
    status: 400 | 403 | 404 | 429 = 400,
    data?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ProjectError';
    this.code = code;
    this.status = status;
    this.data = data;
  }
}

export interface ProjectAuthContext {
  organizationId: string;
  userId: string;
  email?: string;
  role: string;
  teamIds: string[];
}

/** Resolve the caller's role + team ids for project access checks. */
export async function getProjectAuthContext(
  sql: Sql | TransactionSql,
  member: { organizationId: string; userId: string; role: string },
  email?: string,
): Promise<ProjectAuthContext> {
  const teamIds = await getUserTeamIds(sql, member.userId);
  return {
    organizationId: member.organizationId,
    userId: member.userId,
    ...(email !== undefined ? { email } : {}),
    role: member.role,
    teamIds,
  };
}

export interface ProjectRow {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  key: string | null;
  externalItemId: string | null;
  taskCounter: number;
  openTaskCount: number;
  doneTaskCount: number;
  projectAgentCount: number;
  teamId: string | null;
  sharedWithTeamIds: string[];
  instructions: string | null;
  knowledgeMode: string | null;
  agentMode: string | null;
  recommendedAgentSlugs: string[];
  allowedAgentSlugs: string[];
  modelMode: string | null;
  recommendedModels: string[];
  allowedModels: string[];
  connectorsMode: string | null;
  allowedConnectorSlugs: string[];
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  archivedAt: number | null;
  pinnedAt: number | null;
}

const PROJECT_COLUMNS = `
  id, org_id AS "organizationId", name, description, icon, color, key,
  external_item_id AS "externalItemId", task_counter AS "taskCounter",
  open_task_count AS "openTaskCount", done_task_count AS "doneTaskCount",
  project_agent_count AS "projectAgentCount", team_id AS "teamId",
  shared_with_team_ids AS "sharedWithTeamIds", instructions,
  knowledge_mode AS "knowledgeMode", agent_mode AS "agentMode",
  recommended_agent_slugs AS "recommendedAgentSlugs",
  allowed_agent_slugs AS "allowedAgentSlugs", model_mode AS "modelMode",
  recommended_models AS "recommendedModels", allowed_models AS "allowedModels",
  connectors_mode AS "connectorsMode",
  allowed_connector_slugs AS "allowedConnectorSlugs",
  created_by AS "createdBy", created_at_ms::float8 AS "createdAt",
  updated_at_ms::float8 AS "updatedAt", archived_at_ms::float8 AS "archivedAt",
  pinned_at_ms::float8 AS "pinnedAt"
`;

/** Project access input in the shape the reused 0.4 matrix expects. */
function accessInput(project: ProjectRow): {
  teamId: string | null;
  sharedWithTeamIds: string[];
} {
  return {
    teamId: project.teamId,
    sharedWithTeamIds: project.sharedWithTeamIds,
  };
}

/** A project row stamped with the caller's access flags — the 0.4 list-item
 * shape the UI branches on (row actions, settings tabs, table columns). */
export interface ProjectListRow extends ProjectRow {
  isOrgWide: boolean;
  canEdit: boolean;
  canAdminister: boolean;
}

function stampAccessFlags(
  row: ProjectRow,
  auth: ProjectAuthContext,
): ProjectListRow {
  const access = checkProjectAccess(accessInput(row), auth.teamIds, auth.role);
  return Object.assign(row, {
    isOrgWide: isOrgWideProject(accessInput(row)),
    canEdit: access.canEdit,
    canAdminister: access.canAdminister,
  });
}

/** Org-wide invalidation hint for the projects surface (browsers listening
 * on /events refetch their `project` reads — session AND machine-door writes). */
async function hintProject(
  tx: Sql | TransactionSql,
  organizationId: string,
  projectId: string,
): Promise<void> {
  await emitHintInTx(tx, {
    orgId: organizationId,
    entity: 'project',
    entityId: projectId,
  });
}

export async function loadProjectOrThrow(
  sql: Sql | TransactionSql,
  projectId: string,
): Promise<ProjectRow> {
  const rows = await sql<ProjectRow[]>`
    SELECT ${sql.unsafe(PROJECT_COLUMNS)} FROM app.projects
    WHERE id = ${projectId} LIMIT 1
  `;
  const project = rows[0];
  if (!project) {
    throw new ProjectError('PROJECT_NOT_FOUND', 'Project not found', 404);
  }
  return project;
}

function assertSameOrg(project: ProjectRow, auth: ProjectAuthContext): void {
  if (project.organizationId !== auth.organizationId) {
    throw new ProjectError('PROJECT_NOT_FOUND', 'Project not found', 404);
  }
}

export function assertReadable(
  project: ProjectRow,
  auth: ProjectAuthContext,
): void {
  assertSameOrg(project, auth);
  const access = checkProjectAccess(
    accessInput(project),
    auth.teamIds,
    auth.role,
  );
  if (!access.canRead) {
    throw new ProjectError('PROJECT_FORBIDDEN', 'No project access', 403);
  }
}

export function assertWritable(
  project: ProjectRow,
  auth: ProjectAuthContext,
): void {
  assertSameOrg(project, auth);
  const access = checkProjectAccess(
    accessInput(project),
    auth.teamIds,
    auth.role,
  );
  if (!access.canRead) {
    throw new ProjectError('PROJECT_FORBIDDEN', 'No project access', 403);
  }
  if (!access.canEdit) {
    throw new ProjectError('RBAC_FORBIDDEN', 'Editor role required', 403);
  }
}

function assertAdmin(auth: ProjectAuthContext): void {
  if (!ADMIN_ROLES.has(auth.role)) {
    throw new ProjectError('ROLE_FORBIDDEN', 'Admin role required', 403);
  }
}

/** Project-level administer right (the 0.4 secrets gate — org admins and
 * the project's own administrators, per the reused access matrix). */
export function assertProjectAdministrable(
  project: ProjectRow,
  auth: ProjectAuthContext,
): void {
  assertSameOrg(project, auth);
  const access = checkProjectAccess(
    accessInput(project),
    auth.teamIds,
    auth.role,
  );
  if (!access.canAdminister) {
    throw new ProjectError('PROJECT_FORBIDDEN', 'No project access', 403);
  }
}

export function assertCanCreateProjects(auth: ProjectAuthContext): void {
  if (!EDITOR_ROLES.has(auth.role)) {
    throw new ProjectError('RBAC_FORBIDDEN', 'Editor role required', 403);
  }
}

// ---------------------------------------------------------------------------
// Field validation (0.4-faithful)
// ---------------------------------------------------------------------------

function validateName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new ProjectError(
      'PROJECT_NAME_INVALID',
      'Project name cannot be empty',
    );
  }
  if (trimmed.length > PROJECT_NAME_MAX) {
    throw new ProjectError(
      'PROJECT_NAME_INVALID',
      `Project name must be at most ${PROJECT_NAME_MAX} characters`,
    );
  }
  return trimmed;
}

function validateDescription(
  description: string | undefined,
): string | undefined {
  if (description == null) {
    return undefined;
  }
  const trimmed = description.trim();
  if (trimmed.length > PROJECT_DESCRIPTION_MAX) {
    throw new ProjectError(
      'PROJECT_DESCRIPTION_INVALID',
      'Description too long',
    );
  }
  return trimmed.length > 0 ? trimmed : undefined;
}

function validateInstructions(instructions: string): string {
  if (instructions.length > PROJECT_INSTRUCTIONS_MAX_CHARS) {
    throw new ProjectError(
      'PROJECT_INSTRUCTIONS_TOO_LONG',
      'Instructions too long',
      400,
      { cap: PROJECT_INSTRUCTIONS_MAX_CHARS },
    );
  }
  return instructions;
}

function validateSharing(
  teamId: string | null | undefined,
  sharedWithTeamIds: string[] | undefined,
): void {
  if (!sharedWithTeamIds) {
    return;
  }
  if (sharedWithTeamIds.length > PROJECT_SHARED_TEAMS_MAX) {
    throw new ProjectError('PROJECT_SHARING_INVALID', 'Too many shared teams');
  }
  const set = new Set(sharedWithTeamIds);
  if (set.size !== sharedWithTeamIds.length) {
    throw new ProjectError('PROJECT_SHARING_INVALID', 'Duplicate shared teams');
  }
  if (teamId && set.has(teamId)) {
    throw new ProjectError(
      'PROJECT_SHARING_INVALID',
      'Owning team cannot also be a shared team',
    );
  }
}

function validateRecommendedSubsetOfAllowed(
  mode: 'all' | 'recommended' | 'restricted',
  recommended: string[] | undefined,
  allowed: string[] | undefined,
): void {
  if (mode !== 'restricted' || !recommended || recommended.length === 0) {
    return;
  }
  const allowedSet = new Set(allowed ?? []);
  for (const item of recommended) {
    if (!allowedSet.has(item)) {
      throw new ProjectError(
        'PROJECT_RECOMMENDED_NOT_SUBSET',
        'Recommended items must be a subset of allowed items',
      );
    }
  }
}

async function keyTaken(
  tx: TransactionSql | Sql,
  organizationId: string,
  key: string,
): Promise<boolean> {
  const rows = await tx<{ id: string }[]>`
    SELECT id FROM app.projects
    WHERE org_id = ${organizationId} AND key = ${key} LIMIT 1
  `;
  return rows.length > 0;
}

async function resolveProjectKey(
  tx: TransactionSql | Sql,
  organizationId: string,
  rawKey: string | undefined,
  name: string,
): Promise<string> {
  const key = normalizeProjectKey(rawKey?.trim() || deriveProjectKey(name));
  if (!isValidProjectKey(key)) {
    throw new ProjectError(
      'PROJECT_KEY_INVALID',
      'Project key must be 2-6 characters, letters and digits only',
    );
  }
  if (await keyTaken(tx, organizationId, key)) {
    throw new ProjectError(
      'PROJECT_KEY_TAKEN',
      `Project key "${key}" is already taken in this organization`,
    );
  }
  return key;
}

async function resolveDuplicateProjectKey(
  tx: TransactionSql | Sql,
  organizationId: string,
  name: string,
): Promise<string | undefined> {
  const base = deriveProjectKey(name);
  if (!isValidProjectKey(base)) {
    return undefined;
  }
  for (let n = 0; n < 1000; n += 1) {
    const candidate =
      n === 0
        ? base
        : `${base.slice(0, PROJECT_KEY_MAX - String(n).length)}${n}`;
    if (!isValidProjectKey(candidate)) {
      continue;
    }
    if (!(await keyTaken(tx, organizationId, candidate))) {
      return candidate;
    }
  }
  return undefined;
}

async function resolveExternalItemId(
  tx: TransactionSql | Sql,
  organizationId: string,
  raw: string | undefined,
): Promise<string | undefined> {
  if (raw == null) {
    return undefined;
  }
  const externalItemId = raw.trim();
  if (
    externalItemId.length === 0 ||
    externalItemId.length > PROJECT_EXTERNAL_ITEM_ID_MAX
  ) {
    throw new ProjectError(
      'PROJECT_EXTERNAL_ITEM_ID_INVALID',
      `externalItemId must be 1-${PROJECT_EXTERNAL_ITEM_ID_MAX} characters after trimming`,
    );
  }
  const rows = await tx<{ id: string }[]>`
    SELECT id FROM app.projects
    WHERE org_id = ${organizationId} AND external_item_id = ${externalItemId}
    LIMIT 1
  `;
  if (rows.length > 0) {
    throw new ProjectError(
      'PROJECT_DUPLICATE_EXTERNAL_ID',
      `A project with externalItemId "${externalItemId}" already exists in this organization`,
      400,
      { externalItemId },
    );
  }
  return externalItemId;
}

function diff(
  previous: Record<string, unknown>,
  next: Record<string, unknown>,
): string[] {
  const changed: string[] = [];
  const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);
  for (const k of keys) {
    if (JSON.stringify(previous[k]) !== JSON.stringify(next[k])) {
      changed.push(k);
    }
  }
  return changed;
}

function arrayDiff(
  previous: string[] | undefined,
  next: string[] | undefined,
): { added: string[]; removed: string[] } {
  const prev = new Set(previous ?? []);
  const nxt = new Set(next ?? []);
  return {
    added: [...nxt].filter((item) => !prev.has(item)),
    removed: [...prev].filter((item) => !nxt.has(item)),
  };
}

function projectAudit(
  auth: ProjectAuthContext,
  project: { id: string; name: string },
  action: string,
  extra: {
    previousState?: Record<string, unknown>;
    newState?: Record<string, unknown>;
    changedFields?: string[];
    metadata?: Record<string, unknown>;
  } = {},
) {
  return {
    organizationId: auth.organizationId,
    actorId: auth.userId,
    ...(auth.email !== undefined ? { actorEmail: auth.email } : {}),
    actorType: 'user' as const,
    action,
    category: 'data' as const,
    resourceType: PROJECT_RESOURCE_TYPE,
    resourceId: project.id,
    resourceName: project.name,
    status: 'success' as const,
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// Create / duplicate
// ---------------------------------------------------------------------------

export interface CreateProjectArgs {
  name: string;
  key?: string;
  description?: string;
  icon?: string;
  color?: string;
  externalItemId?: string;
  teamId?: string;
  sharedWithTeamIds?: string[];
  /** Machine door: resolve derived-key collisions by suffix, not error. */
  deriveKeyOnCollision?: boolean;
}

/**
 * The one create-project core (session route and machine door share it).
 * Callers own authentication, the editor gate, and the rate charge.
 * TODO(tasks): seed default project labels; TODO(events): project.created.
 */
export async function createProject(
  tx: TransactionSql,
  auth: ProjectAuthContext,
  args: CreateProjectArgs,
): Promise<string> {
  const name = validateName(args.name);
  const description = validateDescription(args.description);
  const externalItemId = await resolveExternalItemId(
    tx,
    auth.organizationId,
    args.externalItemId,
  );
  const key =
    args.deriveKeyOnCollision && !args.key?.trim()
      ? await resolveDuplicateProjectKey(tx, auth.organizationId, name)
      : await resolveProjectKey(tx, auth.organizationId, args.key, name);
  const sharedWithTeamIds = args.sharedWithTeamIds ?? [];
  validateSharing(args.teamId, args.sharedWithTeamIds);

  const now = Date.now();
  const inserted = await tx<{ id: string }[]>`
    INSERT INTO app.projects (
      org_id, name, key, external_item_id, description, icon, color,
      team_id, shared_with_team_ids, created_by, created_at_ms, updated_at_ms
    ) VALUES (
      ${auth.organizationId}, ${name}, ${key ?? null},
      ${externalItemId ?? null}, ${description ?? null}, ${args.icon ?? null},
      ${args.color ?? null}, ${args.teamId || null}, ${sharedWithTeamIds},
      ${auth.userId}, ${now}, ${now}
    )
    RETURNING id
  `;
  const projectId = inserted[0]?.id;
  if (!projectId) {
    throw new ProjectError('PROJECT_CREATE_FAILED', 'Insert failed');
  }

  await createAuditLog(
    tx,
    projectAudit(auth, { id: projectId, name }, PROJECT_AUDIT_ACTIONS.created, {
      newState: { name, teamId: args.teamId ?? null, sharedWithTeamIds },
      metadata: { isOrgWide: !args.teamId && sharedWithTeamIds.length === 0 },
    }),
  );
  await emitEvent(tx, {
    organizationId: auth.organizationId,
    eventType: 'project.created',
    eventData: { projectId, name, actorId: auth.userId },
  });
  await hintProject(tx, auth.organizationId, projectId);
  return projectId;
}

/** Duplicate settings (never content); "(copy)" naming, suffix-resolved key. */
export async function duplicateProject(
  tx: TransactionSql,
  auth: ProjectAuthContext,
  projectId: string,
  name?: string,
): Promise<string> {
  const source = await loadProjectOrThrow(tx, projectId);
  assertReadable(source, auth);
  assertCanCreateProjects(auth);

  let nextName: string;
  if (name !== undefined) {
    nextName = validateName(name);
  } else {
    const suffix = ' (copy)';
    const room = PROJECT_NAME_MAX - suffix.length;
    const base =
      source.name.length > room ? source.name.slice(0, room) : source.name;
    nextName = `${base}${suffix}`;
  }
  const key = await resolveDuplicateProjectKey(
    tx,
    auth.organizationId,
    nextName,
  );

  const now = Date.now();
  const inserted = await tx<{ id: string }[]>`
    INSERT INTO app.projects (
      org_id, name, key, description, icon, color, team_id,
      shared_with_team_ids, instructions, knowledge_mode, agent_mode,
      recommended_agent_slugs, allowed_agent_slugs, model_mode,
      recommended_models, allowed_models, connectors_mode,
      allowed_connector_slugs, created_by, created_at_ms, updated_at_ms
    ) VALUES (
      ${auth.organizationId}, ${nextName}, ${key ?? null},
      ${source.description}, ${source.icon}, ${source.color},
      ${source.teamId}, ${source.sharedWithTeamIds}, ${source.instructions},
      ${source.knowledgeMode}, ${source.agentMode},
      ${source.recommendedAgentSlugs}, ${source.allowedAgentSlugs},
      ${source.modelMode}, ${source.recommendedModels},
      ${source.allowedModels}, ${source.connectorsMode},
      ${source.allowedConnectorSlugs}, ${auth.userId}, ${now}, ${now}
    )
    RETURNING id
  `;
  const newProjectId = inserted[0]?.id;
  if (!newProjectId) {
    throw new ProjectError('PROJECT_CREATE_FAILED', 'Insert failed');
  }
  await createAuditLog(
    tx,
    projectAudit(
      auth,
      { id: newProjectId, name: nextName },
      PROJECT_AUDIT_ACTIONS.created,
      {
        newState: {
          name: nextName,
          teamId: source.teamId,
          sharedWithTeamIds: source.sharedWithTeamIds,
        },
        metadata: { duplicatedFrom: projectId },
      },
    ),
  );
  await hintProject(tx, auth.organizationId, newProjectId);
  return newProjectId;
}

// ---------------------------------------------------------------------------
// Settings mutations (each: write gate + validate + patch + audit)
// ---------------------------------------------------------------------------

export async function updateProjectIdentity(
  tx: TransactionSql,
  auth: ProjectAuthContext,
  args: {
    projectId: string;
    name?: string;
    description?: string | null;
    icon?: string | null;
    color?: string | null;
  },
): Promise<void> {
  const project = await loadProjectOrThrow(tx, args.projectId);
  assertWritable(project, auth);

  const previousState: Record<string, unknown> = {};
  const newState: Record<string, unknown> = {};
  const sets: string[] = [];
  const values: (string | null)[] = [];
  if (args.name !== undefined) {
    const name = validateName(args.name);
    sets.push('name');
    values.push(name);
    previousState.name = project.name;
    newState.name = name;
  }
  if (args.description !== undefined) {
    const desc =
      args.description === null
        ? undefined
        : validateDescription(args.description);
    sets.push('description');
    values.push(desc ?? null);
    previousState.description = project.description;
    newState.description = desc ?? null;
  }
  if (args.icon !== undefined) {
    sets.push('icon');
    values.push(args.icon);
    previousState.icon = project.icon;
    newState.icon = args.icon;
  }
  if (args.color !== undefined) {
    sets.push('color');
    values.push(args.color);
    previousState.color = project.color;
    newState.color = args.color;
  }
  if (sets.length === 0) {
    return;
  }

  // Column names come from the closed literal list above, never from input.
  const assignments = sets
    .map((column, index) => `${column} = $${index + 1}`)
    .join(', ');
  await tx.unsafe(
    `UPDATE app.projects SET ${assignments}, updated_at_ms = $${sets.length + 1} WHERE id = $${sets.length + 2}`,
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- positional params for a column list closed over literals
    [...values, Date.now(), args.projectId] as never[],
  );

  await createAuditLog(
    tx,
    projectAudit(auth, project, PROJECT_AUDIT_ACTIONS.updated, {
      previousState,
      newState,
      changedFields: diff(previousState, newState),
    }),
  );
  await hintProject(tx, auth.organizationId, args.projectId);
}

/** Pin/unpin in the sidebar — read access suffices (benign UI preference). */
export async function setProjectPinned(
  tx: TransactionSql,
  auth: ProjectAuthContext,
  projectId: string,
  pinned: boolean,
): Promise<void> {
  const project = await loadProjectOrThrow(tx, projectId);
  assertReadable(project, auth);
  await tx`
    UPDATE app.projects SET pinned_at_ms = ${pinned ? Date.now() : null}
    WHERE id = ${projectId}
  `;
  await createAuditLog(
    tx,
    projectAudit(auth, project, PROJECT_AUDIT_ACTIONS.updated, {
      changedFields: ['pinnedAt'],
    }),
  );
  await hintProject(tx, auth.organizationId, projectId);
}

export async function updateProjectInstructions(
  tx: TransactionSql,
  auth: ProjectAuthContext,
  projectId: string,
  instructions: string,
): Promise<void> {
  const project = await loadProjectOrThrow(tx, projectId);
  assertWritable(project, auth);
  const validated = validateInstructions(instructions);
  await tx`
    UPDATE app.projects SET
      instructions = ${validated.length > 0 ? validated : null},
      updated_at_ms = ${Date.now()}
    WHERE id = ${projectId}
  `;
  await createAuditLog(
    tx,
    projectAudit(auth, project, PROJECT_AUDIT_ACTIONS.instructionsChanged, {
      metadata: {
        previousLength: project.instructions?.length ?? 0,
        newLength: validated.length,
      },
    }),
  );
  await hintProject(tx, auth.organizationId, projectId);
}

export async function updateProjectSharing(
  tx: TransactionSql,
  auth: ProjectAuthContext,
  args: {
    projectId: string;
    teamId?: string | null;
    sharedWithTeamIds?: string[];
  },
): Promise<void> {
  const project = await loadProjectOrThrow(tx, args.projectId);
  assertReadable(project, auth);
  assertAdmin(auth);

  const nextTeamId =
    args.teamId === undefined ? project.teamId : args.teamId || null;
  const nextShared = args.sharedWithTeamIds ?? project.sharedWithTeamIds;
  validateSharing(nextTeamId, nextShared);
  const normalized = normalizeSharing(nextTeamId, nextShared);

  const previousState = {
    teamId: project.teamId,
    sharedWithTeamIds: project.sharedWithTeamIds,
  };
  const newState = {
    teamId: normalized.teamId,
    sharedWithTeamIds: normalized.sharedWithTeamIds,
  };
  await tx`
    UPDATE app.projects SET
      team_id = ${normalized.teamId},
      shared_with_team_ids = ${normalized.sharedWithTeamIds},
      updated_at_ms = ${Date.now()}
    WHERE id = ${args.projectId}
  `;
  await createAuditLog(
    tx,
    projectAudit(auth, project, PROJECT_AUDIT_ACTIONS.sharingChanged, {
      previousState,
      newState,
      changedFields: diff(previousState, newState),
    }),
  );
  await hintProject(tx, auth.organizationId, args.projectId);
}

export async function updateProjectKnowledgeMode(
  tx: TransactionSql,
  auth: ProjectAuthContext,
  projectId: string,
  knowledgeMode: 'off' | 'tool' | 'context' | 'both',
): Promise<void> {
  const project = await loadProjectOrThrow(tx, projectId);
  assertWritable(project, auth);
  await tx`
    UPDATE app.projects SET
      knowledge_mode = ${knowledgeMode}, updated_at_ms = ${Date.now()}
    WHERE id = ${projectId}
  `;
  await createAuditLog(
    tx,
    projectAudit(auth, project, PROJECT_AUDIT_ACTIONS.knowledgeModeChanged, {
      previousState: { knowledgeMode: project.knowledgeMode },
      newState: { knowledgeMode },
    }),
  );
  await hintProject(tx, auth.organizationId, projectId);
}

type RestrictionMode = 'all' | 'recommended' | 'restricted';

export async function updateProjectAgentSettings(
  tx: TransactionSql,
  auth: ProjectAuthContext,
  args: {
    projectId: string;
    agentMode: RestrictionMode;
    recommendedAgentSlugs?: string[];
    allowedAgentSlugs?: string[];
  },
): Promise<void> {
  const project = await loadProjectOrThrow(tx, args.projectId);
  assertWritable(project, auth);

  const previousState = {
    agentMode: project.agentMode ?? 'all',
    recommendedAgentSlugs: project.recommendedAgentSlugs,
    allowedAgentSlugs: project.allowedAgentSlugs,
  };
  const newState = {
    agentMode: args.agentMode,
    recommendedAgentSlugs: args.recommendedAgentSlugs ?? [],
    allowedAgentSlugs: args.allowedAgentSlugs ?? [],
  };
  validateRecommendedSubsetOfAllowed(
    args.agentMode,
    newState.recommendedAgentSlugs,
    newState.allowedAgentSlugs,
  );
  await tx`
    UPDATE app.projects SET
      agent_mode = ${args.agentMode},
      recommended_agent_slugs = ${newState.recommendedAgentSlugs},
      allowed_agent_slugs = ${newState.allowedAgentSlugs},
      updated_at_ms = ${Date.now()}
    WHERE id = ${args.projectId}
  `;
  const recommendedDiff = arrayDiff(
    previousState.recommendedAgentSlugs,
    newState.recommendedAgentSlugs,
  );
  const allowedDiff = arrayDiff(
    previousState.allowedAgentSlugs,
    newState.allowedAgentSlugs,
  );
  await createAuditLog(
    tx,
    projectAudit(auth, project, PROJECT_AUDIT_ACTIONS.agentsChanged, {
      previousState,
      newState,
      changedFields: diff(previousState, newState),
      metadata: {
        recommendedAdded: recommendedDiff.added,
        recommendedRemoved: recommendedDiff.removed,
        allowedAdded: allowedDiff.added,
        allowedRemoved: allowedDiff.removed,
      },
    }),
  );
  await hintProject(tx, auth.organizationId, args.projectId);
}

export async function updateProjectModelSettings(
  tx: TransactionSql,
  auth: ProjectAuthContext,
  args: {
    projectId: string;
    modelMode: RestrictionMode;
    recommendedModels?: string[];
    allowedModels?: string[];
  },
): Promise<void> {
  const project = await loadProjectOrThrow(tx, args.projectId);
  assertWritable(project, auth);
  const previousState = {
    modelMode: project.modelMode ?? 'all',
    recommendedModels: project.recommendedModels,
    allowedModels: project.allowedModels,
  };
  const newState = {
    modelMode: args.modelMode,
    recommendedModels: args.recommendedModels ?? [],
    allowedModels: args.allowedModels ?? [],
  };
  validateRecommendedSubsetOfAllowed(
    args.modelMode,
    newState.recommendedModels,
    newState.allowedModels,
  );
  await tx`
    UPDATE app.projects SET
      model_mode = ${args.modelMode},
      recommended_models = ${newState.recommendedModels},
      allowed_models = ${newState.allowedModels},
      updated_at_ms = ${Date.now()}
    WHERE id = ${args.projectId}
  `;
  await createAuditLog(
    tx,
    projectAudit(auth, project, PROJECT_AUDIT_ACTIONS.modelsChanged, {
      previousState,
      newState,
      changedFields: diff(previousState, newState),
    }),
  );
  await hintProject(tx, auth.organizationId, args.projectId);
}

export async function updateProjectConnectorSettings(
  tx: TransactionSql,
  auth: ProjectAuthContext,
  args: {
    projectId: string;
    connectorsMode: 'all' | 'restricted';
    allowedConnectorSlugs?: string[];
  },
): Promise<void> {
  const project = await loadProjectOrThrow(tx, args.projectId);
  assertWritable(project, auth);
  const previousState = {
    connectorsMode: project.connectorsMode ?? 'all',
    allowedConnectorSlugs: project.allowedConnectorSlugs,
  };
  const newState = {
    connectorsMode: args.connectorsMode,
    allowedConnectorSlugs: args.allowedConnectorSlugs ?? [],
  };
  await tx`
    UPDATE app.projects SET
      connectors_mode = ${args.connectorsMode},
      allowed_connector_slugs = ${newState.allowedConnectorSlugs},
      updated_at_ms = ${Date.now()}
    WHERE id = ${args.projectId}
  `;
  await createAuditLog(
    tx,
    projectAudit(auth, project, PROJECT_AUDIT_ACTIONS.connectorsChanged, {
      previousState,
      newState,
      changedFields: diff(previousState, newState),
    }),
  );
  await hintProject(tx, auth.organizationId, args.projectId);
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export async function archiveProject(
  tx: TransactionSql,
  auth: ProjectAuthContext,
  projectId: string,
): Promise<void> {
  const project = await loadProjectOrThrow(tx, projectId);
  assertReadable(project, auth);
  assertAdmin(auth);
  if (project.archivedAt !== null) {
    return;
  }
  await tx`
    UPDATE app.projects SET
      archived_at_ms = ${Date.now()}, updated_at_ms = ${Date.now()}
    WHERE id = ${projectId}
  `;
  await createAuditLog(
    tx,
    projectAudit(auth, project, PROJECT_AUDIT_ACTIONS.archived),
  );
  await hintProject(tx, auth.organizationId, projectId);
}

export async function restoreProject(
  tx: TransactionSql,
  auth: ProjectAuthContext,
  projectId: string,
): Promise<void> {
  const project = await loadProjectOrThrow(tx, projectId);
  assertReadable(project, auth);
  assertAdmin(auth);
  if (project.archivedAt === null) {
    return;
  }
  await tx`
    UPDATE app.projects SET
      archived_at_ms = NULL, updated_at_ms = ${Date.now()}
    WHERE id = ${projectId}
  `;
  await createAuditLog(
    tx,
    projectAudit(auth, project, PROJECT_AUDIT_ACTIONS.restored),
  );
  await hintProject(tx, auth.organizationId, projectId);
}

export interface DeleteProjectResult {
  detachedDocCount: number;
  detachedThreadCount: number;
  cascadedDocCount: number;
  cascadedThreadCount: number;
}

/**
 * Delete a project ('detach' releases children, 'cascade' destroys them —
 * requires the confirm phrase). Project agents and folders die with the row
 * (FK cascade); tasks cannot exist without a project either, but they go
 * through the tasks domain's retirement walk (`retireTasksInTx`) in BOTH
 * modes so their live runs, discussion threads, pending reviews and blobs
 * are settled rather than dropped by the FK; documents detach (or expire
 * into the retention pipeline on cascade) and threads detach (cascade
 * trashes only the CALLER's own threads), exactly the 0.4 walk. A cascade is
 * a delete of every document in the project, so it asks the documents
 * domain's own pre-walk first: one protected controlled record
 * (in review, approved, or carrying an approved version) or one held
 * document refuses the WHOLE cascade before anything is written — the same
 * all-or-nothing the folder cascade applies. Without it the cascade was the
 * one delete door that skipped the guard, and the retention sweep then
 * purged the retained snapshots it had expired.
 */
export async function deleteProject(
  tx: TransactionSql,
  auth: ProjectAuthContext,
  args: {
    projectId: string;
    mode: 'detach' | 'cascade';
    confirmPhrase?: string;
  },
): Promise<DeleteProjectResult> {
  const project = await loadProjectOrThrow(tx, args.projectId);
  assertReadable(project, auth);
  assertAdmin(auth);

  const bound = await tx<{ automationName: string }[]>`
    SELECT DISTINCT automation_name AS "automationName"
    FROM app.automation_project_bindings
    WHERE project_id = ${args.projectId}
    ORDER BY automation_name
  `;
  if (bound.length > 0) {
    throw new ProjectError(
      'PROJECT_HAS_BOUND_AUTOMATIONS',
      'Automations are bound to this project',
      400,
      { automations: bound.map((row) => row.automationName) },
    );
  }

  if (args.mode === 'cascade') {
    const expected = project.name.trim();
    const actual = (args.confirmPhrase ?? '').trim();
    if (
      actual.length === 0 ||
      expected.localeCompare(actual, undefined, { sensitivity: 'base' }) !== 0
    ) {
      throw new ProjectError(
        'PROJECT_CONFIRM_PHRASE_MISMATCH',
        'Confirmation phrase does not match the project name',
      );
    }
  }

  const counts: DeleteProjectResult = {
    detachedDocCount: 0,
    detachedThreadCount: 0,
    cascadedDocCount: 0,
    cascadedThreadCount: 0,
  };
  const now = Date.now();

  if (args.mode === 'cascade') {
    await assertProjectDocumentsDestroyable(tx, auth, args.projectId);
    // Mark for deletion via lifecycle status. 'expired' takes the documents
    // out of the retrievable set IMMEDIATELY (the RAG filter admits only
    // active-lifecycle documents); the retention documents sweep then
    // hard-deletes rows + blobs + corpus entries — after the grace window,
    // or on the next daily run when the org runs with no grace.
    const cascadedDocs = await tx<{ id: string }[]>`
      UPDATE app.documents SET
        project_id = NULL, lifecycle_status = 'expired',
        status_changed_at_ms = ${now}
      WHERE org_id = ${auth.organizationId} AND project_id = ${args.projectId}
      RETURNING id
    `;
    counts.cascadedDocCount = cascadedDocs.length;
    // Caller-owned threads soft-delete; everyone else's merely detach.
    const cascadedThreads = await tx<{ threadId: string }[]>`
      UPDATE app.thread_metadata SET
        status = 'trashed', status_changed_at_ms = ${now},
        project_id = NULL, shared_with_project = NULL
      WHERE org_id = ${auth.organizationId}
        AND project_id = ${args.projectId}
        AND user_id = ${auth.userId}
      RETURNING thread_id AS "threadId"
    `;
    counts.cascadedThreadCount = cascadedThreads.length;
  } else {
    const detachedDocs = await tx<{ id: string }[]>`
      UPDATE app.documents SET project_id = NULL
      WHERE org_id = ${auth.organizationId} AND project_id = ${args.projectId}
      RETURNING id
    `;
    counts.detachedDocCount = detachedDocs.length;
  }

  const detachedThreads = await tx<{ threadId: string }[]>`
    UPDATE app.thread_metadata SET
      project_id = NULL, shared_with_project = NULL
    WHERE org_id = ${auth.organizationId} AND project_id = ${args.projectId}
    RETURNING thread_id AS "threadId"
  `;
  counts.detachedThreadCount = detachedThreads.length;

  // Tasks cannot outlive their project, so BOTH modes retire every task the
  // way the task door does — live runs cancelled through their ledgered
  // doors, discussion threads deleted, pending reviews closed for the
  // reviewers' inboxes, blob refs released. Letting the FK cascade take the
  // rows skipped all of that: phantom pending reviews, sandbox turns still
  // executing against a vanished run row, leaked files.
  const taskRows = await tx<{ id: string }[]>`
    SELECT id FROM app.tasks
    WHERE org_id = ${auth.organizationId} AND project_id = ${args.projectId}
  `;
  const retired = await retireTasksInTx(tx, {
    organizationId: auth.organizationId,
    projectId: args.projectId,
    taskIds: taskRows.map((row) => row.id),
    closedReason: 'project_deleted',
  });

  await tx`DELETE FROM app.projects WHERE id = ${args.projectId}`;

  await createAuditLog(
    tx,
    projectAudit(auth, project, PROJECT_AUDIT_ACTIONS.deleted, {
      metadata: {
        mode: args.mode,
        ...counts,
        deletedTaskCount: taskRows.length,
        cancelledRunCount: retired.cancelledRunCount,
        releasedBlobRefCount: retired.releasedRefs.length,
      },
    }),
  );
  await hintProject(tx, auth.organizationId, args.projectId);
  return counts;
}

/**
 * The cascade's pre-walk over the project's documents: protected controlled
 * records refuse with the titles named (so the operator knows what to
 * release first), and a legal hold on the org or on a document's author
 * refuses as the project door's own hold code. Reads only — nothing is
 * written until every document has passed.
 */
async function assertProjectDocumentsDestroyable(
  tx: TransactionSql,
  auth: ProjectAuthContext,
  projectId: string,
): Promise<void> {
  const docs = await tx<
    {
      id: string;
      title: string | null;
      record: Record<string, unknown> | null;
      createdBy: string | null;
    }[]
  >`
    SELECT id, title, record, created_by AS "createdBy"
    FROM app.documents
    WHERE org_id = ${auth.organizationId} AND project_id = ${projectId}
    ORDER BY created_at_ms, id
  `;
  const protectedTitles = docs
    .filter((doc) => recordTrashRefusalFromJson(doc.record) !== null)
    .map((doc) => doc.title ?? doc.id);
  if (protectedTitles.length > 0) {
    throw new ProjectError(
      'PROJECT_HAS_PROTECTED_RECORDS',
      'Controlled records in this project are in review, approved, or retain an approved version and cannot be deleted',
      400,
      { documents: protectedTitles },
    );
  }
  const holds = await loadActiveHolds(tx, auth.organizationId);
  for (const doc of docs) {
    try {
      await assertNotHeld(
        tx,
        auth.organizationId,
        'document',
        doc.id,
        holds,
        doc.createdBy ?? undefined,
      );
    } catch (error) {
      if (error instanceof LegalHoldError) {
        throw new ProjectError('PROJECT_LEGAL_HOLD', error.message, 400);
      }
      throw error;
    }
  }
}

// ---------------------------------------------------------------------------
// Project agents
// ---------------------------------------------------------------------------

export interface ProjectAgentRow {
  id: string;
  organizationId: string;
  projectId: string;
  name: string;
  harness: string;
  model: string;
  modelProvider: string | null;
  skills: string[];
  connectors: string[];
  tools: string[];
  secrets: string[];
  instructions: string | null;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

const PROJECT_AGENT_COLUMNS = `
  id, org_id AS "organizationId", project_id AS "projectId", name, harness,
  model, model_provider AS "modelProvider", skills, connectors, tools,
  secrets, instructions, created_by AS "createdBy",
  created_at_ms::float8 AS "createdAt", updated_at_ms::float8 AS "updatedAt"
`;

interface ProjectAgentFields {
  name: string;
  harness: string;
  model: string;
  modelProvider: string | undefined;
  skills: string[];
  connectors: string[];
  tools: string[];
  secrets: string[];
  instructions: string | undefined;
}

function validateProjectAgentFields(args: {
  name: string;
  harness: string;
  model: string;
  modelProvider?: string;
  skills: string[];
  connectors: string[];
  tools?: string[];
  secrets?: string[];
  instructions?: string;
}): ProjectAgentFields {
  const name = args.name.trim();
  if (name.length === 0 || name.length > PROJECT_AGENT_NAME_MAX) {
    throw new ProjectError('PROJECT_AGENT_NAME_INVALID', 'Invalid agent name');
  }
  if (
    !isHarnessSlug(args.harness) ||
    PROJECT_AGENT_INELIGIBLE_HARNESSES.has(args.harness)
  ) {
    throw new ProjectError(
      'PROJECT_AGENT_HARNESS_INVALID',
      'Invalid agent harness',
    );
  }
  const model = args.model.trim();
  if (model.length === 0 || model.length > PROJECT_AGENT_MODEL_MAX) {
    throw new ProjectError(
      'PROJECT_AGENT_MODEL_INVALID',
      'Invalid agent model',
    );
  }
  const modelProvider = args.modelProvider?.trim();
  if (
    modelProvider !== undefined &&
    modelProvider !== '' &&
    modelProvider.length > PROJECT_AGENT_MODEL_MAX
  ) {
    throw new ProjectError('PROJECT_AGENT_MODEL_INVALID', 'Invalid provider');
  }
  if (
    args.skills.length > MAX_PROJECT_AGENT_SKILLS ||
    args.connectors.length > MAX_PROJECT_AGENT_CONNECTORS ||
    (args.tools?.length ?? 0) > MAX_PROJECT_AGENT_TOOLS ||
    (args.secrets?.length ?? 0) > MAX_PROJECT_AGENT_SECRETS
  ) {
    throw new ProjectError(
      'too_many_bindings',
      `An agent may be equipped with at most ${MAX_PROJECT_AGENT_SKILLS} skills, ${MAX_PROJECT_AGENT_CONNECTORS} connectors, ${MAX_PROJECT_AGENT_TOOLS} tools, and ${MAX_PROJECT_AGENT_SECRETS} secrets.`,
    );
  }
  const instructions = args.instructions?.trim();
  if (
    instructions !== undefined &&
    instructions.length > PROJECT_AGENT_INSTRUCTIONS_MAX
  ) {
    throw new ProjectError(
      'PROJECT_AGENT_INSTRUCTIONS_TOO_LONG',
      'Agent instructions too long',
    );
  }
  return {
    name,
    harness: args.harness,
    model,
    modelProvider:
      modelProvider === undefined || modelProvider === ''
        ? undefined
        : modelProvider,
    skills: [...new Set(args.skills.filter((s) => s.length > 0))],
    connectors: [...new Set(args.connectors.filter((c) => c.length > 0))],
    tools: normalizeToolGrants(args.tools ?? []),
    secrets: [...new Set((args.secrets ?? []).filter((s) => s.length > 0))],
    instructions:
      instructions !== undefined && instructions.length > 0
        ? instructions
        : undefined,
  };
}

/**
 * Drop referenced secret names the org no longer has, so an equipment row
 * never carries a dangling grant. The dialog may still list a secret a
 * manager just deleted; pruning silently is right because a missing secret
 * is inert at run time anyway — throwing would block an unrelated edit
 * (the 0.4 `pruneMissingSecrets` rule).
 */
async function pruneMissingSecrets(
  tx: TransactionSql,
  organizationId: string,
  requested: string[],
): Promise<string[]> {
  if (requested.length === 0) return [];
  const rows = await tx<{ name: string }[]>`
    SELECT name FROM app.agent_secrets
    WHERE org_id = ${organizationId} AND name = ANY(${requested})
  `;
  const existing = new Set(rows.map((row) => row.name));
  return requested.filter((name) => existing.has(name));
}

/**
 * Referencing org secrets grants their values to the agent's runs, so only
 * admins may CHANGE the referenced set (0.4's `assertMaySetSecrets`).
 */
function assertMaySetSecrets(
  auth: ProjectAuthContext,
  next: string[],
  previous: string[],
): void {
  const changed =
    next.length !== previous.length ||
    next.some((name) => !previous.includes(name));
  if (changed && !ADMIN_ROLES.has(auth.role)) {
    throw new ProjectError(
      'PROJECT_AGENT_SECRETS_FORBIDDEN',
      'Only admins can change agent secrets',
      403,
    );
  }
}

export async function listProjectAgents(
  sql: Sql,
  auth: ProjectAuthContext,
  projectId: string,
): Promise<ProjectAgentRow[]> {
  const project = await loadProjectOrThrow(sql, projectId);
  assertReadable(project, auth);
  return sql<ProjectAgentRow[]>`
    SELECT ${sql.unsafe(PROJECT_AGENT_COLUMNS)} FROM app.project_agents
    WHERE project_id = ${projectId}
    ORDER BY created_at_ms ASC
  `;
}

export async function createProjectAgent(
  tx: TransactionSql,
  auth: ProjectAuthContext,
  args: {
    projectId: string;
    name: string;
    harness: string;
    model: string;
    modelProvider?: string;
    skills: string[];
    connectors: string[];
    tools?: string[];
    secrets?: string[];
    instructions?: string;
  },
): Promise<string> {
  const project = await loadProjectOrThrow(tx, args.projectId);
  assertWritable(project, auth);
  const fields = validateProjectAgentFields(args);
  fields.secrets = await pruneMissingSecrets(
    tx,
    auth.organizationId,
    fields.secrets,
  );
  assertMaySetSecrets(auth, fields.secrets, []);

  const existing = await tx<{ count: string }[]>`
    SELECT count(*)::text AS count FROM app.project_agents
    WHERE project_id = ${args.projectId}
  `;
  if (Number(existing[0]?.count ?? '0') >= MAX_PROJECT_AGENTS) {
    throw new ProjectError('PROJECT_AGENT_LIMIT', 'Too many agents');
  }
  const nameClash = await tx<{ id: string }[]>`
    SELECT id FROM app.project_agents
    WHERE project_id = ${args.projectId} AND lower(name) = ${fields.name.toLowerCase()}
    LIMIT 1
  `;
  if (nameClash.length > 0) {
    throw new ProjectError('PROJECT_AGENT_NAME_TAKEN', 'Agent name taken');
  }

  const now = Date.now();
  const inserted = await tx<{ id: string }[]>`
    INSERT INTO app.project_agents (
      org_id, project_id, name, harness, model, model_provider, skills,
      connectors, tools, secrets, instructions, created_by, created_at_ms,
      updated_at_ms
    ) VALUES (
      ${auth.organizationId}, ${args.projectId}, ${fields.name},
      ${fields.harness}, ${fields.model}, ${fields.modelProvider ?? null},
      ${fields.skills}, ${fields.connectors}, ${fields.tools},
      ${fields.secrets}, ${fields.instructions ?? null}, ${auth.userId},
      ${now}, ${now}
    )
    RETURNING id
  `;
  const agentId = inserted[0]?.id;
  if (!agentId) {
    throw new ProjectError('PROJECT_AGENT_CREATE_FAILED', 'Insert failed');
  }
  await tx`
    UPDATE app.projects SET
      project_agent_count = project_agent_count + 1, updated_at_ms = ${now}
    WHERE id = ${args.projectId}
  `;
  await createAuditLog(
    tx,
    projectAudit(auth, project, PROJECT_AUDIT_ACTIONS.agentsChanged, {
      newState: {
        name: fields.name,
        harness: fields.harness,
        model: fields.model,
        skills: fields.skills,
        connectors: fields.connectors,
        tools: fields.tools,
        secrets: fields.secrets,
      },
      metadata: { op: 'create', projectAgentId: agentId },
    }),
  );
  await hintProject(tx, auth.organizationId, args.projectId);
  return agentId;
}

export async function updateProjectAgent(
  tx: TransactionSql,
  auth: ProjectAuthContext,
  args: {
    agentId: string;
    name: string;
    harness: string;
    model: string;
    modelProvider?: string;
    skills: string[];
    connectors: string[];
    tools?: string[];
    secrets?: string[];
    instructions?: string;
  },
): Promise<void> {
  const rows = await tx<ProjectAgentRow[]>`
    SELECT ${tx.unsafe(PROJECT_AGENT_COLUMNS)} FROM app.project_agents
    WHERE id = ${args.agentId} LIMIT 1
  `;
  const agent = rows[0];
  if (!agent) {
    throw new ProjectError('PROJECT_AGENT_NOT_FOUND', 'Agent not found', 404);
  }
  const project = await loadProjectOrThrow(tx, agent.projectId);
  assertWritable(project, auth);
  const fields = validateProjectAgentFields(args);
  // Prune BEFORE the gate: a set that only lost a deleted secret is not a
  // privileged change, so an editor's unrelated save must not be refused.
  fields.secrets = await pruneMissingSecrets(
    tx,
    auth.organizationId,
    fields.secrets,
  );
  assertMaySetSecrets(auth, fields.secrets, agent.secrets);

  const nameClash = await tx<{ id: string }[]>`
    SELECT id FROM app.project_agents
    WHERE project_id = ${agent.projectId}
      AND lower(name) = ${fields.name.toLowerCase()}
      AND id <> ${args.agentId}
    LIMIT 1
  `;
  if (nameClash.length > 0) {
    throw new ProjectError('PROJECT_AGENT_NAME_TAKEN', 'Agent name taken');
  }

  const now = Date.now();
  await tx`
    UPDATE app.project_agents SET
      name = ${fields.name}, harness = ${fields.harness},
      model = ${fields.model}, model_provider = ${fields.modelProvider ?? null},
      skills = ${fields.skills}, connectors = ${fields.connectors},
      tools = ${fields.tools}, secrets = ${fields.secrets},
      instructions = ${fields.instructions ?? null}, updated_at_ms = ${now}
    WHERE id = ${args.agentId}
  `;
  await createAuditLog(
    tx,
    projectAudit(auth, project, PROJECT_AUDIT_ACTIONS.agentsChanged, {
      previousState: {
        name: agent.name,
        harness: agent.harness,
        model: agent.model,
        skills: agent.skills,
        connectors: agent.connectors,
        tools: agent.tools,
        secrets: agent.secrets,
      },
      newState: {
        name: fields.name,
        harness: fields.harness,
        model: fields.model,
        skills: fields.skills,
        connectors: fields.connectors,
        tools: fields.tools,
        secrets: fields.secrets,
      },
      metadata: { op: 'update', projectAgentId: args.agentId },
    }),
  );
  await hintProject(tx, auth.organizationId, agent.projectId);
}

export async function deleteProjectAgent(
  tx: TransactionSql,
  auth: ProjectAuthContext,
  agentId: string,
): Promise<void> {
  const rows = await tx<ProjectAgentRow[]>`
    SELECT ${tx.unsafe(PROJECT_AGENT_COLUMNS)} FROM app.project_agents
    WHERE id = ${agentId} LIMIT 1
  `;
  const agent = rows[0];
  if (!agent) {
    throw new ProjectError('PROJECT_AGENT_NOT_FOUND', 'Agent not found', 404);
  }
  const project = await loadProjectOrThrow(tx, agent.projectId);
  assertWritable(project, auth);

  await tx`DELETE FROM app.project_agents WHERE id = ${agentId}`;
  await tx`
    UPDATE app.projects SET
      project_agent_count = greatest(project_agent_count - 1, 0),
      updated_at_ms = ${Date.now()}
    WHERE id = ${agent.projectId}
  `;
  await createAuditLog(
    tx,
    projectAudit(auth, project, PROJECT_AUDIT_ACTIONS.agentsChanged, {
      previousState: { name: agent.name, harness: agent.harness },
      metadata: { op: 'delete', projectAgentId: agentId },
    }),
  );
  await hintProject(tx, auth.organizationId, agent.projectId);
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

function visibilityClause(sql: Sql | TransactionSql, auth: ProjectAuthContext) {
  const isAdmin = ADMIN_ROLES.has(auth.role);
  return sql`
    (${isAdmin}
      OR (team_id IS NULL AND cardinality(shared_with_team_ids) = 0)
      OR team_id = ANY(${auth.teamIds})
      OR shared_with_team_ids && ${auth.teamIds})
  `;
}

/** Every project visible to the caller (admins: all; else org-wide + team). */
export async function listProjects(
  sql: Sql,
  auth: ProjectAuthContext,
  options: { includeArchived?: boolean } = {},
): Promise<ProjectListRow[]> {
  const includeArchived = options.includeArchived ?? false;
  const rows = await sql<ProjectRow[]>`
    SELECT ${sql.unsafe(PROJECT_COLUMNS)} FROM app.projects
    WHERE org_id = ${auth.organizationId}
      AND (${includeArchived} OR archived_at_ms IS NULL)
      AND ${visibilityClause(sql, auth)}
    ORDER BY updated_at_ms DESC
  `;
  return rows.map((row) => stampAccessFlags(row, auth));
}

export interface ProjectOverviewRow extends ProjectListRow {
  overdueTaskCount: number;
}

/**
 * The projects list page read: visible projects + at-a-glance rollups.
 * Open/done/agent counts come off the denormalized columns; the overdue
 * count is one grouped scan over the org's due tasks against `asOf` (the
 * client's bucketed clock, so its cache key rotates — SQL counts exactly,
 * `overdueTruncated` is kept `false` for 0.4 API-shape stability).
 */
export async function listProjectsOverview(
  sql: Sql,
  auth: ProjectAuthContext,
  options: { includeArchived?: boolean; asOf?: number } = {},
): Promise<{ projects: ProjectOverviewRow[]; overdueTruncated: boolean }> {
  const projects = await listProjects(sql, auth, options);
  const asOf = options.asOf ?? Date.now();
  const overdueRows =
    projects.length === 0
      ? []
      : await sql<{ projectId: string; count: string }[]>`
          SELECT project_id AS "projectId", count(*)::text AS count
          FROM app.tasks
          WHERE org_id = ${auth.organizationId}
            AND due_date_ms > 0 AND due_date_ms <= ${asOf}
            AND archived_at_ms IS NULL
            AND status NOT IN ('done', 'cancelled')
          GROUP BY project_id
        `;
  const overdueByProject = new Map(
    overdueRows.map((row) => [row.projectId, Number(row.count)]),
  );
  return {
    projects: projects.map((project) =>
      Object.assign(project, {
        overdueTaskCount: overdueByProject.get(project.id) ?? 0,
      }),
    ),
    overdueTruncated: false,
  };
}

export async function getProject(
  sql: Sql,
  auth: ProjectAuthContext,
  projectId: string,
): Promise<ProjectListRow> {
  const project = await loadProjectOrThrow(sql, projectId);
  assertReadable(project, auth);
  return stampAccessFlags(project, auth);
}

/** Case-insensitive name search across visible projects (bounded). */
export async function searchProjects(
  sql: Sql,
  auth: ProjectAuthContext,
  query: string,
  limit = 20,
): Promise<ProjectRow[]> {
  const term = `%${query.trim()}%`;
  if (query.trim().length === 0) {
    return [];
  }
  return sql<ProjectRow[]>`
    SELECT ${sql.unsafe(PROJECT_COLUMNS)} FROM app.projects
    WHERE org_id = ${auth.organizationId}
      AND archived_at_ms IS NULL
      AND name ILIKE ${term}
      AND ${visibilityClause(sql, auth)}
    ORDER BY updated_at_ms DESC
    LIMIT ${Math.min(limit, 50)}
  `;
}

/**
 * Sidebar ordering: pinned first (most recently pinned on top), then by
 * recency. Bounded — the sidebar shows a short list.
 */
export async function listSidebarProjects(
  sql: Sql,
  auth: ProjectAuthContext,
  limit = 50,
): Promise<ProjectRow[]> {
  return sql<ProjectRow[]>`
    SELECT ${sql.unsafe(PROJECT_COLUMNS)} FROM app.projects
    WHERE org_id = ${auth.organizationId}
      AND archived_at_ms IS NULL
      AND ${visibilityClause(sql, auth)}
    ORDER BY pinned_at_ms DESC NULLS LAST, updated_at_ms DESC
    LIMIT ${Math.min(limit, 100)}
  `;
}

/**
 * The user ids that CAN access a project (assignee picker / mentions).
 * Org-wide → `orgWide: true` with empty userIds (client uses the member
 * directory); team-restricted → admins + members of the project's teams.
 */
export async function listAccessibleUserIds(
  sql: Sql,
  auth: ProjectAuthContext,
  projectId: string,
): Promise<{ orgWide: boolean; userIds: string[] }> {
  const project = await loadProjectOrThrow(sql, projectId);
  assertReadable(project, auth);

  const teamIds = [
    ...new Set([
      ...(project.teamId ? [project.teamId] : []),
      ...project.sharedWithTeamIds,
    ]),
  ];
  if (teamIds.length === 0) {
    return { orgWide: true, userIds: [] };
  }
  const rows = await sql<{ userId: string }[]>`
    SELECT DISTINCT m."userId" FROM "member" m
    WHERE m."organizationId" = ${auth.organizationId}
      AND lower(m."role") <> 'disabled'
      AND (
        lower(m."role") IN ('owner', 'admin')
        OR EXISTS (
          SELECT 1 FROM "teamMember" tm
          WHERE tm."userId" = m."userId" AND tm."teamId" = ANY(${teamIds})
        )
      )
  `;
  return { orgWide: false, userIds: rows.map((row) => row.userId) };
}

/** Lookup by the caller-owned natural key — the REST door's find lane. */
export async function getProjectByExternalItemId(
  sql: Sql,
  organizationId: string,
  externalItemId: string,
): Promise<ProjectRow | null> {
  const rows = await sql<ProjectRow[]>`
    SELECT ${sql.unsafe(PROJECT_COLUMNS)} FROM app.projects
    WHERE org_id = ${organizationId} AND external_item_id = ${externalItemId}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

// -------------------------------------------------------- rollup repair

/**
 * Recompute the project rollups from their SOURCE rows and fix any drift.
 *
 * `open_task_count` / `done_task_count` / `project_agent_count` are
 * maintained incrementally (`applyTaskCountTransition` and the agent
 * create/delete paths are their only writers) because the board reads them
 * on every render. Incremental counters drift: a crash between a task write
 * and its transition, a hand-run SQL fix, a restored backup. The board then
 * shows a number the task list contradicts, which reads as data loss.
 *
 * The repair is a single set-based statement — the counts ARE a group-by —
 * and it touches only rows that actually disagree, so a healthy fleet costs
 * one scan and zero writes. The 0.4 equivalent was a one-shot versioned
 * backfill; making it periodic is what turns "we fixed it once" into "it
 * cannot stay wrong".
 */
export async function repairProjectRollups(
  sql: Sql,
): Promise<{ repaired: number }> {
  const rows = await sql<{ id: string }[]>`
    WITH task_counts AS (
      SELECT project_id,
             count(*) FILTER (
               WHERE archived_at_ms IS NULL
                 AND status NOT IN ('done', 'cancelled')
             ) AS open_count,
             count(*) FILTER (
               WHERE archived_at_ms IS NULL AND status = 'done'
             ) AS done_count
      FROM app.tasks GROUP BY project_id
    ),
    agent_counts AS (
      SELECT project_id, count(*) AS agent_count
      FROM app.project_agents GROUP BY project_id
    )
    UPDATE app.projects p SET
      open_task_count = coalesce(t.open_count, 0),
      done_task_count = coalesce(t.done_count, 0),
      project_agent_count = coalesce(a.agent_count, 0)
    FROM (SELECT id FROM app.projects) ids
    LEFT JOIN task_counts t ON t.project_id = ids.id
    LEFT JOIN agent_counts a ON a.project_id = ids.id
    WHERE p.id = ids.id
      AND (p.open_task_count IS DISTINCT FROM coalesce(t.open_count, 0)
        OR p.done_task_count IS DISTINCT FROM coalesce(t.done_count, 0)
        OR p.project_agent_count IS DISTINCT FROM coalesce(a.agent_count, 0))
    RETURNING p.id
  `;
  if (rows.length > 0) {
    console.info(
      `[projects] rollup repair corrected ${rows.length} project(s)`,
    );
  }
  return { repaired: rows.length };
}
