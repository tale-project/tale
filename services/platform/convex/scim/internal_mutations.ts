import { v } from 'convex/values';

import { AppError } from '../../lib/shared/errors/app-error';
import { getString, isRecord } from '../../lib/utils/type-utils';
import { components } from '../_generated/api';
import { internalMutation, type MutationCtx } from '../_generated/server';
import * as AuditLogHelpers from '../audit_logs/helpers';
import { platformRoleValidator } from '../enterprise_sso/validators';
import { normalizeAuthEmail } from '../lib/auth/normalize_auth_email';
import {
  deleteMemberMirrorByMemberId,
  deleteTeamMemberMirrorByTeamMemberId,
  upsertMemberMirror,
  upsertTeamMemberMirror,
} from '../members/mirror_sync';
import type { BetterAuthMember } from '../members/types';
import {
  findMember,
  findTeamById,
  findUserByEmail,
  findUserById,
  listTeamMembers,
  listUserMemberships,
} from './data';
import { deleteLink, getLink, upsertLink } from './links';
import type { ScimGroupRecord, ScimUserRecord } from './types';

const userRecordValidator = v.object({
  userId: v.string(),
  email: v.string(),
  name: v.string(),
  active: v.boolean(),
  externalId: v.optional(v.string()),
  createdAt: v.optional(v.number()),
  updatedAt: v.optional(v.number()),
});

const groupRecordValidator = v.object({
  teamId: v.string(),
  displayName: v.string(),
  memberUserIds: v.array(v.string()),
  externalId: v.optional(v.string()),
  createdAt: v.optional(v.number()),
  updatedAt: v.optional(v.number()),
});

function extractId(created: unknown): string {
  if (isRecord(created)) {
    const id = getString(created, '_id') ?? getString(created, 'id');
    if (id) return id;
  }
  return String(created);
}

function scimAuditActor() {
  return { id: 'scim', type: 'api' as const };
}

async function logScim(
  ctx: MutationCtx,
  organizationId: string,
  action: string,
  resourceType: string,
  resourceId: string,
  resourceName: string,
  states?: {
    previous?: Record<string, unknown>;
    next?: Record<string, unknown>;
  },
): Promise<void> {
  await AuditLogHelpers.logSuccess(ctx, {
    auditCtx: { organizationId, actor: scimAuditActor() },
    action,
    category: 'member',
    resourceType,
    resourceId,
    resourceName,
    previousState: states?.previous,
    newState: states?.next,
  });
}

// ---------------------------------------------------------------------------
// Better Auth write helpers
// ---------------------------------------------------------------------------

async function updateMember(
  ctx: MutationCtx,
  memberId: string,
  role: string,
): Promise<void> {
  await ctx.runMutation(components.betterAuth.adapter.updateMany, {
    input: {
      model: 'member',
      where: [{ field: '_id', value: memberId, operator: 'eq' }],
      update: { role },
    },
    paginationOpts: { cursor: null, numItems: 1 },
  });
}

async function addTeamMemberRow(
  ctx: MutationCtx,
  teamId: string,
  userId: string,
): Promise<void> {
  const createdAt = Date.now();
  const created = await ctx.runMutation(components.betterAuth.adapter.create, {
    input: { model: 'teamMember', data: { teamId, userId, createdAt } },
  });
  const teamMemberId = extractId(created);
  await upsertTeamMemberMirror(ctx, {
    teamMemberId,
    userId,
    teamId,
    createdAt,
  });
}

