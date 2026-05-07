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

export const writeRetentionConfig = internalAction({
  args: {
    orgSlug: v.string(),
    config: v.any(),
  },
  returns: v.null(),
  handler: async (_ctx, args) => {
    // Re-parse at the action boundary so the inner store.write receives
    // a validated `RetentionDefaultsConfig` instead of the `any` that
    // crosses the Convex action wire. Cheap; double-parse with the
    // store's own Zod check is acceptable for an admin-frequency path.
    const parsed = retentionDefaultsConfigSchema.safeParse(args.config);
    if (!parsed.success) {
      throw new Error(`Invalid retention config: ${parsed.error.message}`);
    }
    await retentionStore.write(args.orgSlug, parsed.data);
    return null;
  },
});

export const listRetentionConfigs = internalAction({
  args: {},
  returns: v.array(v.object({ orgSlug: v.string() })),
  handler: async () => {
    return retentionStore.list();
  },
});
