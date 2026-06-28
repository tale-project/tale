/**
 * Internal V8-runtime functions for project secrets. The `'use node'`
 * encryption/decryption lives in `actions.ts`; this module only stores/reads
 * ciphertext rows and enforces project-admin access. Plaintext never passes
 * through here.
 */

import { ConvexError, v } from 'convex/values';

import type { Doc, Id } from '../../_generated/dataModel';
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
} from '../../_generated/server';
import { getUserTeamIds } from '../../lib/get_user_teams';
import { getOrganizationMember } from '../../lib/rls';
import { checkProjectAccess } from '../access';

/** Throws unless the user can administer the project (owner/admin). */
export const requireProjectAdminInternal = internalQuery({
  args: {
    organizationId: v.string(),
    projectId: v.id('projects'),
    userId: v.string(),
    email: v.optional(v.string()),
    name: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ projectName: string }> => {
    const project = await ctx.db.get(args.projectId);
    if (!project || project.organizationId !== args.organizationId) {
      throw new ConvexError({ code: 'PROJECT_NOT_FOUND' });
    }
    const member = await getOrganizationMember(ctx, args.organizationId, {
      userId: args.userId,
      email: args.email,
      name: args.name,
    });
    const teamIds = await getUserTeamIds(ctx, member.userId);
    if (!checkProjectAccess(project, teamIds, member.role).canAdminister) {
      throw new ConvexError({ code: 'PROJECT_FORBIDDEN' });
    }
    return { projectName: project.name };
  },
});

/** A single encrypted secret row's writable fields (sans org/project scope). */
type SecretRowFields = {
  name: string;
  description?: string;
  ciphertext: string;
  nonce: string;
  authTag: string;
  keyFingerprint: string;
  updatedBy: string;
};

/**
 * Upsert one encrypted secret row within an existing mutation transaction.
 * Shared by the single-secret and atomic-pair entry points so both write
 * exactly the same row shape; when called from the pair mutation every
 * `upsertSecretRow` runs inside the same transaction, so a later failure rolls
 * the earlier write back.
 */
async function upsertSecretRow(
  ctx: MutationCtx,
  scope: { organizationId: string; projectId: Id<'projects'> },
  fields: SecretRowFields,
): Promise<void> {
  const existing = await ctx.db
    .query('projectSecrets')
    .withIndex('by_project_name', (q) =>
      q
        .eq('organizationId', scope.organizationId)
        .eq('projectId', scope.projectId)
        .eq('name', fields.name),
    )
    .first();
  const now = Date.now();
  if (existing) {
    await ctx.db.patch(existing._id, {
      description: fields.description,
      ciphertext: fields.ciphertext,
      nonce: fields.nonce,
      authTag: fields.authTag,
      keyFingerprint: fields.keyFingerprint,
      updatedBy: fields.updatedBy,
      updatedAt: now,
    });
  } else {
    await ctx.db.insert('projectSecrets', {
      organizationId: scope.organizationId,
      projectId: scope.projectId,
      name: fields.name,
      description: fields.description,
      ciphertext: fields.ciphertext,
      nonce: fields.nonce,
      authTag: fields.authTag,
      keyFingerprint: fields.keyFingerprint,
      createdBy: fields.updatedBy,
      updatedBy: fields.updatedBy,
      createdAt: now,
      updatedAt: now,
    });
  }
}

export const upsertProjectSecretInternal = internalMutation({
  args: {
    organizationId: v.string(),
    projectId: v.id('projects'),
    name: v.string(),
    description: v.optional(v.string()),
    ciphertext: v.string(),
    nonce: v.string(),
    authTag: v.string(),
    keyFingerprint: v.string(),
    updatedBy: v.string(),
  },
  handler: async (ctx, args): Promise<null> => {
    await upsertSecretRow(
      ctx,
      { organizationId: args.organizationId, projectId: args.projectId },
      {
        name: args.name,
        description: args.description,
        ciphertext: args.ciphertext,
        nonce: args.nonce,
        authTag: args.authTag,
        keyFingerprint: args.keyFingerprint,
        updatedBy: args.updatedBy,
      },
    );
    return null;
  },
});

