'use node';

/**
 * Convex internal IO shim for area-specific JSON config files.
 *
 * The ONLY `'use node'` action file in the file-based-config feature.
 * V8 callers (queries / mutations / V8 actions) cannot read fs directly;
 * they delegate to these internal actions via `ctx.runAction(...)`.
 *
 * Future areas (provider, integration, ...) add their internal actions
 * here too, instead of scattering `'use node'` directives across
 * separate files. Keep these thin — no business logic, no auth.
 */

import { v } from 'convex/values';

import type { RetentionDefaultsConfig } from '../../../lib/shared/schemas/retention';
import { retentionDefaultsConfigSchema } from '../../../lib/shared/schemas/retention';
import { internalAction } from '../../_generated/server';
import { createFileConfigStore } from './store';

const retentionStore = createFileConfigStore<RetentionDefaultsConfig>(
  'retention',
  retentionDefaultsConfigSchema,
);

export const readRetentionConfig = internalAction({
  args: { orgSlug: v.string() },
  returns: v.union(v.null(), v.any()),
  handler: async (_ctx, args): Promise<RetentionDefaultsConfig | null> => {
    return retentionStore.read(args.orgSlug);
  },
});
