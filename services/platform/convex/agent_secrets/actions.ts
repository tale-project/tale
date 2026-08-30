'use node';

/**
 * Org agent secrets — Node actions. Encryption/decryption live here because
 * `lib/secret_box.ts` is node-only (reads `ENCRYPTION_SECRET_HEX`).
 *
 *  - upsertAgentSecret: the public write path. Developer-gated, validates,
 *    encrypts, computes a masked preview, then stores via the internal
 *    mutation. Values are write-only — no read-back path exists.
 *  - resolveAgentSecretsEnv: internal, called per turn by the work lanes.
 *    Reads the requested rows, decrypts, and returns the env map to inject
 *    via `buildExternalTurnExec({ extraEnv })`.
 */

import { v } from 'convex/values';

import { AppError } from '../../lib/shared/errors/app-error';
import { internal } from '../_generated/api';
import { action, internalAction } from '../_generated/server';
import { requireOrgAdminOrDeveloper } from '../lib/auth/require_org_admin_or_developer';
import { decryptSecret, encryptSecret } from '../lib/secret_box';
import {
  maskAgentSecretPreview,
  validateAgentSecretName,
  validateAgentSecretValue,
  MAX_AGENT_SECRET_DESCRIPTION_LEN,
} from './constants';

export const upsertAgentSecret = action({
  args: {
    organizationId: v.string(),
    name: v.string(),
    value: v.string(),
    description: v.optional(v.string()),
  },
  returns: v.object({ created: v.boolean() }),
  handler: async (ctx, args): Promise<{ created: boolean }> => {
    const auth = await requireOrgAdminOrDeveloper(ctx, args.organizationId);

    const nameCheck = validateAgentSecretName(args.name);
    if (!nameCheck.ok) {
      throw new AppError({ code: 'invalid', message: nameCheck.reason });
    }
    // Trim surrounding whitespace — a pasted token very commonly carries a
    // trailing newline that silently corrupts it (→ 401). Interior whitespace
    // is kept so multi-line secrets (PEM keys) survive.
    const value = args.value.trim();
    const valueCheck = validateAgentSecretValue(value);
    if (!valueCheck.ok) {
      throw new AppError({ code: 'invalid', message: valueCheck.reason });
    }
    const description = args.description?.trim();
    if (
      description !== undefined &&
      description.length > MAX_AGENT_SECRET_DESCRIPTION_LEN
    ) {
      throw new AppError({
        code: 'invalid',
        message: `Description exceeds ${MAX_AGENT_SECRET_DESCRIPTION_LEN} characters.`,
      });
    }

    const encryptedValue = encryptSecret(value);
    const maskedPreview = maskAgentSecretPreview(value);

    return await ctx.runMutation(
      internal.agent_secrets.mutations.upsertAgentSecretInternal,
      {
        organizationId: args.organizationId,
        name: args.name,
        ...(description !== undefined && description !== ''
          ? { description }
          : {}),
        encryptedValue,
        ...(maskedPreview !== undefined ? { maskedPreview } : {}),
        actorId: auth.userId,
        actorEmail: auth.email,
      },
    );
  },
});

/**
 * Decrypt the named org secrets into an env map for a turn's exec. Called by
 * both work lanes with the agent/node's `secrets` names. A corrupt secret /
 * rotated key skips that one entry (never aborts the turn); a name with no row
 * is silently absent. Audits ONE `sandboxCredentialAccess` row when ≥1 secret
 * was injected — traceability without recording which names or values.
 */
export const resolveAgentSecretsEnv = internalAction({
  args: {
    organizationId: v.string(),
    sessionId: v.string(),
    names: v.array(v.string()),
  },
  returns: v.object({ env: v.record(v.string(), v.string()) }),
  handler: async (ctx, args): Promise<{ env: Record<string, string> }> => {
    if (args.names.length === 0) return { env: {} };
    const rows = await ctx.runQuery(
      internal.agent_secrets.queries.listAgentSecretsForInjection,
      { organizationId: args.organizationId, names: args.names },
    );

    const env: Record<string, string> = {};
    const injected: string[] = [];
    for (const row of rows) {
      try {
        env[row.name] = decryptSecret(row.encryptedValue);
        injected.push(row.name);
      } catch (err) {
        console.warn(
          `[agent-secrets] secret '${row.name}' failed to decrypt:`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }

    // One audit row PER injected secret, keyed by name — a leaked secret's
    // blast radius is scopeable from the trail (the name is non-secret: it is
    // already in the listing and in the turn's own instructions). Best-effort.
    for (const name of injected) {
      await ctx
        .runMutation(
          internal.sandbox.session_mutations.recordCredentialAccess,
          {
            organizationId: args.organizationId,
            sessionId: args.sessionId,
            slug: `agent-secret:${name}`,
            kind: 'bootstrap',
          },
        )
        .catch((err: unknown) =>
          console.warn('[agent-secrets] credential-access audit failed:', err),
        );
    }
    return { env };
  },
});
