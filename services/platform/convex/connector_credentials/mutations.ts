/**
 * Transactional core of the connector-credential CRUD.
 *
 * The PUBLIC write surface splits by whether secret material is involved:
 * plaintext secrets only ever exist inside `'use node'` actions
 * (`actions.ts` validates them against the connector, encrypts via
 * `lib/secret_box` and hands ciphertext to the internal mutations here),
 * while the secret-free writes — delete, default-swap — are plain V8
 * mutations in this file. Every invariant that must hold TRANSACTIONALLY
 * lives HERE, in one place, whatever the caller:
 *
 *  - `name` is unique per (organization, connector) — case-insensitive, so
 *    two credentials can't differ only in casing;
 *  - at most ONE default per (organization, connector) — the first
 *    credential of a pair becomes the default, and promoting one demotes the
 *    others in the same transaction;
 *  - `endpointUrl`, when present, is an https ORIGIN (no path, query,
 *    fragment, or trailing slash) — live bodies concatenate paths onto it.
 *
 * The rules that need the CONNECTOR (is this auth method offered? does this
 * connector use per-credential endpoints at all?) live in `actions.ts`: the
 * shipped catalog is on disk, which a V8 mutation cannot read.
 *
 * Writes are gated on the developer-settings capability
 * (`requireOrgAdminOrDeveloper`), matching the settings route that fronts
 * them; reads live in `queries.ts` under plain org membership.
 */

import { ConvexError, v } from 'convex/values';

import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { internalMutation, mutation } from '../_generated/server';
import { requireOrgAdminOrDeveloper } from '../lib/auth/require_org_admin_or_developer';
import {
  encryptedSecretValidator,
  connectorAuthMethodValidator,
  connectorCredentialStatusValidator,
} from './schema';

const NAME_MAX = 100;

/** Trim + shape-check a credential label; returns the canonical name. */
function normalizeName(raw: string): string {
  const name = raw.trim();
  if (name.length === 0 || name.length > NAME_MAX) {
    throw new ConvexError({
      code: 'CREDENTIAL_NAME_INVALID',
      message: `Credential name must be 1..${NAME_MAX} characters.`,
    });
  }
  return name;
}

/**
 * Canonical form of a per-credential API origin: https, no trailing slash,
 * and nothing after the host. Live bodies build every URL by appending to
 * `ctx.endpoint`, so a stored path (or query, or fragment) would silently
 * produce a wrong — possibly attacker-chosen — request URL.
 */
export function normalizeEndpointOrigin(raw: string): string {
  const value = raw.trim();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ConvexError({
      code: 'CREDENTIAL_ENDPOINT_INVALID',
      message: `Endpoint "${value}" is not a URL — enter the API origin, e.g. https://your-site.atlassian.net.`,
    });
  }
  if (url.protocol !== 'https:') {
    throw new ConvexError({
      code: 'CREDENTIAL_ENDPOINT_INVALID',
      message: `Endpoint "${value}" must use https.`,
    });
  }
  if (url.username !== '' || url.password !== '') {
    throw new ConvexError({
      code: 'CREDENTIAL_ENDPOINT_INVALID',
      message: `Endpoint "${value}" must not embed credentials — store them on the credential itself.`,
    });
  }
  const hasPath = url.pathname !== '' && url.pathname !== '/';
  if (hasPath || url.search !== '' || url.hash !== '') {
    throw new ConvexError({
      code: 'CREDENTIAL_ENDPOINT_INVALID',
      message: `Endpoint "${value}" must be an origin only — drop everything after the host (e.g. https://${url.host}).`,
    });
  }
  return url.origin;
}

async function rowsForConnector(
  ctx: MutationCtx,
  organizationId: string,
  connectorSlug: string,
): Promise<Doc<'connectorCredentials'>[]> {
  return await ctx.db
    .query('connectorCredentials')
    .withIndex('by_org_connector', (q) =>
      q.eq('organizationId', organizationId).eq('connectorSlug', connectorSlug),
    )
    .collect();
}

