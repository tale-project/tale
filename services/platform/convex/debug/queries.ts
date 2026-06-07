/**
 * Dev-tooling capability queries.
 *
 * Kept out of the `'use node'` probe file so this can be a regular Convex
 * query. This only drives UI visibility — the probe action re-checks the
 * allowlist server-side, so a spoofed `true` here grants nothing.
 */

import { v } from 'convex/values';

import { query } from '../_generated/server';
import { isDeploymentEditor } from '../deployment/editors';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';

/**
 * Whether the current user may run the direct-TTFT probe. Gated by the same
 * `TALE_DEPLOYMENT_CONFIG_ADMINS` allowlist as deployment editing; empty/unset
 * => false (fail-safe). The action enforces this independently — see
 * `debug/direct_ttft.measureDirectTtft`.
 */
export const canRunDirectTtft = query({
  args: {},
  returns: v.boolean(),
  handler: async (ctx) => {
    const user = await getAuthUserIdentity(ctx);
    return isDeploymentEditor(user?.email);
  },
});
