import {
  PROJECT_AGENT_BINDINGS_MAX,
  PROJECT_AGENT_INSTRUCTIONS_MAX,
  PROJECT_AGENT_MODEL_MAX,
  PROJECT_AGENT_NAME_MAX,
  PROJECT_DESCRIPTION_MAX,
  PROJECT_INSTRUCTIONS_MAX_CHARS,
  PROJECT_NAME_MAX,
  PROJECT_SHARED_TEAMS_MAX,
} from '@tale/shared/schemas/projects';
import {
  deriveProjectKey,
  isValidProjectKey,
  normalizeProjectKey,
  PROJECT_KEY_MAX,
} from '@tale/shared/utils/project-key';
import type { Sql, TransactionSql } from 'postgres';

import { isHarnessSlug } from '../../../lib/harnesses/types.ts';
import { canonicalExternalKey } from '../../../lib/shared/utils/external-key.ts';
import { getUserTeamIds } from '../../auth/membership.ts';
import {
  assertTeamsAssignable,
  audienceClause,
  audienceMirror,
  normalizeTeamIds,
  PROJECT_TEAM_IDS_SQL,
  TeamAssignmentError,
} from '../../core/lib/audience.ts';
import { loadHarnesses } from '../../core/lib/providers/load_system_config.ts';
import {
  ADMIN_ROLES,
  checkProjectAccess,
  EDITOR_ROLES,
  isOrgWideProject,
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
import { scheduleAgentWorkspaceRetirement } from '../sandbox/retirement-schedule.ts';
import { retireTasksInTx } from '../tasks/retire.ts';
import { clearAgentAssignmentsInTx } from '../tasks/unassign.ts';
import {
  AGENT_TOOL_GRANT_NAMES,
  agentEquipmentRefusal,
  agentModelRefusal,
  unknownToolGrants,
} from './agent-equipment.ts';

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
// file — the editor counts against the same constants. The external key's
// cap is the domain's own, exported so the machine door validates against
// the same number it refuses on (two copies once drifted apart).
export const PROJECT_EXTERNAL_ITEM_ID_MAX = 256;

const MAX_PROJECT_AGENTS = 50;

/**
 * The harnesses a project agent may run on: those the managed lane can run
 * unattended on the platform's own credentials (`credentialPolicy.managed`
 * in the harness fact) — the rule the composer roster applies, and the one
 * `GET /api/v1/models` lists under `harnesses`. A hard-coded set once stood
 * beside it, and the refusal named nothing (2026-09-14 evaluation, h9).
 */
export function eligibleProjectAgentHarnesses(): string[] {
  return loadHarnesses()
    .filter((harness) => harness.credentialPolicy.managed)
    .map((harness) => harness.slug)
    .sort();
}

export class ProjectError extends Error {
  readonly code: string;
  readonly status: 400 | 403 | 404 | 409 | 429;
  readonly data: Record<string, unknown> | undefined;

  constructor(
    code: string,
    message: string,
    status: 400 | 403 | 404 | 409 | 429 = 400,
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
  const teamIds = await getUserTeamIds(
    sql,
    member.organizationId,
    member.userId,
  );
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
  /** The audience — team ids; empty = organization-wide. */
  teamIds: string[];
  /** @deprecated Derived: `teamIds[0]`; kept while the previous image reads it. */
  teamId: string | null;
  /** @deprecated Derived: `teamIds.slice(1)`; kept while the previous image reads it. */
  sharedWithTeamIds: string[];
  instructions: string | null;
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
  project_agent_count AS "projectAgentCount",
  ${PROJECT_TEAM_IDS_SQL} AS "teamIds",
  (${PROJECT_TEAM_IDS_SQL})[1] AS "teamId",
  (${PROJECT_TEAM_IDS_SQL})[2:] AS "sharedWithTeamIds", instructions,
  created_by AS "createdBy", created_at_ms::float8 AS "createdAt",
  updated_at_ms::float8 AS "updatedAt", archived_at_ms::float8 AS "archivedAt",
  pinned_at_ms::float8 AS "pinnedAt"
`;

/** Project access input — the audience the matrix decides on. The whole row
 * goes in: `teamIds` decides, and a row that carries only the legacy pair (a
 * fixture, or a mid-rollout write of the previous image read raw) still
 * resolves through `getProjectTeamIds`' fallback rather than as org-wide. */
function accessInput(project: ProjectRow): ProjectRow {
  return project;
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
    // An archived project is read-only for everyone: the write CTAs the UI
    // gates on `canEdit` vanish with it. `canAdminister` stays, so Restore
    // (and Delete) remain reachable — that is how it stops being archived.
    canEdit: access.canEdit && row.archivedAt === null,
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

/**
 * An archived project is read-only: every write on it — its own settings,
 * its agents, tasks, documents and folders — answers this one code, so a
 * door can tell "restore it first" from "you may not". The lifecycle verbs
 * (restore, delete) stay admin verbs and never pass through here.
 */
export function assertProjectActive(project: ProjectRow): void {
  if (project.archivedAt !== null) {
    throw new ProjectError('PROJECT_ARCHIVED', 'Project is archived', 403);
  }
}

/** The project-settings write gate: editable by the caller AND active. */
function assertActiveWritable(
  project: ProjectRow,
  auth: ProjectAuthContext,
): void {
  assertWritable(project, auth);
  assertProjectActive(project);
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

/** The name in its ONE canonical form — trimmed AND NFC-normalized, the rule
 * every other user-visible name on this surface follows (a folder name, a
 * bound file name, the project's own `externalItemId`). It was the odd one
 * out, stored byte-for-byte: two glyph-identical names in NFC and NFD
 * compared unequal and sorted apart (2026-09-14 evaluation, g3-8). One site
 * serves both the app and the REST door. */
function validateName(name: string): string {
  const trimmed = canonicalExternalKey(name);
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

/**
 * The audience shape rule: at most `PROJECT_SHARED_TEAMS_MAX + 1` teams (the
 * former owning team plus the shared list), no blanks; a repeated team
 * collapses to one, first-seen order kept — the one rule documents, folders
 * and skills already apply (`normalizeTeamIds`), which projects alone
 * refused with a 400 (2026-09-19 evaluation, K4-4).
 */
function validateTeamIds(teamIds: readonly string[]): string[] {
  if (teamIds.length > PROJECT_SHARED_TEAMS_MAX + 1) {
    throw new ProjectError('PROJECT_SHARING_INVALID', 'Too many teams');
  }
  if (teamIds.some((teamId) => teamId.trim().length === 0)) {
    throw new ProjectError(
      'PROJECT_SHARING_INVALID',
      'Blank team in project audience',
    );
  }
  return normalizeTeamIds(teamIds);
}

/**
 * The requested audience in ONE spelling: `teamIds` when given, else the
 * legacy pair (owning team first, then the shared teams).
 */
function requestedProjectTeamIds(args: {
  teamIds?: readonly string[];
  teamId?: string | null;
  sharedWithTeamIds?: readonly string[];
}): string[] {
  if (args.teamIds !== undefined) return [...args.teamIds];
  return [
    ...(args.teamId ? [args.teamId] : []),
    ...(args.sharedWithTeamIds ?? []),
  ];
}

/**
 * Every team a project is scoped to must be a team OF THIS ORGANIZATION,
 * and a non-admin may only scope a project to teams they belong to —
 * `assertTeamsAssignable` (`core/lib/audience.ts`) in this domain's refusal
 * vocabulary. A typo'd, deleted or foreign id would otherwise persist a
 * scope no member can satisfy (and the Audience picker cannot render) — or,
 * for another tenant's team, one its members in this org could satisfy
 * through a membership this org never granted.
 */
async function assignableTeams(
  tx: TransactionSql,
  auth: ProjectAuthContext,
  teamIds: readonly string[],
): Promise<string[]> {
  try {
    return await assertTeamsAssignable(tx, auth, teamIds);
  } catch (error) {
    if (error instanceof TeamAssignmentError) {
      if (error.code === 'TEAM_NOT_IN_ORG') {
        throw new ProjectError(
          'PROJECT_SHARING_INVALID',
          'Unknown team in project sharing',
          400,
          { unknownTeamIds: error.data.teamIds },
        );
      }
      throw new ProjectError(
        'TEAM_ACCESS_DENIED',
        'Cannot scope a project to a team you do not belong to',
        403,
        error.data,
      );
    }
    throw error;
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

/**
 * The task-identifier prefix. An EXPLICIT key is validated as sent (upper-
 * cased, never stripped or truncated to something the caller did not ask
 * for — `TOOLONGKEY` used to land as `TOOLON`); a DERIVED key that the name
 * cannot yield (no Latin letters or digits) leaves the project keyless
 * rather than refusing a name the platform accepts everywhere else.
 */
async function resolveProjectKey(
  tx: TransactionSql | Sql,
  organizationId: string,
  rawKey: string | undefined,
  name: string,
): Promise<string | undefined> {
  const explicit = rawKey?.trim() ?? '';
  let key: string;
  if (explicit !== '') {
    key = normalizeProjectKey(explicit);
    if (key !== explicit.toUpperCase() || !isValidProjectKey(key)) {
      throw new ProjectError(
        'PROJECT_KEY_INVALID',
        'Project key must be 2-6 characters, letters and digits only',
      );
    }
  } else {
    key = normalizeProjectKey(deriveProjectKey(name));
    if (!isValidProjectKey(key)) return undefined;
  }
  if (await keyTaken(tx, organizationId, key)) {
    throw new ProjectError(
      'PROJECT_KEY_TAKEN',
      `Project key "${key}" is already taken in this organization`,
      409,
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

/**
 * The caller-owned key in its ONE canonical form (NFC, trimmed —
 * `canonicalExternalKey`, the same rule the lookup and the task family
 * apply), checked against the organization's existing projects. Two keys
 * that differed only in normalization used to be two projects.
 */
async function resolveExternalItemId(
  tx: TransactionSql | Sql,
  organizationId: string,
  raw: string | undefined,
  options: {
    /** The project being re-keyed: its own current key is no collision. */
    excludeProjectId?: string;
  } = {},
): Promise<string | undefined> {
  if (raw == null) {
    return undefined;
  }
  const externalItemId = canonicalExternalKey(raw);
  if (
    externalItemId.length === 0 ||
    externalItemId.length > PROJECT_EXTERNAL_ITEM_ID_MAX
  ) {
    throw new ProjectError(
      'PROJECT_EXTERNAL_ITEM_ID_INVALID',
      `externalItemId must be 1-${PROJECT_EXTERNAL_ITEM_ID_MAX} characters after NFC normalization and trimming`,
    );
  }
  const rows = await tx<{ id: string }[]>`
    SELECT id FROM app.projects
    WHERE org_id = ${organizationId} AND external_item_id = ${externalItemId}
      ${
        options.excludeProjectId === undefined
          ? tx``
          : tx`AND id <> ${options.excludeProjectId}`
      }
    LIMIT 1
  `;
  if (rows.length > 0) {
    throw new ProjectError(
      'PROJECT_DUPLICATE_EXTERNAL_ID',
      `A project with externalItemId "${externalItemId}" already exists in this organization`,
      409,
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
  /** The audience; empty or absent = organization-wide. Wins over the pair. */
  teamIds?: string[];
  /** @deprecated Legacy owning team — folds into `teamIds` first. */
  teamId?: string;
  /** @deprecated Legacy shared teams — fold into `teamIds` after `teamId`. */
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
  const teamIds = await assignableTeams(
    tx,
    auth,
    validateTeamIds(requestedProjectTeamIds(args)),
  );
  const mirror = audienceMirror(teamIds);

  const now = Date.now();
  const inserted = await tx<{ id: string }[]>`
    INSERT INTO app.projects (
      org_id, name, key, external_item_id, description, icon, color,
      team_ids, team_id, shared_with_team_ids, created_by, created_at_ms,
      updated_at_ms
    ) VALUES (
      ${auth.organizationId}, ${name}, ${key ?? null},
      ${externalItemId ?? null}, ${description ?? null}, ${args.icon ?? null},
      ${args.color ?? null}, ${teamIds}, ${mirror.teamId},
      ${mirror.sharedWithTeamIds}, ${auth.userId}, ${now}, ${now}
    )
    RETURNING id
  `;
  const projectId = inserted[0]?.id;
  if (!projectId) {
    throw new Error('PROJECT_CREATE_FAILED: the insert answered no row');
  }

  await createAuditLog(
    tx,
    projectAudit(auth, { id: projectId, name }, PROJECT_AUDIT_ACTIONS.created, {
      newState: {
        name,
        teamIds,
        teamId: mirror.teamId,
        sharedWithTeamIds: mirror.sharedWithTeamIds,
      },
      metadata: { isOrgWide: teamIds.length === 0 },
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
      org_id, name, key, description, icon, color, team_ids, team_id,
      shared_with_team_ids, instructions, created_by, created_at_ms,
      updated_at_ms
    ) VALUES (
      ${auth.organizationId}, ${nextName}, ${key ?? null},
      ${source.description}, ${source.icon}, ${source.color},
      ${source.teamIds}, ${audienceMirror(source.teamIds).teamId},
      ${audienceMirror(source.teamIds).sharedWithTeamIds},
      ${source.instructions}, ${auth.userId}, ${now}, ${now}
    )
    RETURNING id
  `;
  const newProjectId = inserted[0]?.id;
  if (!newProjectId) {
    throw new Error('PROJECT_CREATE_FAILED: the insert answered no row');
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
  assertActiveWritable(project, auth);

  const previousState: Record<string, unknown> = {};
  const newState: Record<string, unknown> = {};
  const sets: string[] = [];
  const values: (string | null)[] = [];
  // A field already at its value is not a change: it is left out of the
  // statement, so a body that changes nothing writes nothing and leaves
  // `updatedAt` alone (the document door's rule). A mirror re-pushing the
  // source record's identity on every sync — the use this operation names —
  // used to churn `updatedAt` on every pass (2026-09-14 evaluation, g3-7).
  if (args.name !== undefined) {
    const name = validateName(args.name);
    if (name !== project.name) {
      sets.push('name');
      values.push(name);
      previousState.name = project.name;
      newState.name = name;
    }
  }
  if (args.description !== undefined) {
    const desc =
      args.description === null
        ? undefined
        : validateDescription(args.description);
    if ((desc ?? null) !== (project.description ?? null)) {
      sets.push('description');
      values.push(desc ?? null);
      previousState.description = project.description;
      newState.description = desc ?? null;
    }
  }
  if (args.icon !== undefined && args.icon !== (project.icon ?? null)) {
    sets.push('icon');
    values.push(args.icon);
    previousState.icon = project.icon;
    newState.icon = args.icon;
  }
  if (args.color !== undefined && args.color !== (project.color ?? null)) {
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

/**
 * Re-key a project: the caller-owned `externalItemId` a mirror looks the
 * project up by, set to a new key (canonical NFC + trimmed, unique per
 * organization — another project's key is the 409 with the key in
 * `data`) or cleared with `null`. The key used to be immutable for the
 * life of the project: when the source record was re-numbered, a mirror's
 * only move was delete-and-recreate, which destroyed every file, folder,
 * thread and task under it. Editors with project edit access, like the
 * name; an unchanged key writes nothing.
 */
export async function updateProjectExternalItemId(
  tx: TransactionSql,
  auth: ProjectAuthContext,
  args: { projectId: string; externalItemId: string | null },
): Promise<void> {
  const project = await loadProjectOrThrow(tx, args.projectId);
  assertActiveWritable(project, auth);
  const externalItemId =
    args.externalItemId === null
      ? null
      : ((await resolveExternalItemId(
          tx,
          auth.organizationId,
          args.externalItemId,
          { excludeProjectId: project.id },
        )) ?? null);
  if (externalItemId === (project.externalItemId ?? null)) {
    return;
  }
  await tx`
    UPDATE app.projects
    SET external_item_id = ${externalItemId}, updated_at_ms = ${Date.now()}
    WHERE id = ${project.id}
  `;
  await createAuditLog(
    tx,
    projectAudit(auth, project, PROJECT_AUDIT_ACTIONS.updated, {
      previousState: { externalItemId: project.externalItemId },
      newState: { externalItemId },
      changedFields: ['externalItemId'],
    }),
  );
  await hintProject(tx, auth.organizationId, project.id);
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
  assertActiveWritable(project, auth);
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
    /** The audience; empty = organization-wide. Wins over the legacy pair. */
    teamIds?: string[];
    /** @deprecated Legacy owning team — patches `teamIds[0]`; `null` alone
     * clears the whole audience, the way the owning-team select did. */
    teamId?: string | null;
    /** @deprecated Legacy shared teams — patch `teamIds.slice(1)`. */
    sharedWithTeamIds?: string[];
  },
): Promise<void> {
  const project = await loadProjectOrThrow(tx, args.projectId);
  assertReadable(project, auth);
  assertAdmin(auth);
  // The audience is a write like any other: an archived project refuses it
  // (the REST door already did; the app door now agrees).
  assertProjectActive(project);

  let requested: string[];
  if (args.teamIds !== undefined) {
    requested = args.teamIds;
  } else if (args.teamId === null && args.sharedWithTeamIds === undefined) {
    // Dropping the owning team without naming the shared list made the
    // project organization-wide (`normalizeSharing`'s invariant); keep it.
    requested = [];
  } else {
    requested = [
      ...(args.teamId === undefined
        ? project.teamIds.slice(0, 1)
        : args.teamId
          ? [args.teamId]
          : []),
      ...(args.sharedWithTeamIds ?? project.teamIds.slice(1)),
    ];
  }
  const teamIds = await assignableTeams(tx, auth, validateTeamIds(requested));
  // Naming the audience the project already carries is not a change (the
  // identity door's rule): no write, no audit row, `updatedAt` kept — a
  // sync that re-asserts the audience on every pass used to move it every
  // time (2026-09-19 evaluation, K4-3). Order counts: `teamIds[0]` is the
  // mirrored owning team, so a reordered list is a stored change.
  if (
    teamIds.length === project.teamIds.length &&
    teamIds.every((teamId, index) => teamId === project.teamIds[index])
  ) {
    return;
  }
  const mirror = audienceMirror(teamIds);

  const previousState = {
    teamIds: project.teamIds,
    teamId: project.teamId,
    sharedWithTeamIds: project.sharedWithTeamIds,
  };
  const newState = {
    teamIds,
    teamId: mirror.teamId,
    sharedWithTeamIds: mirror.sharedWithTeamIds,
  };
  await tx`
    UPDATE app.projects SET
      team_ids = ${teamIds},
      team_id = ${mirror.teamId},
      shared_with_team_ids = ${mirror.sharedWithTeamIds},
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
  /**
   * The documents `detach` released to the hub. Their corpus rows still
   * carry the dead project id until the caller re-stamps them
   * (`syncRagDocumentScopes`) after this transaction commits — a scope-only
   * move never re-embeds, so nothing else heals it and a released document
   * stays unfindable while reporting `completed`. Empty for a cascade (its
   * documents expire, and the retrieval re-check drops an expired row).
   */
  detachedDocIds: string[];
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
  // The three refusals below are the project's STATE standing in the way
  // (a binding, a protected record, a hold) — 409s, like every other
  // state refusal on the wire, never a malformed-request 400.
  if (bound.length > 0) {
    throw new ProjectError(
      'PROJECT_HAS_BOUND_AUTOMATIONS',
      'Automations are bound to this project',
      409,
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
    detachedDocIds: [],
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
    // Their corpus rows still carry the dead project id; the caller
    // re-stamps them after this commits (a scope-only move never re-embeds,
    // so nothing else heals it — see `syncRagDocumentScopes`).
    counts.detachedDocIds = detachedDocs.map((doc) => doc.id);
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

  // The project's agents die with its row (FK cascade), and their
  // workspaces with them once this commits.
  const agents = await tx<{ id: string }[]>`
    SELECT id FROM app.project_agents
    WHERE org_id = ${auth.organizationId} AND project_id = ${args.projectId}
  `;
  await scheduleAgentWorkspaceRetirement(tx, {
    organizationId: auth.organizationId,
    agentIds: agents.map((agent) => agent.id),
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
      409,
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
        throw new ProjectError('PROJECT_LEGAL_HOLD', error.message, 409);
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
  /** The organization's standard agent (migration 0146): Tale created it
   * and keeps its runtime, model and instructions in line with the
   * `standard_agent` policy (`standard-agent.ts`), so nobody edits it here. */
  managed: boolean;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

const PROJECT_AGENT_COLUMNS = `
  id, org_id AS "organizationId", project_id AS "projectId", name, harness,
  model, model_provider AS "modelProvider", skills, connectors, tools,
  secrets, instructions, managed, created_by AS "createdBy",
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
  const harnesses = eligibleProjectAgentHarnesses();
  if (!isHarnessSlug(args.harness) || !harnesses.includes(args.harness)) {
    throw new ProjectError(
      'PROJECT_AGENT_HARNESS_INVALID',
      `Unknown or ineligible harness "${args.harness}" — a project agent runs on one of ${harnesses.join(', ')}; GET /api/v1/models lists them under harnesses`,
      400,
      { harnesses },
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
    args.skills.length > PROJECT_AGENT_BINDINGS_MAX ||
    args.connectors.length > PROJECT_AGENT_BINDINGS_MAX ||
    (args.tools?.length ?? 0) > PROJECT_AGENT_BINDINGS_MAX ||
    (args.secrets?.length ?? 0) > PROJECT_AGENT_BINDINGS_MAX
  ) {
    throw new ProjectError(
      'too_many_bindings',
      `An agent may be equipped with at most ${PROJECT_AGENT_BINDINGS_MAX} skills, ${PROJECT_AGENT_BINDINGS_MAX} connectors, ${PROJECT_AGENT_BINDINGS_MAX} tools, and ${PROJECT_AGENT_BINDINGS_MAX} secrets.`,
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
  // A grant the catalog does not carry is refused by name — it used to be
  // dropped in silence, so a caller that sent `["bash", "web_search"]` got
  // a 201 and an agent with no tools at all.
  const unknownTools = unknownToolGrants(args.tools ?? []);
  if (unknownTools.length > 0) {
    throw new ProjectError(
      'PROJECT_AGENT_TOOL_UNKNOWN',
      `Unknown tools: ${unknownTools.join(', ')}. The grantable tools are: ${AGENT_TOOL_GRANT_NAMES.join(', ')}.`,
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
 * The model, skills and connectors an agent is being equipped with must be
 * ones this organization can actually serve — the same listings the dialog
 * offers (`agent-equipment.ts`). A provider that does not exist or a model
 * the organization cannot call used to be stored with a 201 and fail
 * unattended at the first task start; unknown skills and connectors were
 * stored verbatim.
 */
/**
 * Refuse a model or equipment the project cannot use. On an update only the
 * equipment the save ADDS is checked against what the project can see: a
 * skill that was equipped and later unshared from the scope stays a stored
 * fact the dialog shows as unavailable and lets the author untick — refusing
 * the whole save over it blocked every other edit of the agent (its model,
 * its instructions) until the skill was recreated under the same slug
 * (2026-09-26 evaluation, C-09).
 */
async function assertAgentEquipment(
  tx: TransactionSql,
  auth: ProjectAuthContext,
  projectId: string,
  fields: ProjectAgentFields,
  stored?: { skills: readonly string[]; connectors: readonly string[] },
): Promise<void> {
  const added = (next: readonly string[], previous: readonly string[]) =>
    next.filter((slug) => !previous.includes(slug));
  const refusal =
    (await agentModelRefusal(tx, {
      organizationId: auth.organizationId,
      userId: auth.userId,
      harness: fields.harness,
      model: fields.model,
      ...(fields.modelProvider !== undefined
        ? { modelProvider: fields.modelProvider }
        : {}),
    })) ??
    (await agentEquipmentRefusal(tx, {
      organizationId: auth.organizationId,
      userId: auth.userId,
      projectId,
      skills: stored ? added(fields.skills, stored.skills) : fields.skills,
      connectors: stored
        ? added(fields.connectors, stored.connectors)
        : fields.connectors,
    }));
  if (refusal !== null) {
    throw new ProjectError(refusal.code, refusal.message);
  }
}

/**
 * Unequip a deleted skill from every agent of the organization that carried
 * it — the delete's own transaction, so no agent is left naming a bundle
 * that is gone (its runs failed to start and its dialog could not be saved).
 * Answers the agents it touched, so the door can say so and the audit row
 * can name them.
 */
export async function detachSkillFromAgents(
  tx: TransactionSql,
  organizationId: string,
  slug: string,
): Promise<{ id: string; name: string; projectId: string }[]> {
  const detached = await tx<{ id: string; name: string; projectId: string }[]>`
    UPDATE app.project_agents
    SET skills = array_remove(skills, ${slug}), updated_at_ms = ${Date.now()}
    WHERE org_id = ${organizationId} AND ${slug} = ANY(skills)
    RETURNING id, name, project_id AS "projectId"
  `;
  for (const projectId of new Set(detached.map((agent) => agent.projectId))) {
    await hintProject(tx, organizationId, projectId);
  }
  return detached;
}

/** What a save does with a referenced secret name the organization does
 * not have: `prune` drops it (the app dialog's rule), `refuse` answers the
 * names (the machine door's rule). */
export type UnknownSecretsPolicy = 'prune' | 'refuse';

/**
 * Resolve the referenced secret names against the org's secrets. `prune`
 * drops the ones the org no longer has, so an equipment row never carries
 * a dangling grant: the dialog may still list a secret a manager just
 * deleted, and a missing secret is inert at run time anyway — throwing
 * would block an unrelated edit (the 0.4 `pruneMissingSecrets` rule).
 * `refuse` names them instead (`PROJECT_AGENT_SECRET_UNKNOWN`, the names
 * under `data.secrets`): an unattended caller that typo'd a name used to
 * get a 200 and an agent that runs credential-less — the one equipment
 * field that degraded in silence while every other is refused by name.
 */
async function resolveSecretGrants(
  tx: TransactionSql,
  organizationId: string,
  requested: string[],
  unknownSecrets: UnknownSecretsPolicy,
): Promise<string[]> {
  if (requested.length === 0) return [];
  const rows = await tx<{ name: string }[]>`
    SELECT name FROM app.agent_secrets
    WHERE org_id = ${organizationId} AND name = ANY(${requested})
  `;
  const existing = new Set(rows.map((row) => row.name));
  const unknown = requested.filter((name) => !existing.has(name));
  if (unknown.length > 0 && unknownSecrets === 'refuse') {
    throw new ProjectError(
      'PROJECT_AGENT_SECRET_UNKNOWN',
      `Unknown secrets: ${unknown.join(', ')}. An agent may only reference secret names the organization has stored — add them under the organization's secrets first, or drop them from the grant.`,
      400,
      { secrets: unknown },
    );
  }
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

/** Check inside the write transaction so archiving cannot race an agent save. */
function assertAgentWritable(
  project: ProjectRow,
  auth: ProjectAuthContext,
): void {
  assertActiveWritable(project, auth);
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

/** Read one agent only within its named project and the caller's organization. */
export async function getProjectAgent(
  sql: Sql | TransactionSql,
  auth: ProjectAuthContext,
  projectId: string,
  agentId: string,
): Promise<ProjectAgentRow | null> {
  const project = await loadProjectOrThrow(sql, projectId);
  assertReadable(project, auth);
  const rows = await sql<ProjectAgentRow[]>`
    SELECT ${sql.unsafe(PROJECT_AGENT_COLUMNS)} FROM app.project_agents
    WHERE id = ${agentId} AND project_id = ${projectId}
      AND org_id = ${auth.organizationId}
    LIMIT 1
  `;
  return rows[0] ?? null;
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
    /** Default `prune` — the app dialog's rule. */
    unknownSecrets?: UnknownSecretsPolicy;
  },
): Promise<string> {
  const project = await loadProjectOrThrow(tx, args.projectId);
  assertAgentWritable(project, auth);
  const fields = validateProjectAgentFields(args);
  await assertAgentEquipment(tx, auth, args.projectId, fields);
  fields.secrets = await resolveSecretGrants(
    tx,
    auth.organizationId,
    fields.secrets,
    args.unknownSecrets ?? 'prune',
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
    // The state refuses the action — the 409 every other duplicate on the
    // machine door answers (`PROJECT_KEY_TAKEN`, `FOLDER_NAME_TAKEN`), so a
    // client that reuses on 409 and gives up on 400 does the right thing.
    throw new ProjectError('PROJECT_AGENT_NAME_TAKEN', 'Agent name taken', 409);
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
    throw new Error('PROJECT_AGENT_CREATE_FAILED: the insert answered no row');
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

/** What the standard agent is made of (`standard-agent.ts` decides it). */
export interface ManagedProjectAgentFields {
  name: string;
  harness: string;
  model: string;
  modelProvider: string;
  skills: string[];
  instructions: string;
}

/**
 * Write the organization's standard agent into a project: the managed row,
 * the project's agent count, the audit row and the hint, as
 * `createProjectAgent` writes a person's agent. The gates are the caller's
 * (`ensureStandardAgent`): it may be a Member handing work to a project, so
 * no edit right is asked here. Two people handing work to the same project
 * at once create one agent — the partial unique index (migration 0146)
 * answers the second insert with nothing, and this answers the first's row.
 */
export async function insertManagedProjectAgent(
  tx: TransactionSql,
  auth: ProjectAuthContext,
  project: { id: string; name: string },
  fields: ManagedProjectAgentFields,
): Promise<{ agentId: string; created: boolean }> {
  const now = Date.now();
  const inserted = await tx<{ id: string }[]>`
    INSERT INTO app.project_agents (
      org_id, project_id, name, harness, model, model_provider, skills,
      connectors, tools, secrets, instructions, managed, created_by,
      created_at_ms, updated_at_ms
    ) VALUES (
      ${auth.organizationId}, ${project.id}, ${fields.name},
      ${fields.harness}, ${fields.model}, ${fields.modelProvider},
      ${fields.skills}, ${[]}, ${[]}, ${[]}, ${fields.instructions}, true,
      ${auth.userId}, ${now}, ${now}
    )
    ON CONFLICT (project_id) WHERE managed DO NOTHING
    RETURNING id
  `;
  const agentId = inserted[0]?.id;
  if (agentId === undefined) {
    const standing = await tx<{ id: string }[]>`
      SELECT id FROM app.project_agents
      WHERE project_id = ${project.id} AND managed
      LIMIT 1
    `;
    const existing = standing[0]?.id;
    if (existing === undefined) {
      throw new Error(
        'PROJECT_AGENT_CREATE_FAILED: the standard agent insert answered no row and none stands',
      );
    }
    return { agentId: existing, created: false };
  }
  await tx`
    UPDATE app.projects SET
      project_agent_count = project_agent_count + 1, updated_at_ms = ${now}
    WHERE id = ${project.id}
  `;
  await createAuditLog(
    tx,
    projectAudit(auth, project, PROJECT_AUDIT_ACTIONS.agentsChanged, {
      newState: {
        name: fields.name,
        harness: fields.harness,
        model: fields.model,
        skills: fields.skills,
      },
      metadata: { op: 'create', projectAgentId: agentId, managed: true },
    }),
  );
  await hintProject(tx, auth.organizationId, project.id);
  return { agentId, created: true };
}

/**
 * Bring a standard agent's stored settings in line with what the policy
 * resolved for a run (`standard-agent.ts`), so its row — the Agents tab, the
 * run card, the next run's resume plan — says what actually runs. Writes
 * only on a difference, and no audit row: this is the organization's own
 * setting applied, not a person's edit (the policy save audits that).
 *
 * Never waits for the row. The kick calling this already holds the task's
 * lock, while a delegated start takes the agent's before the task's
 * (`delegated-start.ts`): waiting here could close that circle. A row
 * another start holds is skipped; the run itself carries what resolved, and
 * the next start writes the row.
 */
export async function alignManagedProjectAgent(
  tx: TransactionSql,
  agent: {
    id: string;
    organizationId: string;
    projectId: string;
  },
  fields: Pick<
    ManagedProjectAgentFields,
    'harness' | 'model' | 'modelProvider' | 'instructions'
  >,
): Promise<boolean> {
  const changed = await tx<{ id: string }[]>`
    UPDATE app.project_agents SET
      harness = ${fields.harness}, model = ${fields.model},
      model_provider = ${fields.modelProvider},
      instructions = ${fields.instructions}, updated_at_ms = ${Date.now()}
    WHERE id = (
      SELECT id FROM app.project_agents
      WHERE id = ${agent.id} AND managed
        AND (harness IS DISTINCT FROM ${fields.harness}
          OR model IS DISTINCT FROM ${fields.model}
          OR model_provider IS DISTINCT FROM ${fields.modelProvider}
          OR instructions IS DISTINCT FROM ${fields.instructions})
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id
  `;
  if (changed.length === 0) return false;
  await hintProject(tx, agent.organizationId, agent.projectId);
  return true;
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
    /** Default `prune` — the app dialog's rule. */
    unknownSecrets?: UnknownSecretsPolicy;
    /** The `updatedAt` the caller last read: a save is refused
     * (`PROJECT_AGENT_STALE`, 409) when the agent changed since — the
     * optimistic precondition every full-replace door needs, so two
     * writers cannot silently clobber each other's configuration. */
    expectedUpdatedAt?: number;
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
  if (
    args.expectedUpdatedAt !== undefined &&
    args.expectedUpdatedAt !== agent.updatedAt
  ) {
    throw new ProjectError(
      'PROJECT_AGENT_STALE',
      'The agent changed since it was read; reload it and merge your changes before saving',
      409,
      { updatedAt: agent.updatedAt },
    );
  }
  const project = await loadProjectOrThrow(tx, agent.projectId);
  assertAgentWritable(project, auth);
  if (agent.managed) {
    // Its settings are the organization's: a hand edit would be undone at
    // the next start (`standard-agent.ts`), so it is refused instead — to
    // whoever may edit the project's agents; anyone else hears the gate.
    throw new ProjectError(
      'PROJECT_AGENT_MANAGED',
      "This is the organization's standard agent: its runtime, model and instructions follow the organization's settings, which an Owner or Admin changes under Governance",
      409,
    );
  }
  const fields = validateProjectAgentFields(args);
  await assertAgentEquipment(tx, auth, agent.projectId, fields, {
    skills: agent.skills,
    connectors: agent.connectors,
  });
  // Resolve BEFORE the gate: a set that only lost a deleted secret is not a
  // privileged change, so an editor's unrelated save must not be refused.
  fields.secrets = await resolveSecretGrants(
    tx,
    auth.organizationId,
    fields.secrets,
    args.unknownSecrets ?? 'prune',
  );
  assertMaySetSecrets(auth, fields.secrets, agent.secrets);

  // A replace that names the configuration already stored is not a change:
  // no write, no audit row, and `updatedAt` — the precondition every other
  // writer holds — stays, so two declarative writers re-asserting one
  // configuration no longer 409 each other (2026-09-19 evaluation, K4-5).
  // The stored lists passed the same normaliser on their way in, so an
  // element-wise compare is exact.
  const sameList = (a: readonly string[], b: readonly string[]) =>
    a.length === b.length && a.every((value, index) => value === b[index]);
  if (
    fields.name === agent.name &&
    fields.harness === agent.harness &&
    fields.model === agent.model &&
    (fields.modelProvider ?? null) === (agent.modelProvider ?? null) &&
    sameList(fields.skills, agent.skills) &&
    sameList(fields.connectors, agent.connectors) &&
    sameList(fields.tools, agent.tools) &&
    sameList(fields.secrets, agent.secrets) &&
    (fields.instructions ?? null) === (agent.instructions ?? null)
  ) {
    return;
  }

  const nameClash = await tx<{ id: string }[]>`
    SELECT id FROM app.project_agents
    WHERE project_id = ${agent.projectId}
      AND lower(name) = ${fields.name.toLowerCase()}
      AND id <> ${args.agentId}
    LIMIT 1
  `;
  if (nameClash.length > 0) {
    // The state refuses the action — the 409 every other duplicate on the
    // machine door answers (`PROJECT_KEY_TAKEN`, `FOLDER_NAME_TAKEN`), so a
    // client that reuses on 409 and gives up on 400 does the right thing.
    throw new ProjectError('PROJECT_AGENT_NAME_TAKEN', 'Agent name taken', 409);
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
  assertAgentWritable(project, auth);

  await tx`DELETE FROM app.project_agents WHERE id = ${agentId}`;
  // Its workspaces — the standing one and every member's — go once this
  // commits: nothing can run the agent again to use them.
  await scheduleAgentWorkspaceRetirement(tx, {
    organizationId: auth.organizationId,
    agentIds: [agentId],
  });
  // The docs' promise, kept in the same transaction: no task stays "assigned"
  // to a row that is gone (the board showed the raw id, Retry re-kicked an
  // agent that could not exist). History — runs, comments, activity — stays.
  const unassignedTaskIds = await clearAgentAssignmentsInTx(tx, {
    organizationId: auth.organizationId,
    projectId: agent.projectId,
    agentId,
    actorId: auth.userId,
  });
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
      metadata: {
        op: 'delete',
        projectAgentId: agentId,
        unassignedTaskCount: unassignedTaskIds.length,
      },
    }),
  );
  await hintProject(tx, auth.organizationId, agent.projectId);
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** The audience rule (`audienceClause`) over the project's teams — the
 * array, with the legacy-pair fallback for a row the previous image wrote
 * during a rollout (`PROJECT_TEAM_IDS_SQL`). Admins see every project. */
function visibilityClause(sql: Sql | TransactionSql, auth: ProjectAuthContext) {
  return audienceClause(sql, 'project_team_ids', auth);
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
  // #2999: an archived project stays searchable. `PROJECT_COLUMNS` already
  // carries `archived_at_ms`, so the caller labels the row from what it gets.
  // Archived rows sort last so they cannot fill the capped page.
  return sql<ProjectRow[]>`
    SELECT ${sql.unsafe(PROJECT_COLUMNS)} FROM app.projects
    WHERE org_id = ${auth.organizationId}
      AND name ILIKE ${term}
      AND ${visibilityClause(sql, auth)}
    ORDER BY (archived_at_ms IS NOT NULL), updated_at_ms DESC
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

  const teamIds = project.teamIds;
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

/** Lookup by the caller-owned natural key — the REST door's find lane. The
 * key is compared in its canonical form (NFC, trimmed), the form the
 * create stored it in. */
export async function getProjectByExternalItemId(
  sql: Sql,
  organizationId: string,
  externalItemId: string,
): Promise<ProjectRow | null> {
  const key = canonicalExternalKey(externalItemId);
  if (key === '') return null;
  const rows = await sql<ProjectRow[]>`
    SELECT ${sql.unsafe(PROJECT_COLUMNS)} FROM app.projects
    WHERE org_id = ${organizationId} AND external_item_id = ${key}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

/** The lifecycle filter of the project listing. */
export type ProjectArchivedFilter = 'exclude' | 'include' | 'only';

/**
 * One page of the projects visible to the caller, newest first — the REST
 * door's list, keyed like every keyset listing on the door on
 * `(created_at_ms DESC, id DESC)`; `cursor` is the previous page's last
 * row. Answers one row more than `limit` asks for, so the caller can tell
 * whether a next page exists without a count.
 */
export async function listProjectsPage(
  sql: Sql,
  auth: ProjectAuthContext,
  options: {
    archived: ProjectArchivedFilter;
    limit: number;
    cursor: { at: number; id: string } | null;
  },
): Promise<{ projects: ProjectRow[]; hasMore: boolean }> {
  const cursorAt = options.cursor?.at ?? null;
  const cursorId = options.cursor?.id ?? null;
  const rows = await sql<ProjectRow[]>`
    SELECT ${sql.unsafe(PROJECT_COLUMNS)} FROM app.projects
    WHERE org_id = ${auth.organizationId}
      AND (${options.archived === 'include'}
        OR (${options.archived === 'only'} AND archived_at_ms IS NOT NULL)
        OR (${options.archived === 'exclude'} AND archived_at_ms IS NULL))
      AND ${visibilityClause(sql, auth)}
      AND (${cursorAt}::bigint IS NULL
        OR created_at_ms < ${cursorAt}
        OR (created_at_ms = ${cursorAt} AND id < ${cursorId}))
    ORDER BY created_at_ms DESC, id DESC
    LIMIT ${options.limit + 1}
  `;
  return {
    projects: rows.slice(0, options.limit),
    hasMore: rows.length > options.limit,
  };
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