/** Case-insensitive name-uniqueness check within (org, connector). */
function assertNameFree(
  rows: readonly Doc<'connectorCredentials'>[],
  name: string,
  excludeId?: Id<'connectorCredentials'>,
): void {
  const needle = name.toLowerCase();
  const clash = rows.find(
    (row) => row._id !== excludeId && row.name.toLowerCase() === needle,
  );
  if (clash) {
    throw new ConvexError({
      code: 'CREDENTIAL_NAME_TAKEN',
      message: `A credential named "${clash.name}" already exists for this connector — pick a different name.`,
    });
  }
}

/** Load a row and verify it belongs to the caller's organization. A row of
 * another org reads as not-found; existence is never leaked across tenants. */
async function requireOwnRow(
  ctx: MutationCtx,
  organizationId: string,
  credentialId: Id<'connectorCredentials'>,
): Promise<Doc<'connectorCredentials'>> {
  const row = await ctx.db.get(credentialId);
  if (!row || row.organizationId !== organizationId) {
    throw new ConvexError({
      code: 'CREDENTIAL_NOT_FOUND',
      message: 'Credential not found.',
    });
  }
  return row;
}

/** Clear `isDefault` on every OTHER row of the same (org, connector). */
async function clearOtherDefaults(
  ctx: MutationCtx,
  organizationId: string,
  connectorSlug: string,
  keepId: Id<'connectorCredentials'> | null,
): Promise<void> {
  for (const row of await rowsForConnector(
    ctx,
    organizationId,
    connectorSlug,
  )) {
    if (row._id !== keepId && row.isDefault) {
      await ctx.db.patch(row._id, { isDefault: false, updatedAt: Date.now() });
    }
  }
}

/**
 * A usable credential a workflow node or chat invocation can fall back to
 * when it names none: the OLDEST remaining active row of the pair. Oldest
 * rather than newest because the first credential an org configured is the
 * one its existing automations were authored against.
 */
function oldestActive(
  rows: readonly Doc<'connectorCredentials'>[],
): Doc<'connectorCredentials'> | undefined {
  return rows
    .filter((row) => row.status === 'active')
    .sort((a, b) => a.createdAt - b.createdAt || a._id.localeCompare(b._id))[0];
}

/**
 * Insert one credential row. The FIRST credential of an (org, connector)
 * pair becomes its default; passing `isDefault: true` promotes this one and
 * demotes the previous default in the same transaction. Called by the create
 * action and by the row-carrying migration — never from clients.
 */