/** One encrypted secret's name + ciphertext bundle, used by the pair upsert. */
const encryptedSecretValidator = v.object({
  name: v.string(),
  ciphertext: v.string(),
  nonce: v.string(),
  authTag: v.string(),
  keyFingerprint: v.string(),
});

/**
 * Atomically upsert the two secrets of a `basic` credential
 * (`_USERNAME`/`_PASSWORD`). Both writes share one mutation transaction, so a
 * failure on the second never leaves the first orphaned — the whole mutation
 * rolls back.
 */
export const upsertProjectSecretPairInternal = internalMutation({
  args: {
    organizationId: v.string(),
    projectId: v.id('projects'),
    description: v.optional(v.string()),
    updatedBy: v.string(),
    username: encryptedSecretValidator,
    password: encryptedSecretValidator,
  },
  handler: async (ctx, args): Promise<null> => {
    const scope = {
      organizationId: args.organizationId,
      projectId: args.projectId,
    };
    for (const part of [args.username, args.password]) {
      await upsertSecretRow(ctx, scope, {
        name: part.name,
        description: args.description,
        ciphertext: part.ciphertext,
        nonce: part.nonce,
        authTag: part.authTag,
        keyFingerprint: part.keyFingerprint,
        updatedBy: args.updatedBy,
      });
    }
    return null;
  },
});

/** Returns the encrypted row for in-action decryption. Org-scoped. */
export const getProjectSecretRowInternal = internalQuery({
  args: {
    organizationId: v.string(),
    projectId: v.id('projects'),
    name: v.string(),
  },
  handler: async (ctx, args): Promise<Doc<'projectSecrets'> | null> => {
    return await ctx.db
      .query('projectSecrets')
      .withIndex('by_project_name', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('projectId', args.projectId)
          .eq('name', args.name),
      )
      .first();
  },
});

export const deleteProjectSecretInternal = internalMutation({
  args: {
    organizationId: v.string(),
    projectId: v.id('projects'),
    name: v.string(),
  },
  handler: async (ctx, args): Promise<null> => {
    const existing = await ctx.db
      .query('projectSecrets')
      .withIndex('by_project_name', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('projectId', args.projectId)
          .eq('name', args.name),
      )
      .first();
    if (existing) await ctx.db.delete(existing._id);
    return null;
  },
});

/** Record agent access to a secret (metadata read or injected dispatch). */
export const logAgentSecretAccessInternal = internalMutation({
  args: {
    organizationId: v.string(),
    projectId: v.id('projects'),
    secretName: v.string(),
    agentSlug: v.string(),
    threadId: v.optional(v.string()),
    accessType: v.union(
      v.literal('metadata_read'),
      v.literal('injected_dispatch'),
    ),
    decision: v.union(
      v.literal('approved'),
      v.literal('denied'),
      v.literal('auto'),
    ),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<null> => {
    await ctx.db.insert('agentSecretAccess', {
      organizationId: args.organizationId,
      projectId: args.projectId,
      secretName: args.secretName,
      agentSlug: args.agentSlug,
      threadId: args.threadId,
      accessType: args.accessType,
      decision: args.decision,
      reason: args.reason,
      createdAt: Date.now(),
    });
    return null;
  },
});

/** Metadata-only list for the agent secret_read tool (no decryption). */
export const listProjectSecretMetaInternal = internalQuery({
  args: { organizationId: v.string(), projectId: v.id('projects') },
  handler: async (
    ctx,
    args,
  ): Promise<
    Array<{ name: string; description?: string; updatedAt: number }>
  > => {
    const meta: Array<{
      name: string;
      description?: string;
      updatedAt: number;
    }> = [];
    for await (const row of ctx.db
      .query('projectSecrets')
      .withIndex('by_project', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('projectId', args.projectId),
      )) {
      meta.push({
        name: row.name,
        description: row.description,
        updatedAt: row.updatedAt,
      });
    }
    return meta;
  },
});
