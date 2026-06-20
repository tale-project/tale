import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';

import schema from '../../schema';
import {
  appOwnerOfWorkflowSlug,
  isAppOwnedWorkflowSlug,
} from './slug_mutations';

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

// Pure db-level test of the app-ownership resolver used by
// createEventSubscriptionBySlug (the manual/Automations path). Ownership is the
// RECORDED `appSlug` on the wfInstallations row — not a slug-prefix heuristic —
// so these tests seed install rows, not appInstallations. Uses t.run only (no
// auth-gated calls) to sidestep the convex-test betterAuth/org limitation.
const ORG = 'org_slugguard';

describe('appOwnerOfWorkflowSlug / isAppOwnedWorkflowSlug', () => {
  it('reports the recorded owner, never derives it from the slug', async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const insert = (workflowSlug: string, appSlug?: string) =>
        ctx.db.insert('wfInstallations', {
          organizationId: ORG,
          workflowSlug,
          installedAt: 0,
          installedBy: 'system',
          contentHash: 'h',
          ...(appSlug !== undefined ? { appSlug } : {}),
        });
      // An app workflow — its install row records the owning app.
      await insert('issue-desk/desk-process', 'issue-desk');
      // Global/bundle workflows — install rows with NO appSlug.
      await insert('tasks/unassigned-triage');
      await insert('standalone');
      // The reliability case the old slug-prefix heuristic got WRONG: a global
      // workflow foldered like an app. Recorded ownership says it's NOT app-owned.
      await insert('issue-desk/legacy-global');
    });

    await t.run(async (ctx) => {
      // Recorded owner is returned verbatim.
      expect(
        await appOwnerOfWorkflowSlug(ctx, ORG, 'issue-desk/desk-process'),
      ).toBe('issue-desk');
      expect(
        await isAppOwnedWorkflowSlug(ctx, ORG, 'issue-desk/desk-process'),
      ).toBe(true);

      // Global workflows: no recorded owner.
      expect(
        await appOwnerOfWorkflowSlug(ctx, ORG, 'tasks/unassigned-triage'),
      ).toBeNull();
      expect(await appOwnerOfWorkflowSlug(ctx, ORG, 'standalone')).toBeNull();

      // Folder name collides with an app slug, but the row has no appSlug → NOT
      // owned (the bug the old heuristic had).
      expect(
        await appOwnerOfWorkflowSlug(ctx, ORG, 'issue-desk/legacy-global'),
      ).toBeNull();
      expect(
        await isAppOwnedWorkflowSlug(ctx, ORG, 'issue-desk/legacy-global'),
      ).toBe(false);

      // No install row at all → not owned.
      expect(
        await appOwnerOfWorkflowSlug(ctx, ORG, 'never/installed'),
      ).toBeNull();

      // Ownership is per-org: another org's lookup sees no row.
      expect(
        await appOwnerOfWorkflowSlug(
          ctx,
          'org_other',
          'issue-desk/desk-process',
        ),
      ).toBeNull();
    });
  });
});
