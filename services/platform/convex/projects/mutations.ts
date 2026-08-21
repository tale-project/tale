/**
 * Projects feature mutations.
 *
 * Every mutation:
 *  - validates org membership via `getOrganizationMember`,
 *  - applies per-project access via `hasProjectAccess` / `checkProjectAccess`,
 *  - writes a `createAuditLog` entry per §9 of the plan.
 *
 * Mutual exclusivity rule for documents:
 *   A document carries `teamId` OR `projectId`, never both.
 *   `attachDocumentToProject` requires `teamId` empty.
 *   `detachDocumentFromProject` leaves both null (doc becomes an org-wide
 *   library doc) — which is why it demands an explicit `destination` and
 *   audits the scope transition (issue #2546).
 */

import { ConvexError, v } from 'convex/values';

import { isHarnessSlug } from '../../lib/harnesses/types';
import { defineAbilityFor } from '../../lib/permissions/ability';
import {
  deriveProjectKey,
  isValidProjectKey,
  normalizeProjectKey,
  PROJECT_KEY_MAX,
} from '../../lib/shared/project_key';
import { internal } from '../_generated/api';
import type { Doc, Id } from '../_generated/dataModel';
import { mutation, type MutationCtx } from '../_generated/server';
import { createAuditLog } from '../audit_logs/helpers';
import { emitEvent } from '../events/emit';
import { getUserTeamIds } from '../lib/get_user_teams';
import {
  checkUserRateLimit,
  RateLimitExceededError,
} from '../lib/rate_limiter/helpers';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';
import { normalizeToolGrants } from '../sandbox/tool_names';
import { ensureDefaultProjectLabels } from '../tasks/helpers';
import {
  ADMIN_ROLES,
  checkProjectAccess,
  isOrgWideProject,
  normalizeSharing,
} from './access';
import { PROJECT_AUDIT_ACTIONS, PROJECT_RESOURCE_TYPE } from './audit_actions';
import {
  projectConnectorsModeValidator,
  projectKnowledgeModeValidator,
  projectModeValidator,
} from './schema';

const PROJECT_NAME_MAX = 80;
const PROJECT_DESCRIPTION_MAX = 500;
const PROJECT_EXTERNAL_ITEM_ID_MAX = 256;
const PROJECT_INSTRUCTIONS_MAX_CHARS = 6000;
const PROJECT_SHARED_TEAMS_MAX = 20;

/** Map rate-limiter exceptions to a structured ConvexError the UI handles.
 * Exported for the machine-door twin (`internal_mutations.createProjectForUser`),
 * whose REST wrapper turns the code into a 429 + Retry-After. */
export function mapRateLimitError(error: unknown): never {
  if (error instanceof RateLimitExceededError) {
    throw new ConvexError({
      code: 'RATE_LIMITED',
      data: { retryAfterMs: error.retryAfter },
    });
  }
  throw error;
}

interface AuthContext {
  userId: string;
  email?: string;
  role: string;
  teamIds: string[];
}

async function getAuthContext(
  ctx: MutationCtx,
  organizationId: string,
): Promise<AuthContext> {
  const authUser = await getAuthUserIdentity(ctx);
  if (!authUser) throw new ConvexError({ code: 'UNAUTHENTICATED' });

  const member = await getOrganizationMember(ctx, organizationId, authUser);
  const teamIds = await getUserTeamIds(ctx, member.userId);
  return {
    userId: member.userId,
    email: authUser.email,
    role: member.role,
    teamIds,
  };
}

async function loadProjectOrThrow(
  ctx: MutationCtx,
  projectId: Id<'projects'>,
): Promise<Doc<'projects'>> {
  const project = await ctx.db.get(projectId);
  if (!project) {
    throw new ConvexError({ code: 'PROJECT_NOT_FOUND' });
  }
  return project;
}

function assertReadable(project: Doc<'projects'>, auth: AuthContext): void {
  const access = checkProjectAccess(project, auth.teamIds, auth.role);
  if (!access.canRead) {
    throw new ConvexError({ code: 'PROJECT_FORBIDDEN' });
  }
}

function assertWritable(project: Doc<'projects'>, auth: AuthContext): void {
  const access = checkProjectAccess(project, auth.teamIds, auth.role);
  if (!access.canRead) {
    throw new ConvexError({ code: 'PROJECT_FORBIDDEN' });
  }
  if (!access.canEdit) {
    throw new ConvexError({ code: 'RBAC_FORBIDDEN' });
  }
}

function assertAdmin(auth: AuthContext): void {
  if (!ADMIN_ROLES.has(auth.role)) {
    throw new ConvexError({ code: 'ROLE_FORBIDDEN' });
  }
}

function validateName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new ConvexError({
      code: 'PROJECT_NAME_INVALID',
      message: 'Project name cannot be empty',
    });
  }
  if (trimmed.length > PROJECT_NAME_MAX) {
    throw new ConvexError({
      code: 'PROJECT_NAME_INVALID',
      message: `Project name must be at most ${PROJECT_NAME_MAX} characters`,
    });
  }
  return trimmed;
}

