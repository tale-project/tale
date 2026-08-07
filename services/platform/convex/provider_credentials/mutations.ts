/**
 * Transactional core of the provider-credential CRUD.
 *
 * The PUBLIC write surface splits by whether secret material is involved:
 * plaintext secrets only ever exist inside `'use node'` actions
 * (`actions.ts` encrypts via `lib/secret_box` and hands ciphertext to the
 * internal mutations here), while the secret-free writes — delete,
 * default-swap — are plain V8 mutations in this file. Every invariant that
 * must hold transactionally lives HERE, in one place, whatever the caller:
 *
 *  - `name` is unique per (organization, provider) — case-insensitive, so
 *    two credentials can't differ only in casing;
 *  - at most ONE default per (organization, provider) — the first credential
 *    of a pair becomes the default, and setting a default clears the others
 *    in the same transaction;
 *  - a row's secret fields must match its auth method (`api-key` /
 *    `subscription-broker` carry `encryptedData`; `env` carries `envName`).
 *
 * Writes are gated on the developer-settings capability
 * (`requireOrgAdminOrDeveloper`), matching the settings route that fronts
 * them; reads live in `queries.ts` under plain org membership.
 */

import { ConvexError, v } from 'convex/values';

import { SECRETS_ENV_REGEX } from '../../lib/shared/schemas/providers';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { internalMutation, mutation } from '../_generated/server';
import { requireOrgAdminOrDeveloper } from '../lib/auth/require_org_admin_or_developer';
import {
  encryptedSecretValidator,
  providerAuthMethodValidator,
  providerCredentialStatusValidator,
} from './schema';

const NAME_MAX = 100;

/** Trim + shape-check a credential label; returns the canonical name. */
function normalizeName(raw: string): string {
  const name = raw.trim();
  if (name.length === 0 || name.length > NAME_MAX) {
    throw new ConvexError({
      code: 'CREDENTIAL_NAME_INVALID',
      message: `Credential name must be 1..${NAME_MAX} characters.`,
      userMessage: `Credential name must be 1–${NAME_MAX} characters.`,
    });
  }
  return name;
}

async function rowsForProvider(
  ctx: MutationCtx,
  organizationId: string,
  providerSlug: string,
): Promise<Array<Doc<'providerCredentials'>>> {
  return await ctx.db
    .query('providerCredentials')
    .withIndex('by_org_provider', (q) =>
      q.eq('organizationId', organizationId).eq('providerSlug', providerSlug),
    )
    .collect();
}

/** Case-insensitive name-uniqueness check within (org, provider). */
function assertNameFree(
  rows: ReadonlyArray<Doc<'providerCredentials'>>,
  name: string,
  excludeId?: Id<'providerCredentials'>,
): void {
  const needle = name.toLowerCase();
  const clash = rows.find(
    (row) => row._id !== excludeId && row.name.toLowerCase() === needle,
  );
  if (clash) {
    throw new ConvexError({
      code: 'CREDENTIAL_NAME_TAKEN',
      message: `A credential named "${clash.name}" already exists for this provider — pick a different name.`,
      userMessage: `A credential named "${clash.name}" already exists for this provider — pick a different name.`,
    });
  }
}

/**
 * The auth-method ↔ secret-field coherence rule. Guards the internal write
 * paths against a caller bug ever persisting a row the resolver can't read.
 */
function assertMethodFields(args: {
  authMethod: 'api-key' | 'env' | 'subscription-key' | 'subscription-broker';
  encryptedData?: unknown;
  envName?: string;
}): void {
  switch (args.authMethod) {
    case 'api-key':
    case 'subscription-key':
    case 'subscription-broker': {
      if (args.encryptedData === undefined || args.envName !== undefined) {
        throw new ConvexError({
          code: 'CREDENTIAL_SHAPE_INVALID',
          message: `A ${args.authMethod} credential must carry encrypted data and no env name.`,
        });
      }
      return;
    }
    case 'env': {
      if (args.envName === undefined || args.encryptedData !== undefined) {
        throw new ConvexError({
          code: 'CREDENTIAL_SHAPE_INVALID',
          message: 'An env credential must carry an env name and no secret.',
        });
      }
      if (!SECRETS_ENV_REGEX.test(args.envName)) {
        throw new ConvexError({
          code: 'CREDENTIAL_ENV_NAME_INVALID',
          message: `Env name "${args.envName}" must match the TALE_PROVIDER_KEY_ namespace (letters, digits, underscores).`,
        });
      }
      return;
    }
    default: {
      const _exhaustive: never = args.authMethod;
      return _exhaustive;
    }
  }
}

