import { convexTest, type TestConvex } from 'convex-test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { internal } from '../_generated/api';
import schema from '../schema';

// convex-test module map keyed relative to the convex/ root. This file lives
// at convex/audit_logs/, so resolve glob keys against that base (mirrors
// append_only.test.ts / integrity_check.test.ts).
const TEST_DIR_FROM_CONVEX_ROOT = 'audit_logs';
function toConvexRootKey(globKey: string): string {
  const stack: string[] = [];
  for (const part of `${TEST_DIR_FROM_CONVEX_ROOT}/${globKey}`.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  return stack.join('/');
}
const rawModules = import.meta.glob('../**/*.*s');
const modules: Record<string, () => Promise<unknown>> = {};
for (const [key, loader] of Object.entries(rawModules)) {
  modules[toConvexRootKey(key)] = loader;
}

const ORG = 'org_audit_scrub_verify';
const SUBJECT = 'user_subject_to_erase';
const ADMIN = 'user_admin_actor';
const SIGNING_KEY = 'test-audit-signing-key-1843';

type T = TestConvex<typeof schema>;

// Row where the erased subject is the ACTOR (their own activity) — pass 1.
async function seedActorRow(t: T, action: string): Promise<void> {
  await t.mutation(internal.audit_logs.internal_mutations.createAuditLog, {
    organizationId: ORG,
    actorId: SUBJECT,
    actorEmail: 'subject@example.com',
    actorType: 'user',
    action,
    category: 'data',
    resourceType: 'customer',
    resourceId: 'cust_1',
    status: 'success',
    newState: { name: 'Secret Subject' },
  });
}

// Row an ADMIN authored ABOUT the subject (`resourceType: 'user'`,
// `resourceId: <subject>`) — pass 2. This is the row the false-alarm bug
// (#1843) hinges on: the GDPR erasure flow always writes at least one
// (`gdpr_erasure_requested`).
async function seedResourceRow(t: T, action: string): Promise<void> {
  await t.mutation(internal.audit_logs.internal_mutations.createAuditLog, {
    organizationId: ORG,
    actorId: ADMIN,
    actorEmail: 'admin@example.com',
    actorType: 'user',
    action,
    category: 'admin',
    resourceType: 'user',
    resourceId: SUBJECT,
    resourceName: 'Secret Subject',
    status: 'success',
    newState: { erasureRequestedFor: SUBJECT },
  });
}

async function verify(t: T) {
  return await t.query(
    internal.audit_logs.integrity_check.verifyAuditChainForOrg,
    { organizationId: ORG },
  );
}

async function scrubbedFlagsByAction(t: T): Promise<Record<string, boolean>> {
  return await t.run(async (ctx) => {
    const flags: Record<string, boolean> = {};
    for (const r of await ctx.db.query('auditLogs').collect()) {
      if (r.organizationId === ORG) flags[r.action] = r.piiScrubbed === true;
    }
    return flags;
  });
}

// #1843: on a signed deployment, pass-2 PII scrub (admin-authored rows about
// the erased subject) blanks hash-covered fields, but the verifier looked up
// its scrub-trust window by `actorId` only — which is the admin, not the
// scrubbed subject — so pass-2 rows missed coverage and the chain falsely
// reported "hash chain broken". These tests pin the verifier's coverage to
// the scrub's own two-pass selection criteria.
describe('audit chain verification after GDPR pii scrub (signed deployment)', () => {
  let prevKey: string | undefined;

  beforeEach(() => {
    prevKey = process.env.TALE_AUDIT_SIGNING_KEY;
    process.env.TALE_AUDIT_SIGNING_KEY = SIGNING_KEY;
  });

  afterEach(() => {
    if (prevKey === undefined) delete process.env.TALE_AUDIT_SIGNING_KEY;
    else process.env.TALE_AUDIT_SIGNING_KEY = prevKey;
  });

  it('stays valid after scrubbing both actor-pass and resource-pass rows', async () => {
    const t = convexTest(schema, modules);
    // Pass-1 row (subject as actor) + pass-2 row (subject as resource) +
    // an unrelated row to keep the chain non-trivial.
    await seedActorRow(t, 'customer.update');
    await seedResourceRow(t, 'gdpr_erasure_requested');
    await t.mutation(internal.audit_logs.internal_mutations.createAuditLog, {
      organizationId: ORG,
      actorId: ADMIN,
      actorType: 'user',
      action: 'customer.view',
      category: 'data',
      resourceType: 'customer',
      resourceId: 'cust_2',
      status: 'success',
    });

    const before = await verify(t);
    expect(before.valid).toBe(true);

    await t.mutation(
      internal.audit_logs.internal_mutations.scrubSubjectAuditLogs,
      { organizationId: ORG, userId: SUBJECT },
    );

    // Both the actor-pass and resource-pass rows were scrubbed.
    const flags = await scrubbedFlagsByAction(t);
    expect(flags['customer.update']).toBe(true);
    expect(flags['gdpr_erasure_requested']).toBe(true);
    // The unrelated admin row about a different resource is untouched.
    expect(flags['customer.view']).toBe(false);

    // The signed pii_scrub checkpoint must make the verifier accept the
    // blanked bodies on BOTH passes — no false "hash chain broken".
    const after = await verify(t);
    expect(after.valid).toBe(true);
    expect(after.firstBrokenAt).toBeUndefined();
    // Coverage came from the SIGNED checkpoint, not the unsigned legacy
    // fallback (which is unreachable when a key is configured).
    expect(after.unsignedScrubCount).toBe(0);
  });

  it('stays valid when the only scrubbed row is an admin-authored pass-2 row', async () => {
    // Mirrors the minimal real-world trigger: the erasure flow always writes
    // a single `gdpr_erasure_requested` pass-2 row before scrubbing runs.
    const t = convexTest(schema, modules);
    await t.mutation(internal.audit_logs.internal_mutations.createAuditLog, {
      organizationId: ORG,
      actorId: ADMIN,
      actorType: 'user',
      action: 'customer.create',
      category: 'data',
      resourceType: 'customer',
      resourceId: 'cust_3',
      status: 'success',
    });
    await seedResourceRow(t, 'gdpr_erasure_requested');

    await t.mutation(
      internal.audit_logs.internal_mutations.scrubSubjectAuditLogs,
      { organizationId: ORG, userId: SUBJECT },
    );

    const after = await verify(t);
    expect(after.valid).toBe(true);
    expect(after.firstBrokenAt).toBeUndefined();
    expect(after.unsignedScrubCount).toBe(0);
  });
});
