import { v } from 'convex/values';

import { internalQuery } from '../_generated/server';

/**
 * Trivial V8 query the node-lane ping round-trips through. The VALUE is the
 * round-trip itself: a `'use node'` action's `ctx.runQuery` is an HTTP
 * callback from the node executor to the backend, and that channel is
 * exactly what a wedged executor breaks ("fetch failed" from every node
 * action) while V8 execution and external HTTP stay healthy.
 */
export const ok = internalQuery({
  args: {},
  returns: v.string(),
  handler: async () => 'ok',
});
