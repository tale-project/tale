#!/usr/bin/env bun
// =============================================================================
// Tale — Container Migrations E2E
// =============================================================================
// The REAL-STACK layer of the migration integrity proof (the fast layer is
// convex/migrations/testing/chain.test.ts): boots the actual compose stack,
// injects the baseline world corpus into the LIVE deployment (DB rows
// through the shipped `migrations/testing/support:seedWorld` action, config
// trees docker-cp'd into the convex volume), then drives the exact operator
// surface — `migrations:runAll` (the deploy hook: safe-only, destructive
// skipped) and `migrations/framework/entrypoints:applyUp/applyDown` (the
// `tale migrate` payloads, over the CLI's sentinel-framed transport) — and
// requires the world digest after the full rollback to equal the digest
// captured after seeding, byte for byte.
//
// Tiers:
//   tier 1 (default)           current images; old STATE injected post-boot.
//                              Covers the real backend (pagination cursors,
//                              OCC, _storage, the betterAuth component, node
//                              actions on the volume) + the wire surface.
//   tier 2 (MIGRATIONS_E2E_FROM=<tag>)
//                              boots the OLD images first, seeds natively,
//                              then recreates convex+platform on the current
//                              version — the entrypoint performs the REAL
//                              upgrade incl. push-time schema validation over
//                              existing old rows, the one assertion the
//                              convex-test layer structurally cannot make.
//
// NEVER run this beside a live dev stack: compose.yml pins container names
// (tale-convex, tale-platform, …), so the project would collide with the
// developer's running containers. CI owns execution (migrations-e2e.yml).
//
// Environment variables:
//   MIGRATIONS_E2E_FROM  - old image tag for tier 2 (default: tier 1)
//   SMOKE_TEST_TIMEOUT   - max seconds to wait for services (default: 420)
//   SKIP_BUILD           - 'true' to skip docker compose build
//   KEEP_RUNNING         - 'true' to skip teardown (debugging)
// =============================================================================
import { existsSync, rmSync } from 'node:fs';
import { copyFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  buildConvexRunScript,
  parseSentinelJson,
} from '../../../../tools/cli/src/lib/docker/convex-run';
import { BASELINE_VERSION } from '../../convex/migrations/framework/baseline';
import {
  digestFs,
  diffWorldDigests,
  digestDb,
  type WorldDigest,
} from '../../convex/migrations/testing/digest.testkit';
import {
  WORLD_ORGS,
  baselineTables,
  produces,
} from '../../convex/migrations/testing/world/manifest.testkit';
import { WORLD_ENCRYPTION_SECRET_HEX } from '../../convex/migrations/testing/world/seed_db.testkit';
import { seedWorldFs } from '../../convex/migrations/testing/world/seed_fs.testkit';
import {
  Compose,
  composeArgs,
  healthStatus,
  httpStatus,
  nowSec,
  recreateNetwork,
  removeNetwork,
  sleep,
} from './lib/docker';
import { capture, projectRoot } from './lib/exec';
import { BOLD, GREEN, header, NC, RED, Results, YELLOW } from './lib/log';

const PROJECT_ROOT = projectRoot();
const TIMEOUT = Number(process.env.SMOKE_TEST_TIMEOUT ?? 420);
const FROM_VERSION = process.env.MIGRATIONS_E2E_FROM ?? '';
const SANDBOX_NET = 'tale-sandbox-net';
const PLATFORM = 'tale-platform';
const CONVEX = 'tale-convex';
const CONVEX_DATA_DIR = '/app/data';
const BASELINE = BASELINE_VERSION;

const compose = new Compose(
  composeArgs({
    files: ['compose.yml', 'compose.test.yml'],
    envFile: '.env.test',
    project: 'tale-migtest',
  }),
  PROJECT_ROOT,
);

const r = new Results();
let createdEnv = false;
let worldFsDir = '';
let beforeDir = '';
let afterDir = '';

/** pass/fail with an optional detail dump on failure. */
function check(name: string, ok: boolean, detail = ''): boolean {
  if (ok) {
    r.pass(name);
  } else {
    r.fail(name);
    if (detail) console.log(`    ${YELLOW}${detail}${NC}`);
  }
  return ok;
}

// ---------------------------------------------------------------------------
// Wire helpers — the CLI's sentinel transport, replayed verbatim
// ---------------------------------------------------------------------------