export const insertCredentialInternal = internalMutation({
  args: {
    organizationId: v.string(),
    connectorSlug: v.string(),
    authMethod: connectorAuthMethodValidator,
    name: v.string(),
    encryptedData: encryptedSecretValidator,
    endpointUrl: v.optional(v.string()),
    config: v.optional(
      v.record(v.string(), v.union(v.string(), v.number(), v.boolean())),
    ),
    maskedPreview: v.optional(v.string()),
    isDefault: v.optional(v.boolean()),
    status: connectorCredentialStatusValidator,
    statusDetail: v.optional(v.string()),
    createdBy: v.string(),
  },
  returns: v.id('connectorCredentials'),
  handler: async (ctx, args) => {
    const name = normalizeName(args.name);
    const siblings = await rowsForConnector(
      ctx,
      args.organizationId,
      args.connectorSlug,
    );
    assertNameFree(siblings, name);
    const endpointUrl =
      args.endpointUrl === undefined
        ? undefined
        : normalizeEndpointOrigin(args.endpointUrl);
    const isDefault = args.isDefault ?? siblings.length === 0;
    if (isDefault) {
      await clearOtherDefaults(
        ctx,
        args.organizationId,
        args.connectorSlug,
        null,
      );
    }
    const now = Date.now();
    return await ctx.db.insert('connectorCredentials', {
      organizationId: args.organizationId,
      connectorSlug: args.connectorSlug,
      authMethod: args.authMethod,
      name,
      encryptedData: args.encryptedData,
      ...(endpointUrl !== undefined && { endpointUrl }),
      ...(args.config !== undefined && { config: args.config }),
      ...(args.maskedPreview !== undefined && {
        maskedPreview: args.maskedPreview,
      }),
      isDefault,
      status: args.status,
      ...(args.statusDetail !== undefined && {
        statusDetail: args.statusDetail,
      }),
      createdBy: args.createdBy,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Patch one credential row: label, endpoint, status (+ detail; null clears
 * it), default flag, and — for secret replacement — fresh ciphertext with
 * its recomputed preview (already validated/encrypted by the calling
 * action). Setting `isDefault: true` swaps the default in the same
 * transaction; `false` merely clears it, which may leave the pair with no
 * default (resolution then asks for one explicitly).
 */
export const patchCredentialInternal = internalMutation({
  args: {
    organizationId: v.string(),
    credentialId: v.id('connectorCredentials'),
    name: v.optional(v.string()),
    status: v.optional(connectorCredentialStatusValidator),
    statusDetail: v.optional(v.union(v.string(), v.null())),
    isDefault: v.optional(v.boolean()),
    encryptedData: v.optional(encryptedSecretValidator),
    maskedPreview: v.optional(v.union(v.string(), v.null())),
    endpointUrl: v.optional(v.string()),
    config: v.optional(
      v.record(v.string(), v.union(v.string(), v.number(), v.boolean())),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await requireOwnRow(
      ctx,
      args.organizationId,
      args.credentialId,
    );

    const patch: Partial<Doc<'connectorCredentials'>> = {
      updatedAt: Date.now(),
    };
    if (args.name !== undefined) {
      const name = normalizeName(args.name);
      const siblings = await rowsForConnector(
        ctx,
        args.organizationId,
        row.connectorSlug,
      );
      assertNameFree(siblings, name, row._id);
      patch.name = name;
    }
    if (args.status !== undefined) patch.status = args.status;
    if (args.statusDetail !== undefined) {
      patch.statusDetail = args.statusDetail ?? undefined;
    }
    if (args.encryptedData !== undefined) {
      patch.encryptedData = args.encryptedData;
      // A new secret always re-stamps the preview, including CLEARING it when
      // the replacement is too short to excerpt — a stale preview of the old
      // secret would misdescribe the row.
      patch.maskedPreview = args.maskedPreview ?? undefined;
    }
    if (args.endpointUrl !== undefined) {
      patch.endpointUrl = normalizeEndpointOrigin(args.endpointUrl);
    }
    if (args.config !== undefined) {
      patch.config = args.config;
    }
    if (args.isDefault !== undefined) {
      patch.isDefault = args.isDefault;
      if (args.isDefault) {
        await clearOtherDefaults(
          ctx,
          args.organizationId,
          row.connectorSlug,
          row._id,
        );
      }
    }
    await ctx.db.patch(row._id, patch);
    return null;
  },
});

/**
 * Delete a credential. Deleting the DEFAULT promotes the oldest remaining
 * active row of the pair, because an invocation that names no credential
 * resolves through the default: leaving the connector without one would
 * break every existing automation step instead of just the deleted account.
 * A pair whose remaining rows are all disabled is left without a default —
 * promoting a row an operator switched off would be worse.
 */
export const deleteCredential = mutation({
  args: {
    organizationId: v.string(),
    credentialId: v.id('connectorCredentials'),
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
    if (!row.isDefault) return null;

    const remaining = (
      await rowsForConnector(ctx, args.organizationId, row.connectorSlug)
    ).filter((sibling) => sibling._id !== row._id);
    const successor = oldestActive(remaining);
    if (successor) {
      await ctx.db.patch(successor._id, {
        isDefault: true,
        updatedAt: Date.now(),
      });
    }
    return null;
  },
});

/** Make one credential the default for its (org, connector) pair, clearing
 * every other default of that pair in the same transaction. */
export const setDefaultCredential = mutation({
  args: {
    organizationId: v.string(),
    credentialId: v.id('connectorCredentials'),
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
      });
    }
    if (row.status === 'needs-reauth') {
      throw new ConvexError({
        code: 'CREDENTIAL_NEEDS_REAUTH',
        message: `Credential "${row.name}" needs to be reconnected before it can be the default.`,
      });
    }
    await clearOtherDefaults(
      ctx,
      args.organizationId,
      row.connectorSlug,
      row._id,
    );
    if (!row.isDefault) {
      await ctx.db.patch(row._id, { isDefault: true, updatedAt: Date.now() });
    }
    return null;
  },
});