function validateDescription(
  description: string | undefined,
): string | undefined {
  if (description == null) return undefined;
  const trimmed = description.trim();
  if (trimmed.length > PROJECT_DESCRIPTION_MAX) {
    throw new ConvexError({ code: 'PROJECT_DESCRIPTION_INVALID' });
  }
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Resolve the immutable project key: an explicit value if the user supplied one,
 * otherwise derived from the name. Validates shape and enforces per-org
 * uniqueness so task identifiers (`KEY-n`) never collide. Throws
 * `PROJECT_KEY_INVALID` / `PROJECT_KEY_TAKEN`.
 */
async function resolveProjectKey(
  ctx: MutationCtx,
  organizationId: string,
  rawKey: string | undefined,
  name: string,
): Promise<string> {
  const key = normalizeProjectKey(rawKey?.trim() || deriveProjectKey(name));
  if (!isValidProjectKey(key)) {
    throw new ConvexError({
      code: 'PROJECT_KEY_INVALID',
      message: 'Project key must be 2-6 characters, letters and digits only',
    });
  }
  const clash = await ctx.db
    .query('projects')
    .withIndex('by_organization_key', (q) =>
      q.eq('organizationId', organizationId).eq('key', key),
    )
    .first();
  if (clash) {
    throw new ConvexError({
      code: 'PROJECT_KEY_TAKEN',
      message: `Project key "${key}" is already taken in this organization`,
    });
  }
  return key;
}

/**
 * Pick a unique, valid key with no key input: derives from the name like
 * {@link resolveProjectKey}, but appends a numeric suffix until the per-org
 * uniqueness index clears instead of throwing, and returns `undefined` when no
 * valid key can be derived (e.g. a name with no letters) — the project is then
 * keyless, matching pre-key-migration projects. Used where nobody can resolve
 * a collision interactively: project duplication, and the machine door's
 * derived-key lane (`createProjectCore` with `deriveKeyOnCollision`).
 */
async function resolveDuplicateProjectKey(
  ctx: MutationCtx,
  organizationId: string,
  name: string,
): Promise<string | undefined> {
  const base = deriveProjectKey(name);
  if (!isValidProjectKey(base)) return undefined;
  for (let n = 0; n < 1000; n += 1) {
    const candidate =
      n === 0
        ? base
        : `${base.slice(0, PROJECT_KEY_MAX - String(n).length)}${n}`;
    if (!isValidProjectKey(candidate)) continue;
    const clash = await ctx.db
      .query('projects')
      .withIndex('by_organization_key', (q) =>
        q.eq('organizationId', organizationId).eq('key', candidate),
      )
      .first();
    if (!clash) return candidate;
  }
  return undefined;
}

/**
 * Validate and reserve the caller-owned external item id: an opaque key an
 * external system attaches at creation, stored trimmed and never interpreted
 * by the platform. Enforces per-org uniqueness via
 * `by_organization_externalItemId` regardless of lifecycle — a conflict
 * against an archived project is still a conflict. Throws
 * `PROJECT_EXTERNAL_ITEM_ID_INVALID` / `PROJECT_DUPLICATE_EXTERNAL_ID`.
 */
async function resolveExternalItemId(
  ctx: MutationCtx,
  organizationId: string,
  raw: string | undefined,
): Promise<string | undefined> {
  if (raw == null) return undefined;
  const externalItemId = raw.trim();
  if (
    externalItemId.length === 0 ||
    externalItemId.length > PROJECT_EXTERNAL_ITEM_ID_MAX
  ) {
    throw new ConvexError({
      code: 'PROJECT_EXTERNAL_ITEM_ID_INVALID',
      message: `externalItemId must be 1-${PROJECT_EXTERNAL_ITEM_ID_MAX} characters after trimming`,
    });
  }
  const clash = await ctx.db
    .query('projects')
    .withIndex('by_organization_externalItemId', (q) =>
      q
        .eq('organizationId', organizationId)
        .eq('externalItemId', externalItemId),
    )
    .first();
  if (clash) {
    throw new ConvexError({
      code: 'PROJECT_DUPLICATE_EXTERNAL_ID',
      message: `A project with externalItemId "${externalItemId}" already exists in this organization`,
      externalItemId,
    });
  }
  return externalItemId;
}

function validateInstructions(instructions: string): string {
  if (instructions.length > PROJECT_INSTRUCTIONS_MAX_CHARS) {
    throw new ConvexError({
      code: 'PROJECT_INSTRUCTIONS_TOO_LONG',
      data: { cap: PROJECT_INSTRUCTIONS_MAX_CHARS },
    });
  }
  return instructions;
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

/**
 * Array-element diff used in audit metadata for slug-list mutations.
 * Compliance dashboards consume `added` / `removed` instead of parsing
 * `previousState` / `newState` arrays.
 */
function arrayDiff(
  previous: string[] | undefined,
  next: string[] | undefined,
): { added: string[]; removed: string[] } {
  const prev = new Set(previous ?? []);
  const nxt = new Set(next ?? []);
  const added: string[] = [];
  const removed: string[] = [];
  for (const item of nxt) if (!prev.has(item)) added.push(item);
  for (const item of prev) if (!nxt.has(item)) removed.push(item);
  return { added, removed };
}

/**
 * Reject duplicate `teamId ∈ sharedWithTeamIds` and dupes inside the array.
 * `checkProjectAccess`'s downstream `Set` dedupe tolerates either, but the API
 * surface should reject so audit `previousState`/`newState` diffs stay clean.
 */
function validateSharing(
  teamId: string | null | undefined,
  sharedWithTeamIds: string[] | undefined,
): void {
  if (!sharedWithTeamIds) return;
  if (sharedWithTeamIds.length > PROJECT_SHARED_TEAMS_MAX) {
    throw new ConvexError({ code: 'PROJECT_SHARING_INVALID' });
  }
  const set = new Set(sharedWithTeamIds);
  if (set.size !== sharedWithTeamIds.length) {
    throw new ConvexError({ code: 'PROJECT_SHARING_INVALID' });
  }
  if (teamId && set.has(teamId)) {
    throw new ConvexError({ code: 'PROJECT_SHARING_INVALID' });
  }
}

/**
 * For `restricted` mode, every recommended item must be a subset of allowed.
 * (UI prevents but the API surface should reject so we don't store an
 * inconsistent state.)
 */
function validateRecommendedSubsetOfAllowed(
  mode: 'all' | 'recommended' | 'restricted',
  recommended: string[] | undefined,
  allowed: string[] | undefined,
): void {
  if (mode !== 'restricted') return;
  if (!recommended || recommended.length === 0) return;
  const allowedSet = new Set(allowed ?? []);
  for (const item of recommended) {
    if (!allowedSet.has(item)) {
      throw new ConvexError({ code: 'PROJECT_RECOMMENDED_NOT_SUBSET' });
    }
  }
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export interface CreateProjectCoreArgs {
  organizationId: string;
  /** The acting user — the session identity, or the REST key holder. */
  userId: string;
  /** Actor email for the audit trail; absent for keys with no email. */
  userEmail?: string;
  name: string;
  key?: string;
  description?: string;
  icon?: string;
  color?: string;
  externalItemId?: string;
  teamId?: string;
  sharedWithTeamIds?: string[];
  /**
   * When no explicit `key` is supplied, resolve a derived-key collision by
   * numeric suffix (and an underivable name to a keyless project) instead of
   * throwing `PROJECT_KEY_TAKEN`/`PROJECT_KEY_INVALID`. The machine door sets
   * this — a REST caller creating projects in bulk has no interactive way to
   * pick another key, and two client names can share initials. An explicit
   * `key` still conflicts loudly.
   */
  deriveKeyOnCollision?: boolean;
}

/**
 * The one create-project core: field validation, key + externalItemId
 * uniqueness, the insert, the audit row, default labels, and the
 * `project.created` event. Shared by the session `createProject` and the
 * machine door (`internal_mutations.createProjectForUser`) so the two can
 * never drift. Callers own authentication, the editor-role gate, and the
 * `project:create` rate charge.
 */
export async function createProjectCore(
  ctx: MutationCtx,
  args: CreateProjectCoreArgs,
): Promise<Id<'projects'>> {
  const name = validateName(args.name);
  const description = validateDescription(args.description);
  // The caller-owned external key is checked BEFORE the project key so a
  // duplicate externalItemId reports as its own conflict — a machine caller
  // must never mistake "this client already has a project" for a key clash.
  const externalItemId = await resolveExternalItemId(
    ctx,
    args.organizationId,
    args.externalItemId,
  );
  const key =
    args.deriveKeyOnCollision && !args.key?.trim()
      ? await resolveDuplicateProjectKey(ctx, args.organizationId, name)
      : await resolveProjectKey(ctx, args.organizationId, args.key, name);
  const sharedWithTeamIds = args.sharedWithTeamIds ?? [];
  validateSharing(args.teamId, args.sharedWithTeamIds);

  const now = Date.now();
  const projectId = await ctx.db.insert('projects', {
    organizationId: args.organizationId,
    name,
    key,
    externalItemId,
    taskCounter: 0,
    // Explicit zeros rather than undefined so a fresh project reads the same
    // as one the backfill migration has touched.
    openTaskCount: 0,
    doneTaskCount: 0,
    projectAgentCount: 0,
    description,
    icon: args.icon,
    color: args.color,
    teamId: args.teamId || undefined,
    sharedWithTeamIds:
      sharedWithTeamIds.length > 0 ? sharedWithTeamIds : undefined,
    createdBy: args.userId,
    createdAt: now,
    updatedAt: now,
  });

  await createAuditLog(ctx, {
    organizationId: args.organizationId,
    actorId: args.userId,
    actorEmail: args.userEmail,
    actorType: 'user',
    action: PROJECT_AUDIT_ACTIONS.created,
    category: 'data',
    resourceType: PROJECT_RESOURCE_TYPE,
    resourceId: String(projectId),
    resourceName: name,
    newState: {
      name,
      teamId: args.teamId ?? null,
      sharedWithTeamIds,
    },
    metadata: {
      isOrgWide: !args.teamId && sharedWithTeamIds.length === 0,
    },
    status: 'success',
  });

  await ensureDefaultProjectLabels(ctx, {
    organizationId: args.organizationId,
    projectId,
    createdBy: args.userId,
  });

  const project = await ctx.db.get(projectId);
  if (project) {
    await emitEvent(ctx, {
      organizationId: args.organizationId,
      eventType: 'project.created',
      eventData: { project },
    });
  }

  return projectId;
}

export const createProject = mutation({
  args: {
    organizationId: v.string(),
    name: v.string(),
    key: v.optional(v.string()),
    description: v.optional(v.string()),
    icon: v.optional(v.string()),
    color: v.optional(v.string()),
    externalItemId: v.optional(v.string()),
    teamId: v.optional(v.string()),
    sharedWithTeamIds: v.optional(v.array(v.string())),
  },
  returns: v.id('projects'),
  handler: async (ctx, args) => {
    const auth = await getAuthContext(ctx, args.organizationId);

    // Only editor+ can create.
    if (auth.role === 'member' || auth.role === 'disabled' || !auth.role) {
      throw new ConvexError({ code: 'RBAC_FORBIDDEN' });
    }

    try {
      await checkUserRateLimit(ctx, 'project:create', auth.userId);
    } catch (error) {
      mapRateLimitError(error);
    }

    return await createProjectCore(ctx, {
      ...args,
      userId: auth.userId,
      userEmail: auth.email,
    });
  },
});

// ---------------------------------------------------------------------------
// Identity update
// ---------------------------------------------------------------------------

export const updateProjectIdentity = mutation({
  args: {
    projectId: v.id('projects'),
    name: v.optional(v.string()),
    description: v.optional(v.union(v.string(), v.null())),
    icon: v.optional(v.union(v.string(), v.null())),
    color: v.optional(v.union(v.string(), v.null())),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const project = await loadProjectOrThrow(ctx, args.projectId);
    const auth = await getAuthContext(ctx, project.organizationId);
    assertWritable(project, auth);

    const patch: Partial<Doc<'projects'>> = { updatedAt: Date.now() };
    const previousState: Record<string, unknown> = {};
    const newState: Record<string, unknown> = {};

    if (args.name !== undefined) {
      const name = validateName(args.name);
      patch.name = name;
      previousState.name = project.name;
      newState.name = name;
    }
    if (args.description !== undefined) {
      const desc =
        args.description === null
          ? undefined
          : validateDescription(args.description);
      patch.description = desc;
      previousState.description = project.description ?? null;
      newState.description = desc ?? null;
    }
    if (args.icon !== undefined) {
      patch.icon = args.icon === null ? undefined : args.icon;
      previousState.icon = project.icon ?? null;
      newState.icon = args.icon ?? null;
    }
    if (args.color !== undefined) {
      patch.color = args.color === null ? undefined : args.color;
      previousState.color = project.color ?? null;
      newState.color = args.color ?? null;
    }

    await ctx.db.patch(args.projectId, patch);

    await createAuditLog(ctx, {
      organizationId: project.organizationId,
      actorId: auth.userId,
      actorEmail: auth.email,
      actorType: 'user',
      action: PROJECT_AUDIT_ACTIONS.updated,
      category: 'data',
      resourceType: PROJECT_RESOURCE_TYPE,
      resourceId: String(args.projectId),
      resourceName: project.name,
      previousState,
      newState,
      changedFields: diff(previousState, newState),
      status: 'success',
    });

    return null;
  },
});

/**
 * Pin / unpin a project in the chat-history sidebar. The pin lives on the
 * shared project doc (so it reorders the folder for everyone who sees the
 * project, mirroring how the project itself is shared). Gated on read
 * access — any member who can see the project may reorder it; this is a
 * benign UI preference, not a content edit, so it does not require
 * edit/admin rights.
 */
export const setProjectPinned = mutation({
  args: {
    projectId: v.id('projects'),
    pinned: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const project = await loadProjectOrThrow(ctx, args.projectId);
    const auth = await getAuthContext(ctx, project.organizationId);
    assertReadable(project, auth);

    await ctx.db.patch(args.projectId, {
      pinnedAt: args.pinned ? Date.now() : undefined,
    });

    await createAuditLog(ctx, {
      organizationId: project.organizationId,
      actorId: auth.userId,
      actorEmail: auth.email,
      actorType: 'user',
      action: PROJECT_AUDIT_ACTIONS.updated,
      category: 'data',
      resourceType: PROJECT_RESOURCE_TYPE,
      resourceId: String(args.projectId),
      resourceName: project.name,
      changedFields: ['pinnedAt'],
      status: 'success',
    });

    return null;
  },
});

// ---------------------------------------------------------------------------
// Instructions
// ---------------------------------------------------------------------------

export const updateProjectInstructions = mutation({
  args: {
    projectId: v.id('projects'),
    instructions: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const project = await loadProjectOrThrow(ctx, args.projectId);
    const auth = await getAuthContext(ctx, project.organizationId);
    assertWritable(project, auth);

    const instructions = validateInstructions(args.instructions);
    const previousLength = project.instructions?.length ?? 0;
    const newLength = instructions.length;

    await ctx.db.patch(args.projectId, {
      instructions: instructions.length > 0 ? instructions : undefined,
      updatedAt: Date.now(),
    });

    await createAuditLog(ctx, {
      organizationId: project.organizationId,
      actorId: auth.userId,
      actorEmail: auth.email,
      actorType: 'user',
      action: PROJECT_AUDIT_ACTIONS.instructionsChanged,
      category: 'data',
      resourceType: PROJECT_RESOURCE_TYPE,
      resourceId: String(args.projectId),
      resourceName: project.name,
      // Per §9: body is NOT logged. Only previous/new length.
      metadata: { previousLength, newLength },
      status: 'success',
    });

    return null;
  },
});

// ---------------------------------------------------------------------------
// Sharing (admin only)
// ---------------------------------------------------------------------------

export const updateProjectSharing = mutation({
  args: {
    projectId: v.id('projects'),
    teamId: v.optional(v.union(v.string(), v.null())),
    sharedWithTeamIds: v.optional(v.array(v.string())),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const project = await loadProjectOrThrow(ctx, args.projectId);
    const auth = await getAuthContext(ctx, project.organizationId);
    assertReadable(project, auth);
    assertAdmin(auth);

    const sharedWithTeamIds = args.sharedWithTeamIds;
    // H2: reject duplicate teamId + dupes inside the array.
    const effectiveTeamId =
      args.teamId === null ? null : (args.teamId ?? project.teamId ?? null);
    validateSharing(effectiveTeamId, sharedWithTeamIds);

    const previousState = {
      teamId: project.teamId ?? null,
      sharedWithTeamIds: project.sharedWithTeamIds ?? [],
    };

    // Resolve the requested shares (fall back to the stored ones when the arg
    // is omitted), then normalize: dropping the owning team (→ org-wide) clears
    // the shared list so the project can't be left silently restricted to teams
    // that the UI no longer surfaces. Without this, going "Org-wide" while
    // `sharedWithTeamIds` is non-empty orphans those shares.
    const requestedShared =
      sharedWithTeamIds !== undefined
        ? sharedWithTeamIds
        : previousState.sharedWithTeamIds;
    const normalized = normalizeSharing(effectiveTeamId, requestedShared);

    const newState = {
      teamId: normalized.teamId,
      sharedWithTeamIds: normalized.sharedWithTeamIds,
    };

    const patch: Partial<Doc<'projects'>> = {
      teamId: newState.teamId ?? undefined,
      sharedWithTeamIds:
        newState.sharedWithTeamIds.length > 0
          ? newState.sharedWithTeamIds
          : undefined,
      updatedAt: Date.now(),
    };

    await ctx.db.patch(args.projectId, patch);

    await createAuditLog(ctx, {
      organizationId: project.organizationId,
      actorId: auth.userId,
      actorEmail: auth.email,
      actorType: 'user',
      action: PROJECT_AUDIT_ACTIONS.sharingChanged,
      category: 'data',
      resourceType: PROJECT_RESOURCE_TYPE,
      resourceId: String(args.projectId),
      resourceName: project.name,
      previousState,
      newState,
      changedFields: diff(previousState, newState),
      metadata: {
        wasOrgWide: isOrgWideProject(project),
        nowOrgWide: !newState.teamId && newState.sharedWithTeamIds.length === 0,
      },
      status: 'success',
    });

    return null;
  },
});

// ---------------------------------------------------------------------------
// Knowledge mode
// ---------------------------------------------------------------------------

export const updateProjectKnowledgeMode = mutation({
  args: {
    projectId: v.id('projects'),
    knowledgeMode: projectKnowledgeModeValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const project = await loadProjectOrThrow(ctx, args.projectId);
    const auth = await getAuthContext(ctx, project.organizationId);
    assertWritable(project, auth);

    const previousKnowledgeMode = project.knowledgeMode ?? null;

    await ctx.db.patch(args.projectId, {
      knowledgeMode: args.knowledgeMode,
      updatedAt: Date.now(),
    });

    await createAuditLog(ctx, {
      organizationId: project.organizationId,
      actorId: auth.userId,
      actorEmail: auth.email,
      actorType: 'user',
      action: PROJECT_AUDIT_ACTIONS.knowledgeModeChanged,
      category: 'data',
      resourceType: PROJECT_RESOURCE_TYPE,
      resourceId: String(args.projectId),
      resourceName: project.name,
      previousState: { knowledgeMode: previousKnowledgeMode },
      newState: { knowledgeMode: args.knowledgeMode },
      status: 'success',
    });

    return null;
  },
});

// ---------------------------------------------------------------------------
// Agent settings
// ---------------------------------------------------------------------------

export const updateProjectAgentSettings = mutation({
  args: {
    projectId: v.id('projects'),
    agentMode: projectModeValidator,
    recommendedAgentSlugs: v.optional(v.array(v.string())),
    allowedAgentSlugs: v.optional(v.array(v.string())),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const project = await loadProjectOrThrow(ctx, args.projectId);
    const auth = await getAuthContext(ctx, project.organizationId);
    assertWritable(project, auth);

    const previousState = {
      agentMode: project.agentMode ?? 'all',
      recommendedAgentSlugs: project.recommendedAgentSlugs ?? [],
      allowedAgentSlugs: project.allowedAgentSlugs ?? [],
    };
    const newState = {
      agentMode: args.agentMode,
      recommendedAgentSlugs: args.recommendedAgentSlugs ?? [],
      allowedAgentSlugs: args.allowedAgentSlugs ?? [],
    };

    // H3: recommended must be a subset of allowed in restricted mode.
    validateRecommendedSubsetOfAllowed(
      args.agentMode,
      newState.recommendedAgentSlugs,
      newState.allowedAgentSlugs,
    );

    await ctx.db.patch(args.projectId, {
      agentMode: args.agentMode,
      recommendedAgentSlugs:
        newState.recommendedAgentSlugs.length > 0
          ? newState.recommendedAgentSlugs
          : undefined,
      allowedAgentSlugs:
        newState.allowedAgentSlugs.length > 0
          ? newState.allowedAgentSlugs
          : undefined,
      updatedAt: Date.now(),
    });

    // H8: log slug diffs explicitly alongside previous/new state.
    const recommendedDiff = arrayDiff(
      previousState.recommendedAgentSlugs,
      newState.recommendedAgentSlugs,
    );
    const allowedDiff = arrayDiff(
      previousState.allowedAgentSlugs,
      newState.allowedAgentSlugs,
    );

    await createAuditLog(ctx, {
      organizationId: project.organizationId,
      actorId: auth.userId,
      actorEmail: auth.email,
      actorType: 'user',
      action: PROJECT_AUDIT_ACTIONS.agentsChanged,
      category: 'data',
      resourceType: PROJECT_RESOURCE_TYPE,
      resourceId: String(args.projectId),
      resourceName: project.name,
      previousState,
      newState,
      changedFields: diff(previousState, newState),
      metadata: {
        recommendedAdded: recommendedDiff.added,
        recommendedRemoved: recommendedDiff.removed,
        allowedAdded: allowedDiff.added,
        allowedRemoved: allowedDiff.removed,
      },
      status: 'success',
    });

    return null;
  },
});

/** An agent may be equipped with at most this many skills / connectors —
 * mirrors the per-persona `MAX_AGENT_SKILL_BINDINGS`; a generous ceiling, not a
 * curation limit. */
const MAX_PROJECT_AGENT_SKILLS = 25;
const MAX_PROJECT_AGENT_CONNECTORS = 25;
/** Same generous ceiling for the granted platform tools and referenced org
 * secrets. */
const MAX_PROJECT_AGENT_TOOLS = 25;
const MAX_PROJECT_AGENT_SECRETS = 25;
/** A generous runaway guard, not a product limit. */
const MAX_PROJECT_AGENTS = 50;
const PROJECT_AGENT_NAME_MAX = 120;
const PROJECT_AGENT_MODEL_MAX = 200;
/** Matches the governance `system_prompt` policy's instruction cap. */
const PROJECT_AGENT_INSTRUCTIONS_MAX = 20_000;
/**
 * Harness slugs an agent cannot be created on. Cursor is byo-only (no managed
 * lane) and drops composed instructions by design — no channel. The composer
 * roster already offers managed harnesses only; this guards direct API calls.
 */
const PROJECT_AGENT_INELIGIBLE_HARNESSES = new Set(['cursor']);

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

/**
 * Validate + normalize the writable fields of a project agent: trimmed
 * bounded name, shipped managed harness slug, deduped capability sets within
 * the caps, bounded instructions (empty → undefined). Shared by create and
 * update so the two can never drift.
 */
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
    throw new ConvexError({ code: 'PROJECT_AGENT_NAME_INVALID' });
  }
  if (
    !isHarnessSlug(args.harness) ||
    PROJECT_AGENT_INELIGIBLE_HARNESSES.has(args.harness)
  ) {
    throw new ConvexError({ code: 'PROJECT_AGENT_HARNESS_INVALID' });
  }
  // The id's serving resolution is run-time work (`resolveServingTarget`,
  // catalog + credentials — action territory); the mutation holds the shape.
  const model = args.model.trim();
  if (model.length === 0 || model.length > PROJECT_AGENT_MODEL_MAX) {
    throw new ConvexError({ code: 'PROJECT_AGENT_MODEL_INVALID' });
  }
  // The provider pin rides the model pick (the dialog always sends the pair);
  // like the model it is shape-checked here and resolved at run time.
  const modelProvider = args.modelProvider?.trim();
  if (modelProvider !== undefined && modelProvider !== '') {
    if (modelProvider.length > PROJECT_AGENT_MODEL_MAX) {
      throw new ConvexError({ code: 'PROJECT_AGENT_MODEL_INVALID' });
    }
  }
  if (
    args.skills.length > MAX_PROJECT_AGENT_SKILLS ||
    args.connectors.length > MAX_PROJECT_AGENT_CONNECTORS ||
    (args.tools?.length ?? 0) > MAX_PROJECT_AGENT_TOOLS ||
    (args.secrets?.length ?? 0) > MAX_PROJECT_AGENT_SECRETS
  ) {
    throw new ConvexError({
      code: 'too_many_bindings',
      message: `An agent may be equipped with at most ${MAX_PROJECT_AGENT_SKILLS} skills, ${MAX_PROJECT_AGENT_CONNECTORS} connectors, ${MAX_PROJECT_AGENT_TOOLS} tools, and ${MAX_PROJECT_AGENT_SECRETS} secrets.`,
    });
  }
  // Dedupe, drop empties — the equipment is a set, not an ordered list.
  const skills = [...new Set(args.skills.filter((s) => s.length > 0))];
  const connectors = [...new Set(args.connectors.filter((c) => c.length > 0))];
  // Tools are canonicalized against the shipped catalog: an unknown name is
  // dropped, so an equipment row can never grant a tool the bridge won't
  // serve. Secret NAMES are deduped as-is (existence is checked at write in
  // the mutation, which can read the org's secret rows).
  const tools = normalizeToolGrants(args.tools ?? []);
  const secrets = [
    ...new Set((args.secrets ?? []).filter((s) => s.length > 0)),
  ];
  const instructions = args.instructions?.trim();
  if (instructions !== undefined) {
    if (instructions.length > PROJECT_AGENT_INSTRUCTIONS_MAX) {
      throw new ConvexError({ code: 'PROJECT_AGENT_INSTRUCTIONS_TOO_LONG' });
    }
  }
  return {
    name,
    harness: args.harness,
    model,
    modelProvider:
      modelProvider === '' || modelProvider === undefined
        ? undefined
        : modelProvider,
    skills,
    connectors,
    tools,
    secrets,
    instructions: instructions === '' ? undefined : instructions,
  };
}

/** The audit-safe projection of an agent row — instructions ride as a length
 * (a 20k prompt does not belong in an audit row). */
function auditProjectAgentState(fields: ProjectAgentFields) {
  return {
    name: fields.name,
    harness: fields.harness,
    model: fields.model,
    modelProvider: fields.modelProvider ?? null,
    skills: fields.skills,
    connectors: fields.connectors,
    tools: fields.tools,
    // Names only — the values live encrypted on the agentSecrets table.
    secrets: fields.secrets,
    instructionsLength: fields.instructions?.length ?? 0,
  };
}

/**
 * Drop referenced secret names that no longer exist in the org, so an
 * equipment row never carries a dangling name. A create/update reads the org's
 * secret catalog once; unknown names are silently pruned (the manager may have
 * deleted a secret the dialog still listed) rather than throwing — a missing
 * secret is inert at run time anyway.
 */
async function pruneMissingSecrets(
  ctx: MutationCtx,
  organizationId: string,
  requested: string[],
): Promise<string[]> {
  if (requested.length === 0) return [];
  const existing = new Set(
    (
      await ctx.db
        .query('agentSecrets')
        .withIndex('by_org', (q) => q.eq('organizationId', organizationId))
        .collect()
    ).map((row) => row.name),
  );
  return requested.filter((name) => existing.has(name));
}

/**
 * Attaching an org secret to an agent lets that agent's runs read the secret's
 * PLAINTEXT (it is injected as an env var) — so changing the secret set is a
 * privileged act, gated on the SAME developer capability as writing the secret
 * store itself (`requireOrgAdminOrDeveloper`). A plain project editor may edit
 * every other agent field, and may keep an existing secret set unchanged, but
 * may not add or remove a secret grant. `next`/`prev` are compared as sets.
 * (Write-effect TOOLS are not gated here: granting `task_create` gives the
 * agent nothing a project editor cannot already do by hand, so it stays a
 * project-edit act.)
 */
function assertMaySetSecrets(
  auth: AuthContext,
  next: readonly string[],
  prev: readonly string[],
): void {
  const a = new Set(next);
  const b = new Set(prev);
  const unchanged = a.size === b.size && [...a].every((name) => b.has(name));
  if (unchanged) return;
  if (defineAbilityFor(auth.role).cannot('read', 'developerSettings')) {
    throw new ConvexError({ code: 'FORBIDDEN_DEVELOPER_SETTINGS' });
  }
}

/** A sibling agent already holding this name (case-folded), excluding
 * `excludeId` so update can keep its own name. */
async function projectAgentNameTaken(
  ctx: MutationCtx,
  projectId: Id<'projects'>,
  name: string,
  excludeId?: Id<'projectAgents'>,
): Promise<boolean> {
  const siblings = await ctx.db
    .query('projectAgents')
    .withIndex('by_project', (q) => q.eq('projectId', projectId))
    .collect();
  const folded = name.toLowerCase();
  return siblings.some(
    (row) => row._id !== excludeId && row.name.toLowerCase() === folded,
  );
}

/**
 * Create a named agent in a project: one harness plus the skills/connectors
 * it runs pre-equipped with and an optional instructions addendum (delivered
 * through the harness's system-prompt channel by the run lane). Tasks assign
 * work to these rows.
 */
export const createProjectAgent = mutation({
  args: {
    projectId: v.id('projects'),
    name: v.string(),
    harness: v.string(),
    model: v.string(),
    modelProvider: v.optional(v.string()),
    skills: v.array(v.string()),
    connectors: v.array(v.string()),
    tools: v.optional(v.array(v.string())),
    secrets: v.optional(v.array(v.string())),
    instructions: v.optional(v.string()),
  },
  returns: v.id('projectAgents'),
  handler: async (ctx, args) => {
    const project = await loadProjectOrThrow(ctx, args.projectId);
    const auth = await getAuthContext(ctx, project.organizationId);
    assertWritable(project, auth);

    const fields = validateProjectAgentFields(args);
    // Gate on the SUBMITTED intent (before pruning drops names that no longer
    // exist org-side) — a fresh agent starts from no secrets, so any secret is
    // an add, a developer act.
    assertMaySetSecrets(auth, fields.secrets, []);
    fields.secrets = await pruneMissingSecrets(
      ctx,
      project.organizationId,
      fields.secrets,
    );
    const existing = await ctx.db
      .query('projectAgents')
      .withIndex('by_project', (q) => q.eq('projectId', args.projectId))
      .collect();
    if (existing.length >= MAX_PROJECT_AGENTS) {
      throw new ConvexError({ code: 'PROJECT_AGENT_LIMIT' });
    }
    if (await projectAgentNameTaken(ctx, args.projectId, fields.name)) {
      throw new ConvexError({ code: 'PROJECT_AGENT_NAME_TAKEN' });
    }

    const now = Date.now();
    const agentId = await ctx.db.insert('projectAgents', {
      organizationId: project.organizationId,
      projectId: args.projectId,
      name: fields.name,
      harness: fields.harness,
      model: fields.model,
      ...(fields.modelProvider !== undefined
        ? { modelProvider: fields.modelProvider }
        : {}),
      skills: fields.skills,
      connectors: fields.connectors,
      ...(fields.tools.length > 0 ? { tools: fields.tools } : {}),
      ...(fields.secrets.length > 0 ? { secrets: fields.secrets } : {}),
      ...(fields.instructions !== undefined
        ? { instructions: fields.instructions }
        : {}),
      createdBy: auth.userId,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(args.projectId, {
      updatedAt: now,
      projectAgentCount: (project.projectAgentCount ?? 0) + 1,
    });

    await createAuditLog(ctx, {
      organizationId: project.organizationId,
      actorId: auth.userId,
      actorEmail: auth.email,
      actorType: 'user',
      action: PROJECT_AUDIT_ACTIONS.agentsChanged,
      category: 'data',
      resourceType: PROJECT_RESOURCE_TYPE,
      resourceId: String(args.projectId),
      resourceName: project.name,
      newState: auditProjectAgentState(fields),
      metadata: { op: 'create', projectAgentId: String(agentId) },
      status: 'success',
    });

    return agentId;
  },
});

/**
 * Replace a project agent's writable fields wholesale — the edit dialog
 * always submits the full shape (CRUD, not per-field modes).
 */
export const updateProjectAgent = mutation({
  args: {
    agentId: v.id('projectAgents'),
    name: v.string(),
    harness: v.string(),
    model: v.string(),
    modelProvider: v.optional(v.string()),
    skills: v.array(v.string()),
    connectors: v.array(v.string()),
    tools: v.optional(v.array(v.string())),
    secrets: v.optional(v.array(v.string())),
    instructions: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const agent = await ctx.db.get(args.agentId);
    if (!agent) {
      throw new ConvexError({ code: 'PROJECT_AGENT_NOT_FOUND' });
    }
    const project = await loadProjectOrThrow(ctx, agent.projectId);
    const auth = await getAuthContext(ctx, project.organizationId);
    assertWritable(project, auth);

    const fields = validateProjectAgentFields(args);
    // Gate on the SUBMITTED intent vs the stored set, BEFORE pruning: an editor
    // re-saving an agent whose secret was deleted org-side (the dialog still
    // lists it, prune will drop it) must not be falsely blocked — that is a
    // reconcile, not an intent change. A real add/remove IS gated.
    assertMaySetSecrets(auth, fields.secrets, agent.secrets ?? []);
    fields.secrets = await pruneMissingSecrets(
      ctx,
      project.organizationId,
      fields.secrets,
    );
    if (
      await projectAgentNameTaken(
        ctx,
        agent.projectId,
        fields.name,
        args.agentId,
      )
    ) {
      throw new ConvexError({ code: 'PROJECT_AGENT_NAME_TAKEN' });
    }

    const now = Date.now();
    await ctx.db.replace(args.agentId, {
      organizationId: agent.organizationId,
      projectId: agent.projectId,
      name: fields.name,
      harness: fields.harness,
      model: fields.model,
      ...(fields.modelProvider !== undefined
        ? { modelProvider: fields.modelProvider }
        : {}),
      skills: fields.skills,
      connectors: fields.connectors,
      ...(fields.tools.length > 0 ? { tools: fields.tools } : {}),
      ...(fields.secrets.length > 0 ? { secrets: fields.secrets } : {}),
      ...(fields.instructions !== undefined
        ? { instructions: fields.instructions }
        : {}),
      createdBy: agent.createdBy,
      createdAt: agent.createdAt,
      updatedAt: now,
    });
    await ctx.db.patch(agent.projectId, { updatedAt: now });

    const previous = auditProjectAgentState({
      name: agent.name,
      harness: agent.harness,
      model: agent.model ?? '',
      modelProvider: agent.modelProvider,
      skills: agent.skills,
      connectors: agent.connectors,
      tools: agent.tools ?? [],
      secrets: agent.secrets ?? [],
      instructions: agent.instructions,
    });
    const next = auditProjectAgentState(fields);
    await createAuditLog(ctx, {
      organizationId: project.organizationId,
      actorId: auth.userId,
      actorEmail: auth.email,
      actorType: 'user',
      action: PROJECT_AUDIT_ACTIONS.agentsChanged,
      category: 'data',
      resourceType: PROJECT_RESOURCE_TYPE,
      resourceId: String(agent.projectId),
      resourceName: project.name,
      previousState: previous,
      newState: next,
      changedFields: diff(previous, next),
      metadata: { op: 'update', projectAgentId: String(args.agentId) },
      status: 'success',
    });

    return null;
  },
});

/**
 * Delete a project agent. Tasks that referenced it keep their assignee id
 * and resolve it as a historical actor (raw id fallback) — deletion never
 * rewrites task history.
 */
export const deleteProjectAgent = mutation({
  args: { agentId: v.id('projectAgents') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const agent = await ctx.db.get(args.agentId);
    if (!agent) {
      throw new ConvexError({ code: 'PROJECT_AGENT_NOT_FOUND' });
    }
    const project = await loadProjectOrThrow(ctx, agent.projectId);
    const auth = await getAuthContext(ctx, project.organizationId);
    assertWritable(project, auth);

    await ctx.db.delete(args.agentId);
    await ctx.db.patch(agent.projectId, {
      updatedAt: Date.now(),
      // Clamped like every other counter decrement so drift self-heals.
      projectAgentCount: Math.max(0, (project.projectAgentCount ?? 0) - 1),
    });

    await createAuditLog(ctx, {
      organizationId: project.organizationId,
      actorId: auth.userId,
      actorEmail: auth.email,
      actorType: 'user',
      action: PROJECT_AUDIT_ACTIONS.agentsChanged,
      category: 'data',
      resourceType: PROJECT_RESOURCE_TYPE,
      resourceId: String(agent.projectId),
      resourceName: project.name,
      previousState: auditProjectAgentState({
        name: agent.name,
        harness: agent.harness,
        model: agent.model ?? '',
        modelProvider: agent.modelProvider,
        skills: agent.skills,
        connectors: agent.connectors,
        tools: agent.tools ?? [],
        secrets: agent.secrets ?? [],
        instructions: agent.instructions,
      }),
      metadata: { op: 'delete', projectAgentId: String(args.agentId) },
      status: 'success',
    });

    return null;
  },
});

// ---------------------------------------------------------------------------
// Model settings
// ---------------------------------------------------------------------------

export const updateProjectModelSettings = mutation({
  args: {
    projectId: v.id('projects'),
    modelMode: projectModeValidator,
    recommendedModels: v.optional(v.array(v.string())),
    allowedModels: v.optional(v.array(v.string())),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const project = await loadProjectOrThrow(ctx, args.projectId);
    const auth = await getAuthContext(ctx, project.organizationId);
    assertWritable(project, auth);

    const previousState = {
      modelMode: project.modelMode ?? 'all',
      recommendedModels: project.recommendedModels ?? [],
      allowedModels: project.allowedModels ?? [],
    };
    const newState = {
      modelMode: args.modelMode,
      recommendedModels: args.recommendedModels ?? [],
      allowedModels: args.allowedModels ?? [],
    };

    // H3: recommended must be a subset of allowed in restricted mode.
    validateRecommendedSubsetOfAllowed(
      args.modelMode,
      newState.recommendedModels,
      newState.allowedModels,
    );

    await ctx.db.patch(args.projectId, {
      modelMode: args.modelMode,
      recommendedModels:
        newState.recommendedModels.length > 0
          ? newState.recommendedModels
          : undefined,
      allowedModels:
        newState.allowedModels.length > 0 ? newState.allowedModels : undefined,
      updatedAt: Date.now(),
    });

    // H8: log slug diffs explicitly alongside previous/new state.
    const recommendedDiff = arrayDiff(
      previousState.recommendedModels,
      newState.recommendedModels,
    );
    const allowedDiff = arrayDiff(
      previousState.allowedModels,
      newState.allowedModels,
    );

    await createAuditLog(ctx, {
      organizationId: project.organizationId,
      actorId: auth.userId,
      actorEmail: auth.email,
      actorType: 'user',
      action: PROJECT_AUDIT_ACTIONS.modelsChanged,
      category: 'data',
      resourceType: PROJECT_RESOURCE_TYPE,
      resourceId: String(args.projectId),
      resourceName: project.name,
      previousState,
      newState,
      changedFields: diff(previousState, newState),
      metadata: {
        recommendedAdded: recommendedDiff.added,
        recommendedRemoved: recommendedDiff.removed,
        allowedAdded: allowedDiff.added,
        allowedRemoved: allowedDiff.removed,
      },
      status: 'success',
    });

    return null;
  },
});

// ---------------------------------------------------------------------------
// Connector settings (schema only in v1; mutation works for future UI)
// ---------------------------------------------------------------------------

export const updateProjectConnectorSettings = mutation({
  args: {
    projectId: v.id('projects'),
    connectorsMode: projectConnectorsModeValidator,
    allowedConnectorSlugs: v.optional(v.array(v.string())),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const project = await loadProjectOrThrow(ctx, args.projectId);
    const auth = await getAuthContext(ctx, project.organizationId);
    assertWritable(project, auth);

    const previousState = {
      connectorsMode: project.connectorsMode ?? 'all',
      allowedConnectorSlugs: project.allowedConnectorSlugs ?? [],
    };
    const newState = {
      connectorsMode: args.connectorsMode,
      allowedConnectorSlugs: args.allowedConnectorSlugs ?? [],
    };

    await ctx.db.patch(args.projectId, {
      connectorsMode: args.connectorsMode,
      allowedConnectorSlugs:
        newState.allowedConnectorSlugs.length > 0
          ? newState.allowedConnectorSlugs
          : undefined,
      updatedAt: Date.now(),
    });

    // H8: log slug diffs explicitly alongside previous/new state.
    const allowedDiff = arrayDiff(
      previousState.allowedConnectorSlugs,
      newState.allowedConnectorSlugs,
    );

    await createAuditLog(ctx, {
      organizationId: project.organizationId,
      actorId: auth.userId,
      actorEmail: auth.email,
      actorType: 'user',
      action: PROJECT_AUDIT_ACTIONS.connectorsChanged,
      category: 'data',
      resourceType: PROJECT_RESOURCE_TYPE,
      resourceId: String(args.projectId),
      resourceName: project.name,
      previousState,
      newState,
      changedFields: diff(previousState, newState),
      metadata: {
        allowedAdded: allowedDiff.added,
        allowedRemoved: allowedDiff.removed,
      },
      status: 'success',
    });

    return null;
  },
});

// ---------------------------------------------------------------------------
// Files: attach / detach
// ---------------------------------------------------------------------------

export const attachDocumentToProject = mutation({
  args: {
    documentId: v.id('documents'),
    projectId: v.id('projects'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const project = await loadProjectOrThrow(ctx, args.projectId);
    const auth = await getAuthContext(ctx, project.organizationId);
    assertWritable(project, auth);

    const doc = await ctx.db.get(args.documentId);
    if (!doc) throw new ConvexError({ code: 'DOCUMENT_NOT_FOUND' });
    if (doc.organizationId !== project.organizationId) {
      throw new ConvexError({ code: 'ORG_FORBIDDEN' });
    }

    const previousTeamId = doc.teamId ?? null;

    // H7: Convex mutations are serializable single-transaction OCC — the
    // read at L759 + patch below execute atomically against a consistent
    // snapshot, with automatic retry on conflict. The read-then-patch
    // sequence here cannot violate the projectId/teamId mutual-exclusivity
    // invariant under concurrent writers; the loser's transaction retries
    // and sees the winner's state.
    //
    // Mutual exclusivity: a document carries `teamId` OR `projectId`, never
    // both. If the document is already in a team library we throw rather
    // than silently moving it — the UI shows DOCUMENT_SCOPE_CONFLICT
    // and prompts the user to detach it first. Idempotent: re-attaching
    // to the same project is a no-op.
    if (doc.projectId === args.projectId) {
      return null;
    }
    if (doc.teamId) {
      throw new ConvexError({ code: 'DOCUMENT_SCOPE_CONFLICT' });
    }
    // A hub folder is as much a hub scope as a team: attaching would leave
    // the doc referencing a folder its project peers cannot see (and folder
    // cascades would cross scopes). Same remedy the teamId conflict shows —
    // take it out of the hub library first.
    if (doc.folderId) {
      throw new ConvexError({ code: 'DOCUMENT_SCOPE_CONFLICT' });
    }

    await ctx.db.patch(args.documentId, {
      projectId: args.projectId,
    });
    await ctx.db.patch(args.projectId, { updatedAt: Date.now() });

    // Attaching is a SCOPE change: the corpus row must carry the projectId or
    // retrieval keeps serving the file org-wide. Scope-only sync, no re-embed.
    if (doc.fileId) {
      await ctx.scheduler.runAfter(
        0,
        internal.documents.internal_actions.syncRagDocumentScopes,
        {
          organizationId: project.organizationId,
          documentIds: [args.documentId],
        },
      );
    }

    await createAuditLog(ctx, {
      organizationId: project.organizationId,
      actorId: auth.userId,
      actorEmail: auth.email,
      actorType: 'user',
      action: PROJECT_AUDIT_ACTIONS.fileAttached,
      category: 'data',
      resourceType: PROJECT_RESOURCE_TYPE,
      resourceId: String(args.projectId),
      resourceName: project.name,
      metadata: {
        documentId: String(args.documentId),
        previousTeamId,
      },
      status: 'success',
    });

    return null;
  },
});

export const detachDocumentFromProject = mutation({
  args: {
    documentId: v.id('documents'),
    /**
     * Where the file lands once the project gate is removed. Detach cannot
     * restore a team scope (attach requires `teamId` empty), so the document
     * becomes org-wide — the caller must say so explicitly instead of the
     * doc being published silently (issue #2546). Widen to a union if team
     * destinations or delete-on-detach are added.
     */
    destination: v.literal('organization'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const doc = await ctx.db.get(args.documentId);
    if (!doc) throw new ConvexError({ code: 'DOCUMENT_NOT_FOUND' });
    if (!doc.projectId) return null;

    const project = await ctx.db.get(doc.projectId);
    if (!project) {
      // Stale link; just clear. Project folders are invalid in the hub, so
      // the folder link goes with the project link.
      await ctx.db.patch(args.documentId, {
        projectId: undefined,
        folderId: undefined,
        folderPath: undefined,
      });
      // The corpus row still carries the dangling project scope — clear it so
      // retrieval treats the doc as the org-wide file it just became.
      if (doc.fileId) {
        await ctx.scheduler.runAfter(
          0,
          internal.documents.internal_actions.syncRagDocumentScopes,
          {
            organizationId: doc.organizationId,
            documentIds: [args.documentId],
          },
        );
      }
      return null;
    }

    const auth = await getAuthContext(ctx, project.organizationId);
    assertWritable(project, auth);

    // Clear the folder alongside the project: the folder (if any) is a
    // project folder, which is not a hub row — a detached doc keeping it
    // would point hub surfaces at an invisible folder and re-enter the
    // folder's cascade delete from outside the project.
    await ctx.db.patch(args.documentId, {
      projectId: undefined,
      folderId: undefined,
      folderPath: undefined,
    });
    await ctx.db.patch(project._id, { updatedAt: Date.now() });

    // RAG keeps a denormalized folder_path for folder-scoped search; the
    // detach cleared folderPath without re-uploading, so sync it explicitly
    // (the update_document_internal folder-move pattern).
    const detachedFileId = doc.fileId;
    if (doc.folderId && detachedFileId) {
      const fm = await ctx.db
        .query('fileMetadata')
        .withIndex('by_storageId', (q) => q.eq('storageId', detachedFileId))
        .first();
      if (fm?.ragStatus === 'completed') {
        await ctx.scheduler.runAfter(
          0,
          internal.documents.internal_actions.syncRagFolderPaths,
          {
            organizationId: project.organizationId,
            updates: [{ fileId: detachedFileId, folderPath: undefined }],
          },
        );
      }
    }

    // Detaching is a SCOPE change: the document became org-wide, so the
    // corpus row's project_id must clear or retrieval keeps gating it to the
    // project it just left. Scope-only sync, no re-embed.
    if (detachedFileId) {
      await ctx.scheduler.runAfter(
        0,
        internal.documents.internal_actions.syncRagDocumentScopes,
        {
          organizationId: project.organizationId,
          documentIds: [args.documentId],
        },
      );
    }

    await createAuditLog(ctx, {
      organizationId: project.organizationId,
      actorId: auth.userId,
      actorEmail: auth.email,
      actorType: 'user',
      action: PROJECT_AUDIT_ACTIONS.fileDetached,
      category: 'data',
      resourceType: PROJECT_RESOURCE_TYPE,
      resourceId: String(project._id),
      resourceName: project.name,
      // Record the scope transition: the resource is the project the file
      // left; `destination` names where it became visible.
      metadata: {
        documentId: String(args.documentId),
        destination: args.destination,
      },
      status: 'success',
    });

    return null;
  },
});

// ---------------------------------------------------------------------------
// Threads: move / share
// ---------------------------------------------------------------------------

export const moveThreadToProject = mutation({
  args: {
    threadId: v.string(),
    projectId: v.union(v.id('projects'), v.null()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const thread = await ctx.db
      .query('threadMetadata')
      .withIndex('by_threadId', (q) => q.eq('threadId', args.threadId))
      .first();
    if (!thread) throw new ConvexError({ code: 'THREAD_NOT_FOUND' });

    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) throw new ConvexError({ code: 'UNAUTHENTICATED' });
    if (thread.userId !== authUser.userId) {
      throw new ConvexError({ code: 'THREAD_FORBIDDEN' });
    }

    const orgId = thread.organizationId;
    if (!orgId) {
      throw new ConvexError({ code: 'THREAD_NO_ORG' });
    }

    let previousProjectId: Id<'projects'> | null = null;
    if (thread.projectId) previousProjectId = thread.projectId;

    if (args.projectId === null) {
      // Moving between projects is a metadata edit, not chat activity — don't
      // bump `updatedAt`, or the sidebar would reorder the row and reset its
      // "Xm ago" label (which must track the last message only).
      await ctx.db.patch(thread._id, {
        projectId: undefined,
        sharedWithProject: undefined,
      });
    } else {
      const project = await loadProjectOrThrow(ctx, args.projectId);
      if (project.organizationId !== orgId) {
        throw new ConvexError({ code: 'ORG_FORBIDDEN' });
      }
      const auth = await getAuthContext(ctx, orgId);
      assertReadable(project, auth);

      await ctx.db.patch(thread._id, {
        projectId: args.projectId,
        // Default to personal-in-project — explicit share via setThreadSharedWithProject.
        sharedWithProject: false,
        // Metadata edit, not activity — leave `updatedAt` untouched (see above).
      });
    }

    const targetProjectIdForAudit = args.projectId ?? previousProjectId;
    if (targetProjectIdForAudit) {
      const auditProject = await ctx.db.get(targetProjectIdForAudit);
      if (auditProject) {
        await createAuditLog(ctx, {
          organizationId: orgId,
          actorId: thread.userId,
          actorEmail: authUser.email,
          actorType: 'user',
          action: PROJECT_AUDIT_ACTIONS.threadMoved,
          category: 'data',
          resourceType: PROJECT_RESOURCE_TYPE,
          resourceId: String(auditProject._id),
          resourceName: auditProject.name,
          metadata: {
            threadId: args.threadId,
            previousProjectId: previousProjectId
              ? String(previousProjectId)
              : null,
            newProjectId: args.projectId ? String(args.projectId) : null,
          },
          status: 'success',
        });
      }
    }

    return null;
  },
});

// ---------------------------------------------------------------------------
// Archive / restore
// ---------------------------------------------------------------------------

export const archiveProject = mutation({
  args: { projectId: v.id('projects') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const project = await loadProjectOrThrow(ctx, args.projectId);
    const auth = await getAuthContext(ctx, project.organizationId);
    assertReadable(project, auth);
    assertAdmin(auth);
    if (project.archivedAt) return null;

    await ctx.db.patch(args.projectId, {
      archivedAt: Date.now(),
      updatedAt: Date.now(),
    });

    await createAuditLog(ctx, {
      organizationId: project.organizationId,
      actorId: auth.userId,
      actorEmail: auth.email,
      actorType: 'user',
      action: PROJECT_AUDIT_ACTIONS.archived,
      category: 'data',
      resourceType: PROJECT_RESOURCE_TYPE,
      resourceId: String(args.projectId),
      resourceName: project.name,
      status: 'success',
    });

    return null;
  },
});

export const restoreProject = mutation({
  args: { projectId: v.id('projects') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const project = await loadProjectOrThrow(ctx, args.projectId);
    const auth = await getAuthContext(ctx, project.organizationId);
    assertReadable(project, auth);
    assertAdmin(auth);
    if (!project.archivedAt) return null;

    await ctx.db.patch(args.projectId, {
      archivedAt: undefined,
      updatedAt: Date.now(),
    });

    await createAuditLog(ctx, {
      organizationId: project.organizationId,
      actorId: auth.userId,
      actorEmail: auth.email,
      actorType: 'user',
      action: PROJECT_AUDIT_ACTIONS.restored,
      category: 'data',
      resourceType: PROJECT_RESOURCE_TYPE,
      resourceId: String(args.projectId),
      resourceName: project.name,
      status: 'success',
    });

    return null;
  },
});

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

/**
 * An automation bound to the project blocks its delete — in BOTH modes: a
 * binding row must never dangle, and cascade silently dropping the last
 * binding would rescope the automation to org-wide (every project's task
 * board would suddenly see it). The error names the automations so the
 * operator knows what to unbind first (the automation page's Projects panel).
 */
export async function assertNoBoundAutomations(
  ctx: MutationCtx,
  projectId: Id<'projects'>,
): Promise<void> {
  const bindings = await ctx.db
    .query('automationProjectBindings')
    .withIndex('by_project', (q) => q.eq('projectId', projectId))
    .collect();
  if (bindings.length === 0) return;
  const automations = [
    ...new Set(bindings.map((row) => row.automationName)),
  ].sort();
  throw new ConvexError({
    code: 'PROJECT_HAS_BOUND_AUTOMATIONS',
    automations,
  });
}

/**
 * Delete a project.
 *
 * Two modes:
 *  - 'detach' (default): children survive with `projectId` cleared.
 *    Threads become personal chats; documents become library docs (RAG
 *    index preserved).
 *  - 'cascade': children destroyed. Requires `confirmPhrase === project.name`.
 *    Documents go through the standard document deletion path; threads
 *    owned by the caller are deleted, others' shared-with-project threads
 *    are detached.
 *
 * Both write a `project.deleted` audit row with counts.
 *
 * Legal hold note: assertNotHeld is not yet wired here — the platform's
 * legal-hold table doesn't currently model `'project'` resourceType.
 * Follow-up: extend `legalHolds.resourceType` validator to include 'project'.
 */
export const deleteProject = mutation({
  args: {
    projectId: v.id('projects'),
    mode: v.union(v.literal('detach'), v.literal('cascade')),
    confirmPhrase: v.optional(v.string()),
  },
  returns: v.object({
    detachedDocCount: v.number(),
    detachedThreadCount: v.number(),
    cascadedDocCount: v.number(),
    cascadedThreadCount: v.number(),
  }),
  handler: async (ctx, args) => {
    const project = await loadProjectOrThrow(ctx, args.projectId);
    const auth = await getAuthContext(ctx, project.organizationId);
    assertReadable(project, auth);
    assertAdmin(auth);

    await assertNoBoundAutomations(ctx, args.projectId);

    if (args.mode === 'cascade') {
      // H1: case-insensitive compare so "Q2 Sales" vs stored "Q2 sales"
      // doesn't reject right before a destructive op.
      const expected = project.name.trim();
      const actual = (args.confirmPhrase ?? '').trim();
      if (
        actual.length === 0 ||
        expected.localeCompare(actual, undefined, { sensitivity: 'base' }) !== 0
      ) {
        throw new ConvexError({ code: 'PROJECT_CONFIRM_PHRASE_MISMATCH' });
      }

      // §6: rate-limit cascade deletes. They touch every doc + thread,
      // so a runaway loop is expensive. 5/min/user (token bucket).
      try {
        await checkUserRateLimit(ctx, 'project:delete-cascade', auth.userId);
      } catch (error) {
        mapRateLimitError(error);
      }
    }

    let detachedDocCount = 0;
    let detachedThreadCount = 0;
    let cascadedDocCount = 0;
    let cascadedThreadCount = 0;

    // ---- Documents ----
    const docsQuery = ctx.db
      .query('documents')
      .withIndex('by_organizationId_and_projectId', (q) =>
        q
          .eq('organizationId', project.organizationId)
          .eq('projectId', args.projectId),
      );

    for await (const doc of docsQuery) {
      if (args.mode === 'cascade') {
        // Mark for deletion via lifecycle status; the existing retention
        // pipeline will hard-delete blob + RAG chunks within the grace
        // window. Inline blob deletion is out of scope for this mutation.
        await ctx.db.patch(doc._id, {
          lifecycleStatus: 'expired',
          statusChangedAt: Date.now(),
          projectId: undefined,
        });
        cascadedDocCount++;
      } else {
        await ctx.db.patch(doc._id, { projectId: undefined });
        detachedDocCount++;
      }
    }

    // ---- Threads ----
    const threadsQuery = ctx.db
      .query('threadMetadata')
      .withIndex('by_organizationId_and_projectId', (q) =>
        q
          .eq('organizationId', project.organizationId)
          .eq('projectId', args.projectId),
      );

    for await (const thread of threadsQuery) {
      if (args.mode === 'cascade' && thread.userId === auth.userId) {
        // Caller owns the thread → soft-delete via lifecycle.
        await ctx.db.patch(thread._id, {
          status: 'trashed',
          statusChangedAt: Date.now(),
          projectId: undefined,
          sharedWithProject: undefined,
        });
        cascadedThreadCount++;
      } else {
        // Detach: thread survives.
        await ctx.db.patch(thread._id, {
          projectId: undefined,
          sharedWithProject: undefined,
        });
        detachedThreadCount++;
      }
    }

    await ctx.db.delete(args.projectId);

    await createAuditLog(ctx, {
      organizationId: project.organizationId,
      actorId: auth.userId,
      actorEmail: auth.email,
      actorType: 'user',
      action: PROJECT_AUDIT_ACTIONS.deleted,
      category: 'data',
      resourceType: PROJECT_RESOURCE_TYPE,
      resourceId: String(args.projectId),
      resourceName: project.name,
      metadata: {
        mode: args.mode,
        detachedDocCount,
        detachedThreadCount,
        cascadedDocCount,
        cascadedThreadCount,
      },
      status: 'success',
    });

    return {
      detachedDocCount,
      detachedThreadCount,
      cascadedDocCount,
      cascadedThreadCount,
    };
  },
});

// ---------------------------------------------------------------------------
// Duplicate (U1)
// ---------------------------------------------------------------------------

/**
 * Duplicate a project: copies identity (with " (copy)" suffix), instructions,
 * knowledge mode, agent/model/connector mode + lists, and sharing config.
 *
 * Does NOT copy:
 *   - files (separate sharing semantics; user must explicitly attach)
 *   - threads (per-user; chats are owner-bound)
 *   - archivedAt (always lands as a fresh project)
 *   - externalItemId (org-unique caller-owned key; a copy must not claim it)
 *
 * Audit log emits `project.created` with `metadata.duplicatedFrom` so the
 * provenance chain stays queryable.
 */
export const duplicateProject = mutation({
  args: {
    projectId: v.id('projects'),
    name: v.optional(v.string()),
  },
  returns: v.id('projects'),
  handler: async (ctx, args) => {
    const source = await loadProjectOrThrow(ctx, args.projectId);
    const auth = await getAuthContext(ctx, source.organizationId);
    assertReadable(source, auth);

    // Editor+ in the org can duplicate (matches createProject).
    if (auth.role === 'member' || auth.role === 'disabled' || !auth.role) {
      throw new ConvexError({ code: 'RBAC_FORBIDDEN' });
    }

    // §6: same rate limit bucket as createProject — duplication is a
    // create in spirit and the storage cost is the same.
    try {
      await checkUserRateLimit(ctx, 'project:create', auth.userId);
    } catch (error) {
      mapRateLimitError(error);
    }

    // Derive the new name. If caller provides one, validate it; otherwise
    // append " (copy)" suffix, truncating from the source name if needed.
    let nextName: string;
    if (args.name !== undefined) {
      nextName = validateName(args.name);
    } else {
      const suffix = ' (copy)';
      const room = PROJECT_NAME_MAX - suffix.length;
      const base =
        source.name.length > room ? source.name.slice(0, room) : source.name;
      nextName = `${base}${suffix}`;
    }

    const key = await resolveDuplicateProjectKey(
      ctx,
      source.organizationId,
      nextName,
    );

    const now = Date.now();
    // Deliberately no externalItemId: the org-unique external key must not be cloned.
    const newProjectId = await ctx.db.insert('projects', {
      organizationId: source.organizationId,
      name: nextName,
      key,
      taskCounter: 0,
      // A duplicate copies neither tasks nor agents, so zeros are correct —
      // never carry the source project's counts across.
      openTaskCount: 0,
      doneTaskCount: 0,
      projectAgentCount: 0,
      description: source.description,
      icon: source.icon,
      color: source.color,
      teamId: source.teamId,
      sharedWithTeamIds: source.sharedWithTeamIds,
      instructions: source.instructions,
      knowledgeMode: source.knowledgeMode,
      agentMode: source.agentMode,
      recommendedAgentSlugs: source.recommendedAgentSlugs,
      allowedAgentSlugs: source.allowedAgentSlugs,
      modelMode: source.modelMode,
      recommendedModels: source.recommendedModels,
      allowedModels: source.allowedModels,
      connectorsMode: source.connectorsMode,
      allowedConnectorSlugs: source.allowedConnectorSlugs,
      createdBy: auth.userId,
      createdAt: now,
      updatedAt: now,
    });

    await createAuditLog(ctx, {
      organizationId: source.organizationId,
      actorId: auth.userId,
      actorEmail: auth.email,
      actorType: 'user',
      action: PROJECT_AUDIT_ACTIONS.created,
      category: 'data',
      resourceType: PROJECT_RESOURCE_TYPE,
      resourceId: String(newProjectId),
      resourceName: nextName,
      newState: {
        name: nextName,
        teamId: source.teamId ?? null,
        sharedWithTeamIds: source.sharedWithTeamIds ?? [],
      },
      metadata: {
        isOrgWide: isOrgWideProject(source),
        duplicatedFrom: String(args.projectId),
      },
      status: 'success',
    });

    await ensureDefaultProjectLabels(ctx, {
      organizationId: source.organizationId,
      projectId: newProjectId,
      createdBy: auth.userId,
    });

    return newProjectId;
  },
});