async function convexRun<T>(
  fn: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const script = buildConvexRunScript(fn, { args, timeoutS: 1200 });
  const res = await capture(['docker', 'exec', '-i', PLATFORM, 'bash', '-s'], {
    stdin: script,
  });
  if (res.exitCode !== 0) {
    throw new Error(
      `convex run ${fn} failed (exit ${res.exitCode}):\n${res.stderr.slice(-2000)}`,
    );
  }
  const value = parseSentinelJson<T>(res.stdout);
  if (value === null) {
    throw new Error(`convex run ${fn}: no parseable sentinel frame`);
  }
  return value;
}

/** Collector for digestDb that reads rows over the wire via dumpTables. */
function wireCollector(): (
  table: string,
) => Promise<Array<Record<string, unknown>>> {
  return async (table: string) => {
    const dump = await convexRun<
      Record<string, Array<Record<string, unknown>>>
    >('migrations/testing/support:dumpTables', { tables: [table] });
    return dump[table] ?? [];
  };
}

/** All tables the world can hold rows in — baseline + mid-chain produced. */
function worldTableSet(): string[] {
  return [...new Set([...baselineTables, ...Object.values(produces).flat()])];
}

async function captureWorldDigest(copyTo: string): Promise<WorldDigest> {
  // Config trees: copy the volume contents out and digest locally with the
  // same code the chain harness uses (central exemptions included).
  await rm(copyTo, { recursive: true, force: true });
  const cp = await capture([
    'docker',
    'cp',
    `${CONVEX}:${CONVEX_DATA_DIR}/.`,
    copyTo,
  ]);
  if (cp.exitCode !== 0) {
    throw new Error(`docker cp out failed: ${cp.stderr}`);
  }
  // The backend keeps its own operational files (backend.log, SQLite) in a
  // `convex/` dir beside the org config trees; its log grows between the
  // before/after captures and is not world state — drop it from the copy.
  // Every org tree (incl. the provisioned default org) stays in the digest.
  await rm(path.join(copyTo, 'convex'), { recursive: true, force: true });
  return {
    db: await digestDb(worldTableSet(), wireCollector()),
    fs: await digestFs(copyTo),
  };
}

// ---------------------------------------------------------------------------
// Stack lifecycle
// ---------------------------------------------------------------------------

async function waitHealthy(name: string): Promise<boolean> {
  const start = nowSec();
  for (;;) {
    if ((await healthStatus(name)) === 'healthy') return true;
    if (nowSec() - start > TIMEOUT) return false;
    await sleep(3000);
  }
}

async function upStack(version: string | undefined): Promise<void> {
  const env: Record<string, string> = {};
  if (version) {
    env.VERSION = version;
    env.PULL_POLICY = 'always';
  }
  const code = await compose.run(['up', '-d'], { env });
  if (code !== 0) throw new Error('compose up failed');
  if (!(await waitHealthy(CONVEX)) || !(await waitHealthy(PLATFORM))) {
    throw new Error(`stack did not become healthy within ${TIMEOUT}s`);
  }
}