/** Load a row and verify it belongs to the caller's organization. A row of
 * another org reads as not-found — existence is never leaked across tenants. */
async function requireOwnRow(
  ctx: MutationCtx,
  organizationId: string,
  credentialId: Id<'providerCredentials'>,
): Promise<Doc<'providerCredentials'>> {
  const row = await ctx.db.get(credentialId);
  if (!row || row.organizationId !== organizationId) {
    throw new ConvexError({
      code: 'CREDENTIAL_NOT_FOUND',
      message: 'Credential not found.',
    });
  }
  return row;
}

/** Clear `isDefault` on every OTHER row of the same (org, provider). */
async function clearOtherDefaults(
  ctx: MutationCtx,
  organizationId: string,
  providerSlug: string,
  keepId: Id<'providerCredentials'> | null,
): Promise<void> {
  for (const row of await rowsForProvider(ctx, organizationId, providerSlug)) {
    if (row._id !== keepId && row.isDefault) {
      await ctx.db.patch(row._id, { isDefault: false, updatedAt: Date.now() });
    }
  }
}

/**
 * Insert one credential row. The FIRST credential of an (org, provider) pair
 * becomes its default. Called by the create action and the file→row
 * migration — never from clients.
 */
export const insertCredentialInternal = internalMutation({
  args: {
    organizationId: v.string(),
    providerSlug: v.string(),
    authMethod: providerAuthMethodValidator,
    name: v.string(),
    encryptedData: v.optional(encryptedSecretValidator),
    envName: v.optional(v.string()),
    endpointUrl: v.optional(v.string()),
    maskedPreview: v.optional(v.string()),
    modelAllowlist: v.optional(v.array(v.string())),
    status: providerCredentialStatusValidator,
    createdBy: v.string(),
  },
  returns: v.id('providerCredentials'),
  handler: async (ctx, args) => {
    const name = normalizeName(args.name);
    assertMethodFields(args);
    const siblings = await rowsForProvider(
      ctx,
      args.organizationId,
      args.providerSlug,
    );
    assertNameFree(siblings, name);
    const now = Date.now();
    return await ctx.db.insert('providerCredentials', {
      organizationId: args.organizationId,
      providerSlug: args.providerSlug,
      authMethod: args.authMethod,
      name,
      ...(args.encryptedData !== undefined && {
        encryptedData: args.encryptedData,
      }),
      ...(args.envName !== undefined && { envName: args.envName }),
      ...(args.endpointUrl !== undefined && { endpointUrl: args.endpointUrl }),
      ...(args.maskedPreview !== undefined && {
        maskedPreview: args.maskedPreview,
      }),
      ...(args.modelAllowlist !== undefined && {
        modelAllowlist: args.modelAllowlist,
      }),
      isDefault: siblings.length === 0,
      status: args.status,
      createdBy: args.createdBy,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Patch one credential row: label, allowlist (null clears it), status,
 * default flag, and — for secret replacement — fresh ciphertext or a new env
 * name (already validated/encrypted by the calling action). Setting
 * `isDefault: true` swaps the default in the same transaction; `false`
 * merely clears it, which may leave the pair with no default (resolution
 * then asks for one explicitly).
 */
export const patchCredentialInternal = internalMutation({
  args: {
    organizationId: v.string(),
    credentialId: v.id('providerCredentials'),
    name: v.optional(v.string()),
    modelAllowlist: v.optional(v.union(v.array(v.string()), v.null())),
    status: v.optional(providerCredentialStatusValidator),
    isDefault: v.optional(v.boolean()),
    encryptedData: v.optional(encryptedSecretValidator),
    envName: v.optional(v.string()),
    endpointUrl: v.optional(v.string()),
    maskedPreview: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await requireOwnRow(
      ctx,
      args.organizationId,
      args.credentialId,
    );

    const patch: Partial<Doc<'providerCredentials'>> = {
      updatedAt: Date.now(),
    };
    if (args.name !== undefined) {
      const name = normalizeName(args.name);
      const siblings = await rowsForProvider(
        ctx,
        args.organizationId,
        row.providerSlug,
      );
      assertNameFree(siblings, name, row._id);
      patch.name = name;
    }
    if (args.modelAllowlist !== undefined) {
      patch.modelAllowlist = args.modelAllowlist ?? undefined;
    }
    if (args.status !== undefined) patch.status = args.status;
    if (args.encryptedData !== undefined) {
      patch.encryptedData = args.encryptedData;
      patch.maskedPreview = args.maskedPreview;
    }
    if (args.envName !== undefined) patch.envName = args.envName;
    if (args.endpointUrl !== undefined) patch.endpointUrl = args.endpointUrl;

    // Replacement fields land on the row's EXISTING method — re-check the
    // coherence rule over the merged result so a bad caller can't cross-wire
    // an env row with ciphertext.
    assertMethodFields({
      authMethod: row.authMethod,
      encryptedData: patch.encryptedData ?? row.encryptedData,
      envName: patch.envName ?? row.envName,
    });

    if (args.isDefault !== undefined) {
      patch.isDefault = args.isDefault;
      if (args.isDefault) {
        await clearOtherDefaults(
          ctx,
          args.organizationId,
          row.providerSlug,
          row._id,
        );
      }
    }
    await ctx.db.patch(row._id, patch);
    return null;
  },
});

/** Delete a credential. Deleting the default leaves the pair with no
 * default on purpose — silently promoting another secret would change what
 * runs without anyone choosing it; `setDefaultCredential` is the explicit
 * hand-off. */
export const deleteCredential = mutation({
  args: {
    organizationId: v.string(),
    credentialId: v.id('providerCredentials'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireOrgAdminOrDeveloper(ctx, args.organizationId);
    const row = await requireOwnRow(
      ctx,
      args.organizationId,
      args.credentialId,
    );
    await ctx.db.delete(row._id);
    return null;
  },
});

/** Make one credential the default for its (org, provider) pair, clearing
 * every other default of that pair in the same transaction. */
export const setDefaultCredential = mutation({
  args: {
    organizationId: v.string(),
    credentialId: v.id('providerCredentials'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireOrgAdminOrDeveloper(ctx, args.organizationId);
    const row = await requireOwnRow(
      ctx,
      args.organizationId,
      args.credentialId,
    );
    if (row.status === 'disabled') {
      throw new ConvexError({
        code: 'CREDENTIAL_DISABLED',
        message: `Credential "${row.name}" is disabled — enable it before making it the default.`,
        userMessage: `Credential "${row.name}" is disabled — enable it before making it the default.`,
      });
    }
    await clearOtherDefaults(
      ctx,
      args.organizationId,
      row.providerSlug,
      row._id,
    );
    if (!row.isDefault) {
      await ctx.db.patch(row._id, { isDefault: true, updatedAt: Date.now() });
    }
    return null;
  },
});

/**
 * Delete every row a migration stamped with its `createdBy` marker — the
 * inverse of the file→row migration, scoped to exactly what it created.
 * Idempotent: a second run finds nothing. Returns the number removed.
 */
export const removeMigratedCredentialsInternal = internalMutation({
  args: {
    organizationId: v.string(),
    createdBy: v.string(),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query('providerCredentials')
      .withIndex('by_org', (q) => q.eq('organizationId', args.organizationId))
      .collect();
    let removed = 0;
    for (const row of rows) {
      if (row.createdBy === args.createdBy) {
        await ctx.db.delete(row._id);
        removed += 1;
      }
    }
    return removed;
  },
});
