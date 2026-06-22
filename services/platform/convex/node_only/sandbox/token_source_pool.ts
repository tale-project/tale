'use node';

/**
 * Token-source rotation engine (the `'use node'` action half). Fetches a pool
 * of credentials from an external broker (per a config-driven, NOT hardcoded,
 * response mapping), filters to active+unexpired, and returns the usable token
 * strings. The pure mapping/selection lives in `token_pool_select.ts`; the
 * sandbox orchestrator injects the pick under the source's `targetEnvVar` and
 * rotates on a rate-limit/auth failure (see `workflow_sandbox_exec`).
 */

import { v } from 'convex/values';

import type {
  TokenSource,
  TokenSourceAuth,
} from '../../../lib/shared/schemas/token_sources';
import { internal } from '../../_generated/api';
import { internalAction } from '../../_generated/server';
import { safeFetch, SafeFetchError } from '../../lib/http/safe_fetch';
import {
  loadTokenSource,
  loadTokenSourceSecret,
} from '../../token_sources/file_utils';
import { mapTokens, TokenSourceError } from './token_pool_select';

function buildAuthHeaders(
  auth: TokenSourceAuth,
  secret: string | undefined,
): Record<string, string> {
  if (auth.method === 'none') return {};
  if (secret === undefined || secret === '') {
    throw new TokenSourceError('broker auth secret is not configured');
  }
  if (auth.method === 'bearer') return { authorization: `Bearer ${secret}` };
  return { [auth.headerName]: secret };
}

/**
 * Fetch the broker, map + filter the response, and return the usable token
 * pool (strings only — broker metadata never crosses into the orchestrator).
 * Fail-fast on every error (unreachable / non-2xx / malformed / empty) with a
 * sanitized `TokenSourceError`. Audits the fetch.
 */
export const resolveTokenPool = internalAction({
  args: {
    organizationId: v.string(),
    orgSlug: v.string(),
    sessionId: v.string(),
    slug: v.string(),
  },
  returns: v.object({
    tokens: v.array(v.string()),
    targetEnvVar: v.string(),
    selection: v.union(
      v.literal('random'),
      v.literal('round-robin'),
      v.literal('first'),
    ),
  }),
  handler: async (ctx, args) => {
    const read = await loadTokenSource(args.orgSlug, args.slug);
    if (!read.ok) {
      throw new TokenSourceError(
        `token source "${args.slug}" not found or invalid (${read.error})`,
      );
    }
    const cfg: TokenSource = read.config;

    // The broker auth secret: prefer the encrypted sidecar (set via the
    // management UI), else the operator-set env-ref named by auth.secretEnv.
    let authSecret: string | undefined;
    if (cfg.auth.method !== 'none') {
      authSecret =
        (await loadTokenSourceSecret(args.orgSlug, args.slug)) ??
        (cfg.auth.secretEnv !== undefined
          ? process.env[cfg.auth.secretEnv]
          : undefined);
    }

    let res;
    try {
      res = await safeFetch(cfg.endpoint, {
        method: cfg.method,
        headers: buildAuthHeaders(cfg.auth, authSecret),
        timeoutMs: cfg.timeoutMs,
        maxResponseBytes: cfg.maxResponseBytes,
      });
    } catch (err) {
      // Never echo the broker URL / response — only the failure class.
      const kind = err instanceof SafeFetchError ? err.kind : 'network_error';
      throw new TokenSourceError(`broker request failed (${kind})`);
    }
    if (res.status < 200 || res.status >= 300) {
      throw new TokenSourceError(`broker returned HTTP ${res.status}`);
    }

    let json: unknown;
    try {
      json = JSON.parse(res.body);
    } catch {
      throw new TokenSourceError('broker returned a non-JSON response');
    }

    const tokens = mapTokens(
      json,
      cfg.responseMapping,
      Date.now(),
      cfg.expirySkewMs,
    );
    if (tokens.length === 0) {
      throw new TokenSourceError(
        `token source "${args.slug}" returned no active, unexpired tokens`,
      );
    }

    await ctx.runMutation(
      internal.sandbox.session_mutations.recordCredentialAccess,
      {
        organizationId: args.organizationId,
        sessionId: args.sessionId,
        slug: `token-source:${args.slug}`,
        kind: 'bootstrap',
      },
    );

    return {
      tokens,
      targetEnvVar: cfg.targetEnvVar,
      selection: cfg.selection,
    };
  },
});