async function cleanup(failing: boolean): Promise<void> {
  if (worldFsDir) await rm(worldFsDir, { recursive: true, force: true });
  if (beforeDir) await rm(beforeDir, { recursive: true, force: true });
  if (afterDir) await rm(afterDir, { recursive: true, force: true });
  if (process.env.KEEP_RUNNING === 'true') {
    console.log(`${YELLOW}KEEP_RUNNING=true — skipping teardown${NC}`);
    return;
  }
  if (failing) {
    header('Container state on failure');
    await compose.run(['ps', '-a']);
    header('Container logs (last 200 lines per service) on failure');
    await compose.run(['logs', '--tail=200', '--no-color']);
  }
  header('Tearing down migration e2e containers');
  await compose.down();
  await removeNetwork(SANDBOX_NET);
  if (createdEnv) rmSync(`${PROJECT_ROOT}/.env`, { force: true });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<number> {
  await compose.down();
  await recreateNetwork(SANDBOX_NET, [
    '--internal',
    '--ipv6=false',
    '--driver=bridge',
  ]);
  if (!existsSync(`${PROJECT_ROOT}/.env`)) {
    copyFileSync(`${PROJECT_ROOT}/.env.test`, `${PROJECT_ROOT}/.env`);
    createdEnv = true;
  }

  if (FROM_VERSION) {
    // Tier 2 cannot cross the 0.4 baseline: the history reset removed the
    // upgrade path, and the current entrypoint's breaking-cutover backstop
    // would (correctly) refuse to boot over the old volume. Fail fast with
    // the real reason instead of timing out on a health wait.
    const fromParts = FROM_VERSION.split('.').map(Number);
    const baseParts = BASELINE_VERSION.split('.').map(Number);
    const crossesBaseline =
      fromParts[0] < baseParts[0] ||
      (fromParts[0] === baseParts[0] && fromParts[1] < baseParts[1]) ||
      (fromParts[0] === baseParts[0] &&
        fromParts[1] === baseParts[1] &&
        fromParts[2] < baseParts[2]);
    if (crossesBaseline) {
      throw new Error(
        `MIGRATIONS_E2E_FROM=${FROM_VERSION} predates the ${BASELINE_VERSION} baseline — ` +
          'there is no upgrade path across the 0.4 breaking cutover; pick a >= ' +
          `${BASELINE_VERSION} tag (or run tier 1).`,
      );
    }
    header(`Tier 2 — booting OLD stack ${FROM_VERSION}`);
    await upStack(FROM_VERSION);
  } else {
    if (process.env.SKIP_BUILD !== 'true') {
      header('Building Docker images');
      if ((await compose.run(['build', '--parallel'])) !== 0) {
        console.error(`${RED}Build failed${NC}`);
        return 1;
      }
    }
    header('Tier 1 — booting current stack');
    await upStack(undefined);
  }

  // The corpus's JWE fixtures are frozen under the world key; decrypting
  // migrations (0.2.87/01) read the key the entrypoint pushed into the
  // deployment from .env.test. Fail fast on drift — the alternative is a bare
  // JWEDecryptionFailed deep inside applyUp. ENCRYPTION_SECRET must stay
  // unset: getSecretKey() prefers it over ENCRYPTION_SECRET_HEX.
  const stackKey = await capture([
    'docker',
    'exec',
    PLATFORM,
    'printenv',
    'ENCRYPTION_SECRET_HEX',
  ]);
  if (stackKey.stdout.trim() !== WORLD_ENCRYPTION_SECRET_HEX) {
    throw new Error(
      'the migtest stack must boot with the world corpus encryption key — ' +
        'set ENCRYPTION_SECRET_HEX in .env.test to WORLD_ENCRYPTION_SECRET_HEX ' +
        '(convex/migrations/testing/world/seed_db.testkit.ts)',
    );
  }
  const stackB64Key = await capture([
    'docker',
    'exec',
    PLATFORM,
    'printenv',
    'ENCRYPTION_SECRET',
  ]);
  if (stackB64Key.exitCode === 0) {
    throw new Error(
      'the migtest stack must not set ENCRYPTION_SECRET — it shadows the ' +
        'world corpus key in ENCRYPTION_SECRET_HEX (getSecretKey precedence)',
    );
  }

  // --- Inject the baseline world ------------------------------------------
  header(
    'Seeding the baseline world (DB via support:seedWorld, files via docker cp)',
  );
  worldFsDir = await mkdtemp(path.join(tmpdir(), 'tale-migtest-world-'));
  await seedWorldFs(worldFsDir);
  for (const org of Object.values(WORLD_ORGS)) {
    const cp = await capture([
      'docker',
      'cp',
      `${worldFsDir}/${org.slug}`,
      `${CONVEX}:${CONVEX_DATA_DIR}/`,
    ]);
    check(`config tree ${org.slug} copied`, cp.exitCode === 0, cp.stderr);
  }
  const orgs = await convexRun<{
    alpha: { id: string };
    beta: { id: string };
    empty: { id: string };
  }>('migrations/testing/support:seedWorld');
  check(
    'world seeded with three distinct orgs',
    new Set([orgs.alpha.id, orgs.beta.id, orgs.empty.id]).size === 3,
  );

  beforeDir = await mkdtemp(path.join(tmpdir(), 'tale-migtest-before-'));
  afterDir = await mkdtemp(path.join(tmpdir(), 'tale-migtest-after-'));
  const seedDigest = await captureWorldDigest(beforeDir);

  // --- The operator surface ------------------------------------------------
  interface StatusShape {
    pending: Array<{ id: string; destructive: boolean }>;
    pendingDestructive: string[];
    failed?: Array<{ id: string }>;
  }
  let status = await convexRun<StatusShape>(
    'migrations/framework/entrypoints:status',
  );
  const totalPending = status.pending.length;
  // The registry starts EMPTY at the 0.4 baseline; the counts grow with the
  // first post-baseline migrations and this stays valid either way.
  check(
    `status reports every registered migration pending (${totalPending})`,
    status.pending.length === totalPending,
  );
  check(
    'no pre-baseline ledger rows on a freshly seeded world',
    (
      await convexRun<{ count: number }>(
        'migrations/framework/entrypoints:preBaselineLedger',
      )
    ).count === 0,
  );

  if (FROM_VERSION) {
    header(
      'Tier 2 — recreating convex+platform on the CURRENT version (real upgrade)',
    );
    const code = await compose.run(
      ['up', '-d', '--force-recreate', '--no-deps', 'convex', 'platform'],
      { env: {} },
    );
    if (code !== 0) throw new Error('upgrade recreate failed');
    if (!(await waitHealthy(CONVEX)) || !(await waitHealthy(PLATFORM))) {
      throw new Error('upgraded stack did not become healthy');
    }
    // The entrypoint already ran deploy (push validation over OLD rows) +
    // migrations:runAll (safe-only). Nothing to invoke — just verify below.
  } else {
    header('Deploy hook: migrations:runAll (safe-only)');
    const runAll = await convexRun<{
      ok: boolean;
      applied: string[];
      destructivePending: string[];
    }>('migrations:runAll');
    check('runAll succeeded', runAll.ok, JSON.stringify(runAll));
    check(
      'runAll never auto-applies destructive migrations',
      runAll.applied.length <= totalPending &&
        runAll.applied.every((id) => !status.pendingDestructive.includes(id)),
      JSON.stringify(runAll),
    );
  }

  header('Operator apply: applyUp --yes (destructive allowed)');
  const up = await convexRun<{ completed: string[]; skipped: unknown[] }>(
    'migrations/framework/entrypoints:applyUp',
    { allowDestructive: true },
  );
  status = await convexRun<StatusShape>(
    'migrations/framework/entrypoints:status',
  );
  check(
    'chain fully applied (no pending, none failed)',
    status.pending.length === 0 && (status.failed ?? []).length === 0,
    `completed now: ${up.completed.length}; pending: ${status.pending.length}`,
  );

  header('Post-up verification (app + data + files)');
  const platformHttp = await httpStatus('http://localhost:13000/', 30);
  check(
    `platform serves after the chain (HTTP ${platformHttp})`,
    platformHttp === '200',
  );
  const spot = await convexRun<Record<string, Array<Record<string, unknown>>>>(
    'migrations/testing/support:dumpTables',
    { tables: ['tasks', 'workflows', 'taskAgentRuns', 'wfExecutions'] },
  );
  check('corpus rows survive the chain', (spot.tasks ?? []).length > 0);
  check(
    'deferred-drop tables stay empty (manifest deferredDropsEmpty)',
    (spot.taskAgentRuns ?? []).length === 0 &&
      (spot.wfExecutions ?? []).length === 0,
  );

  header(`Operator rollback: applyDown --to ${BASELINE}`);
  const down = await convexRun<{ completed: string[] }>(
    'migrations/framework/entrypoints:applyDown',
    { to: BASELINE },
  );
  check(
    `down rolled back every applied migration (${down.completed.length})`,
    down.completed.length === up.completed.length,
  );

  header('Data integrity: post-down digest equals the seeded digest');
  const downDigest = await captureWorldDigest(afterDir);
  const diff = diffWorldDigests(seedDigest, downDigest);
  check(
    'world restored byte-for-byte (digest equality)',
    diff.length === 0,
    diff.slice(0, 20).join('\n'),
  );

  r.printSummary({
    title: 'MIGRATIONS E2E RESULTS',
    nameWidth: 55,
    statusWord: true,
    successBanner: FROM_VERSION
      ? `UPGRADE ${FROM_VERSION} → current: chain integrity holds`
      : 'MIGRATION CHAIN INTEGRITY HOLDS ON THE REAL STACK',
  });
  return r.failed === 0 ? 0 : 1;
}

let exitCode = 1;
try {
  exitCode = await main();
} catch (err) {
  console.error(`${RED}${BOLD}migrations e2e crashed:${NC}`, err);
  exitCode = 1;
} finally {
  await cleanup(exitCode !== 0);
}
console.log(
  exitCode === 0
    ? `${GREEN}${BOLD}migrations e2e passed${NC}`
    : `${RED}${BOLD}migrations e2e FAILED${NC}`,
);
process.exit(exitCode);
