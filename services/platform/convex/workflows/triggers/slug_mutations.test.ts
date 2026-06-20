import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';

import schema from '../../schema';
import { isAppOwnedWorkflowSlug } from './slug_mutations';

// convex-test module map, keyed relative to the convex/ root. This file lives at
// convex/workflows/triggers/, so the glob reaches the root via ../../ and keys
// are normalized back to convex-root-relative paths.
const TEST_DIR_FROM_CONVEX_ROOT = 'workflows/triggers';
function toConvexRootKey(globKey: string): string {
  const stack: string[] = [];
  for (const part of `${TEST_DIR_FROM_CONVEX_ROOT}/${globKey}`.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  return stack.join('/');
}
const rawModules = import.meta.glob('../../**/*.*s');
const modules: Record<string, () => Promise<unknown>> = {};
for (const [key, loader] of Object.entries(rawModules)) {
  modules[toConvexRootKey(key)] = loader;
}

// Pure db-level test of the app-ownership guard used by createEventSubscriptionBySlug
// (the manual/Automations path). Uses t.run only — no auth-gated function calls —
// so it sidesteps the convex-test betterAuth/org component limitation.
const ORG = 'org_slugguard';

describe('isAppOwnedWorkflowSlug', () => {
  it('flags an installed app composite slug, but not global/bundle/bare slugs', async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert('appInstallations', {
        organizationId: ORG,
        appSlug: 'issue-desk',
        installedAt: 0,
        installedBy: 'system',
        status: 'active',
        requiredIntegrations: [],
        resources: [],
      });
    });

    await t.run(async (ctx) => {
      // App-owned composite slug for an installed app → guarded.
      expect(
        await isAppOwnedWorkflowSlug(ctx, ORG, 'issue-desk/desk-process'),
      ).toBe(true);
      // Global + integration-bundle workflows have a non-app leading segment.
      expect(
        await isAppOwnedWorkflowSlug(ctx, ORG, 'tasks/unassigned-triage'),
      ).toBe(false);
      expect(await isAppOwnedWorkflowSlug(ctx, ORG, 'github/sync-issues')).toBe(
        false,
      );
      // A bare (non-composite) slug is never app-owned.
      expect(await isAppOwnedWorkflowSlug(ctx, ORG, 'standalone')).toBe(false);
      // The app must be installed IN THIS org — a different org isn't guarded.
      expect(
        await isAppOwnedWorkflowSlug(
          ctx,
          'org_other',
          'issue-desk/desk-process',
        ),
      ).toBe(false);
    });
  });
});
