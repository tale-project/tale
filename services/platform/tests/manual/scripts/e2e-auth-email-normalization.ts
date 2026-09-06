/**
 * Live-stack e2e for auth email normalization (Phase 1).
 *
 * Prerequisites: platform dev stack running (`bun dev`) on loopback.
 *
 *   bun services/platform/tests/manual/scripts/e2e-auth-email-normalization.ts
 *
 * Exercises:
 * 1. Vitest unit/connector suite for normalization + merge + SCIM mappers
 * 2. provisionUser (lowercase) + provisionUser (mixed case) → single user row
 * 3. Global lowercase user + SCIM HTTP POST (mixed userName) → attach, no duplicate
 */

import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PLATFORM_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
);
const CONVEX_URL = process.env.CONVEX_URL ?? 'http://127.0.0.1:3210';
const SCIM_BASE = process.env.VITE_CONVEX_SITE_URL ?? 'http://127.0.0.1:3211';
const ORG_ID = process.env.E2E_ORG_ID ?? 'jn76fq3jc2s6wzpkwhjjf898c189svkf';

function run(
  cmd: string,
  args: string[],
  opts: { cwd?: string; input?: string } = {},
): { ok: boolean; stdout: string; stderr: string } {
  const result = spawnSync(cmd, args, {
    cwd: opts.cwd ?? PLATFORM_ROOT,
    encoding: 'utf8',
    input: opts.input,
    env: process.env,
  });
  return {
    ok: result.status === 0,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function parseConvexRunOutput(stdout: string): unknown {
  const trimmed = stdout.trim();
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const start = trimmed.search(/[{[]/);
    if (start >= 0) {
      return JSON.parse(trimmed.slice(start)) as unknown;
    }
    throw new Error(`Could not parse convex run output:\n${stdout}`);
  }
}

function convexRun(
  functionPath: string,
  args: Record<string, unknown>,
): unknown {
  const res = run('bunx', [
    'convex',
    'run',
    '--url',
    CONVEX_URL,
    functionPath,
    JSON.stringify(args),
  ]);
  if (!res.ok) {
    throw new Error(
      `convex run ${functionPath} failed:\n${res.stderr}\n${res.stdout}`,
    );
  }
  return parseConvexRunOutput(res.stdout);
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function randomHex(bytes: number): string {
  return randomBytes(bytes).toString('hex');
}

async function scimPostUser(
  token: string,
  userName: string,
  displayName: string,
): Promise<{ status: number; body: unknown; userId?: string }> {
  const res = await fetch(`${SCIM_BASE}/scim/v2/Users`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/scim+json',
    },
    body: JSON.stringify({
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
      userName,
      displayName,
      active: true,
    }),
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text) as unknown;
  } catch {
    // keep raw text
  }
  const userId =
    typeof body === 'object' &&
    body !== null &&
    'id' in body &&
    typeof body.id === 'string'
      ? (body as { id: string }).id
      : undefined;
  return { status: res.status, body, userId };
}

async function main(): Promise<void> {
  console.log(
    '=== Phase A: vitest (normalization / SCIM / merge / migration) ===',
  );
  const vitest = run('bun', [
    'run',
    'test',
    '--',
    'convex/lib/auth',
    'convex/scim/mappers.email.test.ts',
  ]);
  process.stdout.write(vitest.stdout);
  process.stderr.write(vitest.stderr);
  assert(vitest.ok, 'Vitest suite failed');

  const suffix = `${Date.now().toString(36)}-${randomHex(4)}`;
  const lowerEmail = `e2e-email-norm-${suffix}@tale.test`;
  const mixedEmail = `E2E-Email-Norm-${suffix}@Tale.test`;
  const scimToken = `scim_${randomHex(32)}`;

  console.log(
    '\n=== Phase B: provisionUser (lowercase) + provisionUser (mixed case) ===',
  );
  console.log(`  email (lower): ${lowerEmail}`);
  console.log(`  email (mixed): ${mixedEmail}`);

  const first = convexRun('scim/internal_mutations:provisionUser', {
    organizationId: ORG_ID,
    defaultRole: 'member',
    email: lowerEmail,
    name: 'SCIM Lowercase Seed',
    active: true,
  }) as { userId: string; email: string };

  assert(
    first.email === lowerEmail,
    `First provision email not normalized: ${first.email}`,
  );

  const provisioned = convexRun('scim/internal_mutations:provisionUser', {
    organizationId: ORG_ID,
    defaultRole: 'member',
    email: mixedEmail,
    name: 'SCIM Mixed Case',
    active: true,
  }) as { userId: string; email: string };

  assert(
    provisioned.userId === first.userId,
    `provisionUser created duplicate: first=${first.userId} mixed=${provisioned.userId}`,
  );
  assert(
    provisioned.email === lowerEmail,
    `provisionUser email not normalized: ${provisioned.email}`,
  );

  const afterProvision = convexRun(
    'lib/auth/e2e_harness:countAuthUsersByNormalizedEmail',
    { email: mixedEmail },
  ) as { count: number; userIds: string[] };
  assert(
    afterProvision.count === 1,
    `Expected 1 user after provisionUser, got ${afterProvision.count}: ${afterProvision.userIds.join(', ')}`,
  );

  console.log('  ✓ second provisionUser reused first user (no duplicate row)');

  console.log(
    '\n=== Phase C: global user (lowercase) + SCIM HTTP POST (mixed case) ===',
  );
  convexRun('lib/auth/e2e_harness:seedScimBearerToken', {
    organizationId: ORG_ID,
    token: scimToken,
  });

  const httpEmailSuffix = `${Date.now().toString(36)}-${randomHex(3)}`;
  const httpLower = `e2e-scim-http-${httpEmailSuffix}@tale.test`;
  const httpMixed = `E2E-SCIM-HTTP-${httpEmailSuffix}@Tale.test`;

  const httpSeed = convexRun('lib/auth/e2e_harness:seedAuthUserForE2E', {
    email: httpLower,
    name: 'SCIM HTTP Seed',
  }) as { userId: string; email: string };
  const httpSignupId = httpSeed.userId;
  console.log(`  seeded global userId: ${httpSignupId}`);

  const scimRes = await scimPostUser(scimToken, httpMixed, 'SCIM HTTP Mixed');
  assert(
    scimRes.status === 201 || scimRes.status === 200,
    `SCIM POST failed (${scimRes.status}): ${JSON.stringify(scimRes.body)}`,
  );
  assert(
    scimRes.userId === httpSignupId,
    `SCIM HTTP created duplicate user: signup=${httpSignupId} scim=${scimRes.userId}`,
  );

  const httpAfter = convexRun(
    'lib/auth/e2e_harness:countAuthUsersByNormalizedEmail',
    { email: httpMixed },
  ) as { count: number; userIds: string[]; emails: string[] };
  assert(
    httpAfter.count === 1,
    `SCIM HTTP left ${httpAfter.count} users: ${httpAfter.emails.join(', ')}`,
  );

  console.log('  ✓ SCIM HTTP reused signup user (no duplicate row)');

  console.log('\n=== Phase D: migrations:check ===');
  const mig = run('bun', ['run', 'migrations:check']);
  process.stdout.write(mig.stdout);
  assert(mig.ok, 'migrations:check failed');

  console.log('\n✅ All e2e checks passed.');
  console.log(`   Test emails: ${lowerEmail}, ${httpLower}`);
}

main().catch((error) => {
  console.error('\n❌ E2E failed:', error);
  process.exit(1);
});
