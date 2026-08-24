/**
 * Boundary regression for the stale/empty-org error class (GlitchTip
 * TALE-PROJECT-OU / -VB / -VD): org-scoped public queries reached the RLS
 * membership gate with `organizationId: ""` (empty persisted org context) or
 * a deleted org's id, and the gate's raw `UnauthorizedError` surfaced to
 * clients as an opaque, redacted "Server Error" they retried forever.
 *
 * Locks the whole chain at the public-function boundary: the argument passes
 * `v.string()`, the gate classifies the miss, and the rejection that crosses
 * the boundary is a structured ConvexError carrying `code: 'ORG_NOT_FOUND'`
 * — the code the client-side recovery (app/lib/org-error-recovery.ts)
 * dispatches on.
 */

import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { api } from '../_generated/api';
import betterAuthSchema from '../betterAuth/schema';
import schema from '../schema';

// convex-test module map keyed relative to the convex/ root (this file is at
// convex/governance/), mirroring tasks/stats.test.ts.
const TEST_DIR_FROM_CONVEX_ROOT = 'governance';
function toConvexRootKey(globKey: string): string {
  const stack: string[] = [];
  for (const part of `${TEST_DIR_FROM_CONVEX_ROOT}/${globKey}`.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  return stack.join('/');
}
const authModules = import.meta.glob('../betterAuth/**/*.*s');
const rawModules = import.meta.glob('../**/*.*s');
const modules: Record<string, () => Promise<unknown>> = {};
for (const [key, loader] of Object.entries(rawModules)) {
  modules[toConvexRootKey(key)] = loader;
}

const IDENTITY = {
  subject: 'user_stale_org',
  email: 'stale-org@example.com',
  name: 'Stale Org Tester',
};

// Syntactically valid Better Auth org id with no organization row behind it —
// the shape a client keeps polling after its persisted active org is deleted.
const DELETED_ORG_ID = 'jh7csd7ks8740bza6qsxbz6sph7yegh2';

type T = TestConvex<typeof schema>;

function newT(): T {
  const t = convexTest(schema, modules);
  t.registerComponent('betterAuth', betterAuthSchema, authModules);
  return t;
}

/**
 * The `{ code }` payload of a ConvexError rejection. The runtime serializes
 * `data` to a JSON string when the error crosses a function boundary
 * (`serializeConvexErrorData`), so accept both shapes.
 */
function thrownConvexErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  if (!(Symbol.for('ConvexError') in error)) return undefined;
  const data = (error as { data?: unknown }).data;
  if (typeof data === 'string') {
    try {
      const parsed: unknown = JSON.parse(data);
      if (typeof parsed === 'object' && parsed !== null && 'code' in parsed) {
        const code = (parsed as { code?: unknown }).code;
        return typeof code === 'string' ? code : undefined;
      }
    } catch (parseError) {
      console.warn('unparseable ConvexError data', parseError);
    }
    return undefined;
  }
  if (typeof data === 'object' && data !== null && 'code' in data) {
    const code = (data as { code?: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected promise to reject');
}

describe('org-scoped query boundary with a stale org context', () => {
  it('rejects an empty organizationId as structured ORG_ID_REQUIRED', async () => {
    const t = newT();

    const error = await rejection(
      t.withIdentity(IDENTITY).query(api.governance.queries.getPolicy, {
        organizationId: '',
        policyType: 'session_idle_timeout',
      }),
    );

    // Distinct from ORG_NOT_FOUND on purpose: an in-app component racing its
    // data can transiently send "" (observed via the task modal in the E2E
    // project specs), and the client's dead-org recovery must not treat that
    // as a dead persisted org and navigate the tab away.
    expect(thrownConvexErrorCode(error)).toBe('ORG_ID_REQUIRED');
  });

  it('rejects a deleted org id as structured ORG_NOT_FOUND, not "not a member"', async () => {
    const t = newT();

    const error = await rejection(
      t.withIdentity(IDENTITY).query(api.governance.queries.getPolicy, {
        organizationId: DELETED_ORG_ID,
        policyType: 'session_idle_timeout',
      }),
    );

    expect(thrownConvexErrorCode(error)).toBe('ORG_NOT_FOUND');
  });

  it('getCurrentMemberContext folds the same misses into status not_found', async () => {
    const t = newT();

    await expect(
      t
        .withIdentity(IDENTITY)
        .query(api.members.queries.getCurrentMemberContext, {
          organizationId: '',
        }),
    ).resolves.toEqual({ status: 'not_found' });

    await expect(
      t
        .withIdentity(IDENTITY)
        .query(api.members.queries.getCurrentMemberContext, {
          organizationId: DELETED_ORG_ID,
        }),
    ).resolves.toEqual({ status: 'not_found' });
  });
});
