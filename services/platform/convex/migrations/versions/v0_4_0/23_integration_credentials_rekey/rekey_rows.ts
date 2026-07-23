/**
 * The V8 half of `0.4.0/23_integration_credentials_rekey`: the row reads and
 * writes its `'use node'` handlers drive through `ctx.runQuery` /
 * `ctx.runMutation`.
 *
 * It lives beside the migration rather than in
 * `convex/integration_credentials/` on purpose. Carrying rows ACROSS a table
 * reshape means reading documents in the retired shape and — on the way back
 * — writing them again, neither of which the current schema describes; the
 * rebuilt domain's mutations stay honest about the one shape they own, and
 * the untyped writes stay quarantined in the migration that needs them.
 *
 * Reads are a filtered scan: the retired shape's `by_organizationId` index
 * left the schema with it, and the live backend serves no index a table no
 * longer declares.
 */

import { v } from 'convex/values';

import { internalMutation, internalQuery } from '../../../../_generated/server';
import {
  encryptedSecretValidator,
  integrationAuthMethodValidator,
  integrationCredentialStatusValidator,
} from '../../../../integration_credentials/schema';

/** Every `integrationCredentials` row of one organization, whatever shape it
 * is in — full documents, so the handler can snapshot them verbatim. */
export const listOrgRowsInternal = internalQuery({
  args: { organizationId: v.string() },
  // Rows span the retired and rebuilt shapes; v.any() carries both.
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    const rows: Array<Record<string, unknown>> = [];
    for await (const row of ctx.db.query('integrationCredentials')) {
      if (row.organizationId === args.organizationId) rows.push(row);
    }
    return rows;
  },
});

/**
 * Replace one row with its rebuilt shape, keeping the document id so the
 * inverse can restore the original in place (and anything still pointing at
 * the credential keeps pointing at it).
 */
export const writeRekeyedRowInternal = internalMutation({
  args: {
    credentialId: v.id('integrationCredentials'),
    organizationId: v.string(),
    connectorSlug: v.string(),
    authMethod: integrationAuthMethodValidator,
    name: v.string(),
    encryptedData: encryptedSecretValidator,
    endpointUrl: v.optional(v.string()),
    maskedPreview: v.optional(v.string()),
    isDefault: v.boolean(),
    status: integrationCredentialStatusValidator,
    statusDetail: v.optional(v.string()),
    createdBy: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const { credentialId, ...document } = args;
    await ctx.db.replace(credentialId, document);
    return null;
  },
});

/**
 * Put one snapshotted row back exactly as it was: in place when the document
 * still exists, freshly inserted when it was deleted meanwhile. Returns what
 * it did so the handler can report it.
 */
export const restoreRetiredRowInternal = internalMutation({
  args: {
    credentialId: v.id('integrationCredentials'),
    document: v.any(),
  },
  returns: v.union(v.literal('replaced'), v.literal('inserted')),
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.credentialId);
    if (existing) {
      // The retired shape is absent from the current schema — write untyped.
      // oxlint-disable-next-line typescript/no-explicit-any -- retired row shape absent from the schema
      await (ctx.db as any).replace(args.credentialId, args.document);
      return 'replaced';
    }
    // oxlint-disable-next-line typescript/no-explicit-any -- retired row shape absent from the schema
    await (ctx.db as any).insert('integrationCredentials', args.document);
    return 'inserted';
  },
});

/** Delete one row this migration created that the snapshot does not account
 * for — the inverse of a write with no original behind it. */
export const deleteRowInternal = internalMutation({
  args: { credentialId: v.id('integrationCredentials') },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    await ctx.db.delete(args.credentialId);
    return null;
  },
});
