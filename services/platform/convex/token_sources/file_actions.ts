'use node';

import { unlink } from 'node:fs/promises';
import path from 'node:path';

import { ConvexError, v } from 'convex/values';
import { ZodError } from 'zod/v4';

import type { TokenSource } from '../../lib/shared/schemas/token_sources';
import { tokenSourceSchema } from '../../lib/shared/schemas/token_sources';
import { action } from '../_generated/server';
import { requireOrgMembershipById } from '../lib/auth/require_org_membership';
import {
  atomicWrite,
  atomicWriteSecret,
  errnoCode,
  readdirSafe,
  serializeJson,
} from '../lib/file_io';
import {
  encryptJsonWithSops,
  hasSopsKey,
  invalidateSecretsCache,
} from '../lib/sops';
import {
  loadTokenSource,
  resolveTokenSourceFilePath,
  resolveTokenSourceSecretsPath,
  resolveTokenSourcesDir,
  tokenSourceSecretExists,
} from './file_utils';

/**
 * List the org's configured token sources (summary fields) — drives both the
 * agent Environment-tab Type→Source dropdown and the Settings management list.
 * Reads the `token-sources/` config dir; skips any file that fails to parse so
 * one bad config can't hide the rest. Never returns the broker secret.
 */
export const listTokenSources = action({
  args: { organizationId: v.string() },
  returns: v.array(
    v.object({
      slug: v.string(),
      displayName: v.string(),
      endpoint: v.string(),
      targetEnvVar: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const { orgSlug } = await requireOrgMembershipById(
      ctx,
      args.organizationId,
    );
    const dir = resolveTokenSourcesDir(orgSlug);
    const files = await readdirSafe(dir);
    const out: {
      slug: string;
      displayName: string;
      endpoint: string;
      targetEnvVar: string;
    }[] = [];
    for (const file of files) {
      // Skip the encrypted `<slug>.secrets.json` sidecars — they end in
      // `.json` too, but are not token-source configs (and their derived
      // `<slug>.secrets` slug fails validation).
      if (!file.endsWith('.json') || file.endsWith('.secrets.json')) continue;
      const slug = path.basename(file, '.json');
      const read = await loadTokenSource(orgSlug, slug);
      if (!read.ok) continue;
      out.push({
        slug: read.config.slug,
        displayName: read.config.displayName,
        endpoint: read.config.endpoint,
        targetEnvVar: read.config.targetEnvVar,
      });
    }
    out.sort((a, b) => a.displayName.localeCompare(b.displayName));
    return out;
  },
});

/**
 * Read one token source's full config for the edit form, plus whether a broker
 * secret is set (write-only — the secret VALUE is never returned).
 */
export const getTokenSource = action({
  args: { organizationId: v.string(), slug: v.string() },
  returns: v.union(
    v.null(),
    v.object({ config: v.any(), hasSecret: v.boolean() }),
  ),
  handler: async (ctx, args) => {
    const { orgSlug } = await requireOrgMembershipById(
      ctx,
      args.organizationId,
    );
    const read = await loadTokenSource(orgSlug, args.slug);
    if (!read.ok) return null;
    // "Configured" = a secret sidecar exists (presence, not decryptability) OR
    // the auth's `secretEnv` env-ref is actually set in this deployment. Never
    // decrypt the sidecar here — the value is write-only and a momentary
    // SOPS-key gap must not read as "no secret". The env-ref, however, must be
    // resolved: a declared-but-unset `secretEnv` is NOT configured (it mirrors
    // the pool fetcher, which reads `process.env[secretEnv]` at request time).
    const sidecarExists = await tokenSourceSecretExists(orgSlug, args.slug);
    const auth = read.config.auth;
    const hasEnvRef =
      auth.method !== 'none' &&
      typeof auth.secretEnv === 'string' &&
      (process.env[auth.secretEnv] ?? '').length > 0;
    return { config: read.config, hasSecret: sidecarExists || hasEnvRef };
  },
});

/**
 * Create or update a token source: validate the config, write `<slug>.json`,
 * and (when a `secret` is provided) write the broker auth secret to the
 * encrypted `<slug>.secrets.json` sidecar. An empty `secret` string clears it;
 * `undefined` leaves an existing secret untouched (edit without re-entering).
 */
export const saveTokenSource = action({
  args: {
    organizationId: v.string(),
    config: v.any(),
    secret: v.optional(v.string()),
  },
  returns: v.object({ slug: v.string() }),
  handler: async (ctx, args): Promise<{ slug: string }> => {
    const { orgSlug } = await requireOrgMembershipById(
      ctx,
      args.organizationId,
    );

    let config: TokenSource;
    try {
      config = tokenSourceSchema.parse(args.config);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new ConvexError({
          code: 'VALIDATION_ERROR',
          message: 'Invalid token source configuration',
          fieldErrors: err.flatten().fieldErrors,
        });
      }
      throw err;
    }

    await atomicWrite(
      resolveTokenSourceFilePath(orgSlug, config.slug),
      serializeJson(config),
    );

    if (args.secret !== undefined) {
      const secretsPath = resolveTokenSourceSecretsPath(orgSlug, config.slug);
      if (args.secret.length > 0) {
        const plaintext = `${JSON.stringify({ authSecret: args.secret }, null, 2)}\n`;
        // Encrypt with SOPS when an age key is configured; else write plaintext
        // (0600) — the read path (decryptSecretsFile) handles both.
        await atomicWriteSecret(
          secretsPath,
          hasSopsKey() ? encryptJsonWithSops(plaintext) : plaintext,
        );
      } else {
        await unlink(secretsPath).catch((e: unknown) => {
          if (errnoCode(e) !== 'ENOENT') {
            console.warn(
              `[token-source] clearing secret for "${config.slug}" failed:`,
              e instanceof Error ? e.message : String(e),
            );
          }
        });
      }
      invalidateSecretsCache(secretsPath);
    }

    return { slug: config.slug };
  },
});

/** Delete a token source — both its config file and any secret sidecar. */
export const deleteTokenSource = action({
  args: { organizationId: v.string(), slug: v.string() },
  returns: v.object({ ok: v.boolean() }),
  handler: async (ctx, args): Promise<{ ok: boolean }> => {
    const { orgSlug } = await requireOrgMembershipById(
      ctx,
      args.organizationId,
    );
    const secretsPath = resolveTokenSourceSecretsPath(orgSlug, args.slug);
    for (const p of [
      resolveTokenSourceFilePath(orgSlug, args.slug),
      secretsPath,
    ]) {
      await unlink(p).catch((e: unknown) => {
        if (errnoCode(e) !== 'ENOENT') {
          console.warn(
            `[token-source] delete ${path.basename(p)} failed:`,
            e instanceof Error ? e.message : String(e),
          );
        }
      });
    }
    invalidateSecretsCache(secretsPath);
    return { ok: true };
  },
});