async function removeTeamMemberRow(
  ctx: MutationCtx,
  teamMemberId: string,
): Promise<void> {
  await ctx.runMutation(components.betterAuth.adapter.deleteOne, {
    input: {
      model: 'teamMember',
      where: [{ field: '_id', value: teamMemberId, operator: 'eq' }],
    },
  });
  await deleteTeamMemberMirrorByTeamMemberId(ctx, teamMemberId);
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

interface ActivationPlan {
  role: string;
  /** Role to persist as the restore point for a future reactivation. */
  restoreRole: string;
}

/**
 * Decide the member role for an `active` flag without clobbering a role an
 * admin set manually: an already-active member keeps its role; a reactivated
 * member is restored to its last active role (or the default).
 */
export function planActivation(
  active: boolean,
  currentRole: string | undefined,
  defaultRole: string,
  lastActiveRole: string | undefined,
): ActivationPlan {
  const current = (currentRole ?? '').toLowerCase();
  if (!active) {
    const restore =
      current && current !== 'disabled'
        ? current
        : (lastActiveRole ?? defaultRole);
    return { role: 'disabled', restoreRole: restore };
  }
  if (!current || current === 'disabled') {
    const role = lastActiveRole ?? defaultRole;
    return { role, restoreRole: role };
  }
  return { role: current, restoreRole: current };
}

/**
 * Classify how a SCIM create may touch a user already matched globally by
 * email, given that user's full membership set and the token's org. A SCIM
 * token must never graft a membership onto, or rename, an account another
 * tenant owns — `owned-elsewhere` is rejected by the create path (#2036).
 */
export function classifyUserOwnership(
  memberships: readonly { organizationId: string }[],
  organizationId: string,
): 'owned-here' | 'unowned' | 'owned-elsewhere' {
  if (memberships.some((m) => m.organizationId === organizationId)) {
    return 'owned-here';
  }
  return memberships.length > 0 ? 'owned-elsewhere' : 'unowned';
}

/**
 * Decide how an HTTP DELETE resolves for a SCIM User, from the caller's
 * membership in the token's org: a missing membership is a 404; the org owner
 * is protected (removing it would orphan the org); anything else is removed.
 */
export function classifyDeprovision(
  member: { role?: string } | undefined,
): 'not-found' | 'owner-protected' | 'deprovision' {
  if (!member) return 'not-found';
  if ((member.role ?? '').toLowerCase() === 'owner') return 'owner-protected';
  return 'deprovision';
}

/**
 * Compose a SCIM Group membership PATCH into the final desired user-id set: a
 * clear-all / replace base, then adds, then removes. Keeps an `add` paired with
 * a value-less `remove members` from being silently dropped (#2085[13]).
 */
export function composeDesiredMembers(
  replaceMembers: readonly string[],
  addMembers: readonly string[],
  removeMembers: readonly string[],
): string[] {
  const desired = new Set(replaceMembers);
  for (const id of addMembers) desired.add(id);
  for (const id of removeMembers) desired.delete(id);
  return [...desired];
}

/**
 * Create-or-upsert a user + org membership from a SCIM User resource.
 * Idempotent on `(org, email)` — used by both POST (create) and PUT (replace).
 */
export const provisionUser = internalMutation({
  args: {
    organizationId: v.string(),
    defaultRole: platformRoleValidator,
    email: v.string(),
    name: v.string(),
    externalId: v.optional(v.string()),
    active: v.boolean(),
  },
  returns: userRecordValidator,
  handler: async (ctx, args): Promise<ScimUserRecord> => {
    const email = normalizeAuthEmail(args.email);
    const now = Date.now();
    const existingUser = await findUserByEmail(ctx, email);

    let userId: string;
    let memberHere: BetterAuthMember | undefined;
    if (existingUser) {
      // A SCIM token is scoped to its own tenant. If the email already maps to
      // a global user owned by ANOTHER org, refuse to reuse it — never graft a
      // membership onto, or rename, an account this org does not own (#2036).
      // The `scim_user_conflict` code is mapped to a 409 by the HTTP layer.
      const memberships = await listUserMemberships(ctx, existingUser._id);
      if (
        classifyUserOwnership(memberships, args.organizationId) ===
        'owned-elsewhere'
      ) {
        throw new AppError({
          code: 'scim_user_conflict',
          message: `User ${args.email} belongs to another organization`,
        });
      }
      memberHere = memberships.find(
        (m) => m.organizationId === args.organizationId,
      );
      userId = existingUser._id;
      // Only rename when this org already owns the membership — a SCIM token
      // must not rewrite the global user row of an account it does not own.
      if (memberHere && args.name && existingUser.name !== args.name) {
        await ctx.runMutation(components.betterAuth.adapter.updateMany, {
          input: {
            model: 'user',
            where: [{ field: '_id', value: userId, operator: 'eq' }],
            update: { name: args.name, updatedAt: now },
          },
          paginationOpts: { cursor: null, numItems: 1 },
        });
      }
    } else {
      const created = await ctx.runMutation(
        components.betterAuth.adapter.create,
        {
          input: {
            model: 'user',
            data: {
              email,
              name: args.name,
              emailVerified: true,
              createdAt: now,
              updatedAt: now,
            },
          },
        },
      );
      userId = extractId(created);
    }

    const link = await getLink(ctx, args.organizationId, userId);
    const member = memberHere;
    const plan = planActivation(
      args.active,
      member?.role,
      args.defaultRole,
      link?.lastActiveRole,
    );

    if (!member) {
      const created = await ctx.runMutation(
        components.betterAuth.adapter.create,
        {
          input: {
            model: 'member',
            data: {
              organizationId: args.organizationId,
              userId,
              role: plan.role,
              createdAt: now,
            },
          },
        },
      );
      await upsertMemberMirror(ctx, {
        memberId: extractId(created),
        userId,
        organizationId: args.organizationId,
        role: plan.role,
        createdAt: now,
      });
    } else if ((member.role ?? '').toLowerCase() !== plan.role) {
      await updateMember(ctx, member._id, plan.role);
      await upsertMemberMirror(ctx, {
        memberId: member._id,
        userId,
        organizationId: args.organizationId,
        role: plan.role,
        createdAt: member.createdAt,
      });
    }

    await upsertLink(ctx, {
      organizationId: args.organizationId,
      resourceType: 'User',
      internalId: userId,
      externalId: args.externalId,
      lastActiveRole: plan.restoreRole,
    });

    await logScim(
      ctx,
      args.organizationId,
      'scim_provision_user',
      'member',
      userId,
      email,
      { next: { role: plan.role, active: args.active } },
    );

    return {
      userId,
      email,
      name: args.name,
      active: args.active,
      externalId: args.externalId,
    };
  },
});

/**
 * Apply a SCIM User PATCH (active toggle + optional name/email). A SCIM
 * `active: false` — the IdP's primary de-provisioning signal — soft-deactivates:
 * the membership is KEPT with role `disabled` so a later `active: true` restores
 * the prior role. (A hard `DELETE` is the separate `deprovisionUser` path.)
 * Returns null if the user is not a member of the org.
 */
export const patchUser = internalMutation({
  args: {
    organizationId: v.string(),
    userId: v.string(),
    defaultRole: platformRoleValidator,
    active: v.optional(v.boolean()),
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    externalId: v.optional(v.string()),
  },
  returns: v.union(userRecordValidator, v.null()),
  handler: async (ctx, args): Promise<ScimUserRecord | null> => {
    const member = await findMember(ctx, args.organizationId, args.userId);
    if (!member) return null;
    const now = Date.now();

    if (args.externalId !== undefined) {
      await upsertLink(ctx, {
        organizationId: args.organizationId,
        resourceType: 'User',
        internalId: args.userId,
        externalId: args.externalId,
      });
    }

    // Name / email attribute updates on the user row.
    const userUpdate: Record<string, unknown> = {};
    if (args.name !== undefined) userUpdate.name = args.name;
    if (args.email !== undefined)
      userUpdate.email = normalizeAuthEmail(args.email);
    if (Object.keys(userUpdate).length > 0) {
      userUpdate.updatedAt = now;
      await ctx.runMutation(components.betterAuth.adapter.updateMany, {
        input: {
          model: 'user',
          where: [{ field: '_id', value: args.userId, operator: 'eq' }],
          update: userUpdate,
        },
        paginationOpts: { cursor: null, numItems: 1 },
      });
    }

    let role = (member.role ?? '').toLowerCase();
    if (args.active !== undefined) {
      const link = await getLink(ctx, args.organizationId, args.userId);
      const plan = planActivation(
        args.active,
        member.role,
        args.defaultRole,
        link?.lastActiveRole,
      );
      if (plan.role !== role) {
        await updateMember(ctx, member._id, plan.role);
        await upsertMemberMirror(ctx, {
          memberId: member._id,
          userId: args.userId,
          organizationId: args.organizationId,
          role: plan.role,
          createdAt: member.createdAt,
        });
        role = plan.role;
      }
      await upsertLink(ctx, {
        organizationId: args.organizationId,
        resourceType: 'User',
        internalId: args.userId,
        lastActiveRole: plan.restoreRole,
      });
      await logScim(
        ctx,
        args.organizationId,
        args.active ? 'scim_activate_user' : 'scim_deactivate_user',
        'member',
        args.userId,
        args.email ?? args.userId,
        { next: { role } },
      );
    }

    const active = role !== 'disabled';
    return {
      userId: args.userId,
      email: args.email ?? '',
      name: args.name ?? '',
      active,
    };
  },
});

/**
 * Hard de-provision a SCIM User (HTTP DELETE): drop the org membership, its
 * mirror, and the provisioning link, so the resource is gone from this tenant's
 * SCIM view — a subsequent GET/PATCH returns 404, per RFC 7644 §3.6 ("the
 * resource ... MUST NOT be returned"). This is the symmetric counterpart to
 * `deleteGroup`. The global Better Auth `user` row is intentionally preserved
 * (the person may belong to other orgs, and Tale never lets a SCIM token mutate
 * an account it doesn't own — #2036).
 *
 * This is DISTINCT from a SCIM `active: false`, which `patchUser`
 * soft-deactivates (membership kept, restorable) — the IdP's usual
 * de-provisioning signal. The sole owner is never removed: deleting it would
 * orphan the org, so that case is reported as `owner-protected` (HTTP 403).
 */
export const deprovisionUser = internalMutation({
  args: { organizationId: v.string(), userId: v.string() },
  returns: v.union(
    v.literal('deprovisioned'),
    v.literal('not-found'),
    v.literal('owner-protected'),
  ),
  handler: async (ctx, args) => {
    const member = await findMember(ctx, args.organizationId, args.userId);
    const verdict = classifyDeprovision(member);
    if (verdict === 'not-found' || verdict === 'owner-protected')
      return verdict;
    // `verdict === 'deprovision'` implies a member exists; re-assert it so the
    // type narrows (classifyDeprovision already guaranteed it at runtime).
    if (!member) return 'not-found';

    const user = await findUserById(ctx, args.userId);

    await ctx.runMutation(components.betterAuth.adapter.deleteOne, {
      input: {
        model: 'member',
        where: [{ field: '_id', value: member._id, operator: 'eq' }],
      },
    });
    await deleteMemberMirrorByMemberId(ctx, member._id);
    await deleteLink(ctx, args.organizationId, args.userId);

    await logScim(
      ctx,
      args.organizationId,
      'scim_deprovision_user',
      'member',
      args.userId,
      user?.email ?? args.userId,
      { previous: { role: member.role } },
    );
    return 'deprovisioned';
  },
});

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

async function setTeamMembers(
  ctx: MutationCtx,
  teamId: string,
  desiredUserIds: string[],
): Promise<void> {
  const current = await listTeamMembers(ctx, teamId);
  const currentIds = new Set(current.map((m) => m.userId));
  const desired = new Set(desiredUserIds);
  for (const userId of desired) {
    if (!currentIds.has(userId)) await addTeamMemberRow(ctx, teamId, userId);
  }
  for (const m of current) {
    if (!desired.has(m.userId)) await removeTeamMemberRow(ctx, m._id);
  }
}

function buildGroupReturn(
  teamId: string,
  displayName: string,
  memberUserIds: string[],
  externalId: string | undefined,
): ScimGroupRecord {
  return { teamId, displayName, memberUserIds, externalId };
}

/** Create a new team (Group) and set its members. Used by POST. */
export const provisionGroup = internalMutation({
  args: {
    organizationId: v.string(),
    displayName: v.string(),
    externalId: v.optional(v.string()),
    memberIds: v.array(v.string()),
  },
  returns: groupRecordValidator,
  handler: async (ctx, args): Promise<ScimGroupRecord> => {
    const now = Date.now();
    const created = await ctx.runMutation(
      components.betterAuth.adapter.create,
      {
        input: {
          model: 'team',
          data: {
            name: args.displayName,
            organizationId: args.organizationId,
            createdAt: now,
            updatedAt: now,
          },
        },
      },
    );
    const teamId = extractId(created);
    await setTeamMembers(ctx, teamId, args.memberIds);
    await upsertLink(ctx, {
      organizationId: args.organizationId,
      resourceType: 'Group',
      internalId: teamId,
      externalId: args.externalId,
    });
    await logScim(
      ctx,
      args.organizationId,
      'scim_provision_group',
      'team',
      teamId,
      args.displayName,
      { next: { members: args.memberIds.length } },
    );
    return buildGroupReturn(
      teamId,
      args.displayName,
      args.memberIds,
      args.externalId,
    );
  },
});

/** Replace a Group (rename + full membership set). Used by PUT. */
export const replaceGroup = internalMutation({
  args: {
    organizationId: v.string(),
    teamId: v.string(),
    displayName: v.string(),
    memberIds: v.array(v.string()),
    externalId: v.optional(v.string()),
  },
  returns: v.union(groupRecordValidator, v.null()),
  handler: async (ctx, args): Promise<ScimGroupRecord | null> => {
    const team = await findTeamById(ctx, args.teamId);
    if (!team || team.organizationId !== args.organizationId) return null;
    if (args.externalId !== undefined) {
      await upsertLink(ctx, {
        organizationId: args.organizationId,
        resourceType: 'Group',
        internalId: args.teamId,
        externalId: args.externalId,
      });
    }
    if (team.name !== args.displayName) {
      await ctx.runMutation(components.betterAuth.adapter.updateMany, {
        input: {
          model: 'team',
          where: [{ field: '_id', value: args.teamId, operator: 'eq' }],
          update: { name: args.displayName, updatedAt: Date.now() },
        },
        paginationOpts: { cursor: null, numItems: 1 },
      });
    }
    await setTeamMembers(ctx, args.teamId, args.memberIds);
    const link = await getLink(ctx, args.organizationId, args.teamId);
    await logScim(
      ctx,
      args.organizationId,
      'scim_replace_group',
      'team',
      args.teamId,
      args.displayName,
    );
    return buildGroupReturn(
      args.teamId,
      args.displayName,
      args.memberIds,
      link?.externalId,
    );
  },
});

/** Apply a SCIM Group PATCH (rename and/or add/remove/replace members). */
export const patchGroup = internalMutation({
  args: {
    organizationId: v.string(),
    teamId: v.string(),
    displayName: v.optional(v.string()),
    addMembers: v.array(v.string()),
    removeMembers: v.array(v.string()),
    replaceMembers: v.optional(v.array(v.string())),
  },
  returns: v.union(groupRecordValidator, v.null()),
  handler: async (ctx, args): Promise<ScimGroupRecord | null> => {
    const team = await findTeamById(ctx, args.teamId);
    if (!team || team.organizationId !== args.organizationId) return null;

    let displayName = team.name;
    if (args.displayName !== undefined && args.displayName !== team.name) {
      displayName = args.displayName;
      await ctx.runMutation(components.betterAuth.adapter.updateMany, {
        input: {
          model: 'team',
          where: [{ field: '_id', value: args.teamId, operator: 'eq' }],
          update: { name: displayName, updatedAt: Date.now() },
        },
        paginationOpts: { cursor: null, numItems: 1 },
      });
    }

    if (args.replaceMembers !== undefined) {
      // A clear-all / replace sets the base set; adds and removes in the SAME
      // PATCH compose on top so an `add` paired with a value-less `remove
      // members` isn't silently dropped (#2085[13]).
      await setTeamMembers(
        ctx,
        args.teamId,
        composeDesiredMembers(
          args.replaceMembers,
          args.addMembers,
          args.removeMembers,
        ),
      );
    } else {
      const current = await listTeamMembers(ctx, args.teamId);
      const currentIds = new Set(current.map((m) => m.userId));
      for (const userId of args.addMembers) {
        if (!currentIds.has(userId)) {
          await addTeamMemberRow(ctx, args.teamId, userId);
        }
      }
      const removeSet = new Set(args.removeMembers);
      for (const m of current) {
        if (removeSet.has(m.userId)) await removeTeamMemberRow(ctx, m._id);
      }
    }

    const link = await getLink(ctx, args.organizationId, args.teamId);
    const members = await listTeamMembers(ctx, args.teamId);
    await logScim(
      ctx,
      args.organizationId,
      'scim_patch_group',
      'team',
      args.teamId,
      displayName,
    );
    return buildGroupReturn(
      args.teamId,
      displayName,
      members.map((m) => m.userId),
      link?.externalId,
    );
  },
});

/** Delete a Group: drop the team, its teamMember rows, mirrors, and link. */
export const deleteGroup = internalMutation({
  args: { organizationId: v.string(), teamId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args): Promise<boolean> => {
    const team = await findTeamById(ctx, args.teamId);
    if (!team || team.organizationId !== args.organizationId) return false;

    const members = await listTeamMembers(ctx, args.teamId);
    for (const m of members) await removeTeamMemberRow(ctx, m._id);

    await ctx.runMutation(components.betterAuth.adapter.deleteOne, {
      input: {
        model: 'team',
        where: [{ field: '_id', value: args.teamId, operator: 'eq' }],
      },
    });
    await deleteLink(ctx, args.organizationId, args.teamId);
    await logScim(
      ctx,
      args.organizationId,
      'scim_delete_group',
      'team',
      args.teamId,
      team.name,
    );
    return true;
  },
});

/**
 * Throttled `lastUsedAt` stamp on the config row (skips if updated within the
 * last minute, to keep frequent SCIM polling from contending on this row).
 */
export const touchConfigLastUsed = internalMutation({
  args: { configId: v.id('ssoConnections') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.configId);
    if (!row) return null;
    const now = Date.now();
    if (!row.scimLastUsedAt || now - row.scimLastUsedAt > 60_000) {
      await ctx.db.patch(args.configId, { scimLastUsedAt: now });
    }
    return null;
  },
});
