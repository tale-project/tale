#!/usr/bin/env bun
// =============================================================================
// Tale — Container Smoke Tests
// =============================================================================
// Builds all Docker images, starts services with non-conflicting ports,
// waits for health checks, validates HTTP endpoints, then tears down.
//
// Usage:
//   bun tests/container-smoke-test.ts
//   bun run docker:test
//
// Environment variables:
//   SMOKE_TEST_TIMEOUT   - Max seconds to wait for services (default: 300)
//   SKIP_BUILD           - Set to 'true' to skip docker compose build
//   KEEP_RUNNING         - Set to 'true' to skip teardown (for debugging)
// =============================================================================
import { createHash, createHmac } from 'node:crypto';
import { copyFileSync, existsSync, rmSync } from 'node:fs';

import {
  Compose,
  composeArgs,
  containerState,
  dockerExecOk,
  dockerImagesMatching,
  healthStatus,
  httpStatus,
  imageSizeHuman,
  imageSizeMb,
  nowSec,
  recreateNetwork,
  removeNetwork,
  sleep,
} from './lib/docker';
import { capture, projectRoot } from './lib/exec';
import { BOLD, CYAN, GREEN, header, NC, RED, Results, YELLOW } from './lib/log';

const PROJECT_ROOT = projectRoot();
const TIMEOUT = Number(process.env.SMOKE_TEST_TIMEOUT ?? 300);
const SANDBOX_NET = 'tale-sandbox-net';

const compose = new Compose(
  composeArgs({
    files: ['compose.yml', 'compose.test.yml'],
    envFile: '.env.test',
    project: 'tale-test',
  }),
  PROJECT_ROOT,
);

const r = new Results();
let createdEnv = false;

async function cleanup(failing: boolean): Promise<void> {
  if (process.env.KEEP_RUNNING === 'true') {
    console.log(`${YELLOW}KEEP_RUNNING=true — skipping teardown${NC}`);
    console.log(`To stop: cd ${PROJECT_ROOT} && docker compose ... down -v`);
    return;
  }
  // Dump container state + logs before teardown when exiting non-zero, so CI
  // captures them before `compose down -v` destroys them.
  if (failing) {
    header('Container state on failure');
    await compose.run(['ps', '-a']);
    header('Container logs (last 200 lines per service) on failure');
    await compose.run(['logs', '--tail=200', '--no-color']);
  }
  header('Tearing down test containers');
  await compose.down();
  // The sandbox network is declared `external:` in compose.yml — `compose
  // down` won't remove it. Drop it manually so the next run starts clean.
  await removeNetwork(SANDBOX_NET);
  // Only remove .env if we created it. Otherwise we'd clobber a developer's
  // real .env when the smoke test exits.
  if (createdEnv) rmSync(`${PROJECT_ROOT}/.env`, { force: true });
}

async function main(): Promise<number> {
  // Clean up any stale containers/volumes from previous runs.
  await compose.down();

  // Pre-create the sandbox bridge. It's declared `external:` in compose.yml
  // because the CLI owns its lifecycle — `--internal --ipv6=false` can't be
  // expressed atomically in a compose `networks:` block. Smoke tests don't go
  // through the CLI, so we create it here with the same shape
  // ensureSandboxNetwork() uses.
  await recreateNetwork(SANDBOX_NET, [
    '--internal',
    '--ipv6=false',
    '--driver=bridge',
  ]);

  // Ensure dummy .env exists to satisfy compose.yml env_file declarations.
  if (!existsSync(`${PROJECT_ROOT}/.env`)) {
    console.log(
      `  ${YELLOW}⚠ No .env file found — creating placeholder with defaults${NC}`,
    );
    copyFileSync(`${PROJECT_ROOT}/.env.test`, `${PROJECT_ROOT}/.env`);
    createdEnv = true;
  }

  // 0. Show Docker Compose version (for CI debugging)
  console.log('Docker Compose version:');
  await capture(['docker', 'compose', 'version']).then((res) =>
    console.log(res.combined.trimEnd() || '  docker compose not available'),
  );

  // 1. Build images
  if (process.env.SKIP_BUILD !== 'true') {
    header('Building Docker images');
    const buildStart = nowSec();
    if ((await compose.run(['build', '--parallel'])) !== 0) {
      console.error(`${RED}Build failed!${NC}`);
      return 1;
    }
    const buildElapsed = nowSec() - buildStart;
    console.log(
      `  ${GREEN}✓${NC} All images built in ${BOLD}${buildElapsed}s${NC}`,
    );

    // Show image sizes
    header('Docker Image Sizes');
    console.log(
      `  ${BOLD}${'SERVICE'.padEnd(15)} ${'IMAGE'.padEnd(45)} ${'SIZE'.padStart(10)}${NC}`,
    );
    console.log(
      '  ─────────────────────────────────────────────────────────────────────',
    );
    let totalSizeMb = 0;
    for (const svc of [
      'db',
      'knowledge-db',
      'convex',
      'platform',
      'proxy',
      'sandbox',
      'sandbox-egress',
    ]) {
      let img = await compose.imageFor(svc);
      let size = 'N/A';
      if (!img) {
        const matches = await dockerImagesMatching(`tale-${svc}:`);
        img = matches[0] ?? '';
      }
      if (img) {
        size = await imageSizeHuman(img);
        totalSizeMb += await imageSizeMb(img);
      } else {
        img = '(not found)';
      }
      console.log(`  ${svc.padEnd(15)} ${img.padEnd(45)} ${size.padStart(10)}`);
    }
    console.log(
      '  ─────────────────────────────────────────────────────────────────────',
    );
    console.log(
      `  ${BOLD}${'TOTAL'.padEnd(15)} ${''.padEnd(45)} ${String(totalSizeMb).padStart(8)} MB${NC}`,
    );
    console.log('');
    console.log(`  ${CYAN}Build time: ${buildElapsed}s (no-cache on CI)${NC}`);
  } else {
    console.log(`${YELLOW}Skipping build (SKIP_BUILD=true)${NC}`);
  }

  // 2. Start services
  header('Starting services');
  await compose.run(['up', '-d']);
  console.log('');
  console.log('Container status:');
  await compose.run(['ps']);

  // 3. Wait for health checks
  header(`Waiting for services to become healthy (timeout: ${TIMEOUT}s)`);

  const services = [
    'db',
    'knowledge-db',
    'convex',
    'platform',
    'proxy',
    'sandbox',
    'sandbox-egress',
    'smoke-fileserver',
  ];
  let healthFailed = false;
  for (const svc of services) {
    if (await waitForHealthy(svc)) {
      r.pass(`${svc} health check`);
    } else {
      r.fail(`${svc} health check`);
      healthFailed = true;
    }
  }

  if (healthFailed) {
    console.log('');
    console.log(`${RED}Some services failed health checks. Full logs:${NC}`);
    await compose.run(['logs', '--tail=50']);
  }

  // 4. Validate HTTP health endpoints
  header('Validating HTTP health endpoints');

  // Proxy health is on internal port 2020, not exposed — check via docker exec
  const proxyContainer = await compose.containerName('proxy');
  if (
    await dockerExecOk(proxyContainer, [
      'wget',
      '--no-verbose',
      '--tries=1',
      '--spider',
      'http://127.0.0.1:2020/health',
    ])
  ) {
    r.pass('Proxy /health (internal :2020)');
  } else {
    r.fail('Proxy /health (internal :2020)');
  }

  // DB: use pg_isready via docker exec
  const dbContainer = await compose.containerName('db');
  if (
    await dockerExecOk(dbContainer, ['pg_isready', '-U', 'tale', '-d', 'tale'])
  ) {
    r.pass('DB pg_isready');
  } else {
    r.fail('DB pg_isready');
  }

  // Knowledge DB: separate datastore (tale_knowledge) — mirror the DB check.
  const knowledgeDbContainer = await compose.containerName('knowledge-db');
  if (
    await dockerExecOk(knowledgeDbContainer, [
      'pg_isready',
      '-U',
      'tale',
      '-d',
      'tale_knowledge',
    ])
  ) {
    r.pass('Knowledge DB pg_isready');
  } else {
    r.fail('Knowledge DB pg_isready');
  }

  // Convex lives in its own container — probe it directly.
  const convexContainer = await compose.containerName('convex');
  if (
    await dockerExecOk(convexContainer, [
      'curl',
      '-sf',
      'http://localhost:3210/version',
    ])
  ) {
    r.pass('Convex backend /version');
  } else {
    r.fail('Convex backend /version');
  }
  if (
    await dockerExecOk(convexContainer, ['test', '-f', '/tmp/convex-ready'])
  ) {
    r.pass('Convex readiness marker (/tmp/convex-ready)');
  } else {
    r.fail('Convex readiness marker (/tmp/convex-ready)');
  }

  // Platform: Vite server with platform-ready marker.
  const platformContainer = await compose.containerName('platform');
  const viteCode = await httpStatus('http://localhost:13000/api/health', 10);
  if (viteCode === '200') {
    r.pass(`Platform /api/health: HTTP ${viteCode}`);
  } else {
    r.fail(`Platform /api/health: expected HTTP 200, got ${viteCode}`);
  }
  if (
    await dockerExecOk(platformContainer, ['test', '-f', '/tmp/platform-ready'])
  ) {
    r.pass('Platform readiness marker (/tmp/platform-ready)');
  } else {
    r.fail('Platform readiness marker (/tmp/platform-ready)');
  }

  // 5. Validate inter-service connectivity
  header('Validating inter-service connectivity');

  // Phase 2 critical path: Platform must reach Convex over the docker network.
  if (
    await dockerExecOk(platformContainer, [
      'curl',
      '-sf',
      'http://convex:3210/version',
    ])
  ) {
    r.pass('Platform → Convex /version connectivity');
  } else {
    r.fail('Platform → Convex /version connectivity');
  }
  // NOTE: knowledge-db reachability is covered by the `Knowledge DB pg_isready`
  // datastore check above. The Convex node-actions are the only consumer (via
  // KNOWLEDGE_DATABASE_URL); there's no HTTP endpoint to probe cross-container,
  // so we don't add a synthetic connectivity check here.

  // 6. Sandbox /v1/execute end-to-end probe
  await sandboxExecuteProbe();

  return r.failed === 0 ? 0 : 1;
}

// =============================================================================
// Health-wait helper — mirrors the bash wait_for_healthy state machine.
// =============================================================================
async function waitForHealthy(service: string): Promise<boolean> {
  const containerName = await compose.containerName(service);
  const startTime = nowSec();

  for (;;) {
    const elapsed = nowSec() - startTime;
    if (elapsed >= TIMEOUT) {
      console.log(`  ${RED}✗${NC} ${service}: timed out after ${TIMEOUT}s`);
      console.log(`  ${YELLOW}Last 20 lines of ${service} logs:${NC}`);
      const logs = await compose.capture(['logs', '--tail=20', service]);
      console.log(
        logs.combined
          .split('\n')
          .map((l) => `    ${l}`)
          .join('\n'),
      );
      return false;
    }

    const status = await healthStatus(containerName);
    switch (status) {
      case 'healthy':
        console.log(`  ${GREEN}✓${NC} ${service}: healthy (${elapsed}s)`);
        return true;
      case 'unhealthy':
        // Don't fail immediately — Docker may mark unhealthy during long
        // startup (e.g. platform Convex deploy). Keep waiting.
        process.stdout.write(
          `\r  ⏳ ${service}: unhealthy (${elapsed}s) — still waiting...          `,
        );
        await sleep(10_000);
        break;
      case 'not_found': {
        const running = await containerState(containerName);
        if (running === 'exited' || running === 'dead') {
          console.log(`  ${RED}✗${NC} ${service}: container ${running}`);
          const logs = await compose.capture(['logs', '--tail=20', service]);
          console.log(
            logs.combined
              .split('\n')
              .map((l) => `    ${l}`)
              .join('\n'),
          );
          return false;
        }
        process.stdout.write(
          `\r  ⏳ ${service}: waiting for container (${elapsed}s)...`,
        );
        await sleep(5_000);
        break;
      }
      default:
        process.stdout.write(
          `\r  ⏳ ${service}: ${status} (${elapsed}s)...          `,
        );
        await sleep(5_000);
    }
  }
}

// =============================================================================
// Sandbox /v1/execute end-to-end probe (+ negative cases).
// =============================================================================
async function sandboxExecuteProbe(): Promise<void> {
  header('Sandbox /v1/execute end-to-end');

  // Pull SANDBOX_TOKEN from .env.test rather than re-defining it.
  const envText = await Bun.file(`${PROJECT_ROOT}/.env.test`).text();
  const tokenLine = envText
    .split('\n')
    .find((l) => l.startsWith('SANDBOX_TOKEN='));
  const token = tokenLine ? tokenLine.slice('SANDBOX_TOKEN='.length) : '';
  if (!token) {
    r.fail('Sandbox e2e: SANDBOX_TOKEN missing from .env.test');
    return;
  }

  // Unique per-run executionId so re-running doesn't return 409 Duplicate.
  const execId = `smoke-${process.pid}-${nowSec()}${String(process.hrtime.bigint()).slice(-6)}`;
  // Source ships in `files[]` as a URL the spawner GETs; `smoke-fileserver`
  // (compose.test.yml) hosts a 1-line `print(1)` over the internal network.
  const body = JSON.stringify({
    executionId: execId,
    organizationId: 'smoke',
    language: 'python',
    files: [{ path: 'main.py', url: 'http://smoke-fileserver:8000/main.py' }],
    entryPath: 'main.py',
    timeoutMs: 30000,
    outputUploadSlots: [],
    outputUrlEndpoint: 'http://platform:3000/api/sandbox/output_upload_url',
    reportUploadedEndpoint: 'http://platform:3000/api/sandbox/record_uploaded',
  });
  const ts = Date.now();
  const path = '/v1/execute';
  // Signing contract (auth.ts): METHOD\npath\ntimestamp\nsha256Hex(body)
  const bodyHash = createHash('sha256').update(body).digest('hex');
  const signedString = `POST\n${path}\n${ts}\n${bodyHash}`;
  const sig = createHmac('sha256', token).update(signedString).digest('hex');
  if (!sig) {
    r.fail('Sandbox e2e: failed to compute HMAC signature');
    return;
  }

  const outFile = `${PROJECT_ROOT}/.sandbox-smoke-out.${process.pid}`;
  // The endpoint streams SSE; --max-time bounds the probe.
  const probe = await capture([
    'curl',
    '-sS',
    '-o',
    outFile,
    '-w',
    '%{http_code}',
    '--max-time',
    '60',
    '-X',
    'POST',
    '-H',
    'content-type: application/json',
    '-H',
    `x-tale-sandbox-signature: ${sig}`,
    '-H',
    `x-tale-sandbox-timestamp: ${ts}`,
    '--data-binary',
    body,
    `http://localhost:8003${path}`,
  ]);
  const httpCode = probe.exitCode === 0 ? probe.stdout.trim() || '000' : '000';
  const responseBody = existsSync(outFile)
    ? await Bun.file(outFile).text()
    : '';
  rmSync(outFile, { force: true });

  if (
    httpCode === '200' &&
    /^event: result/m.test(responseBody) &&
    responseBody.includes('"status":"completed"')
  ) {
    r.pass('Sandbox /v1/execute: completed result');
  } else {
    console.log(`  ${YELLOW}sandbox response (HTTP ${httpCode}):${NC}`);
    console.log(
      (responseBody.slice(0, 4000) || '    (empty body)')
        .split('\n')
        .map((l) => `    ${l}`)
        .join('\n'),
    );
    console.log('');
    r.fail('Sandbox /v1/execute: expected HTTP 200 + completed result');
  }

  // ---- Negative cases ----
  // Missing signature header → 401.
  const noSig = await capture([
    'curl',
    '-sS',
    '-o',
    '/dev/null',
    '-w',
    '%{http_code}',
    '--max-time',
    '10',
    '-X',
    'POST',
    '-H',
    'content-type: application/json',
    '--data-binary',
    '{"executionId":"unauth","organizationId":"smoke","language":"python","code":"print(1)"}',
    'http://localhost:8003/v1/execute',
  ]);
  const noSigCode = noSig.exitCode === 0 ? noSig.stdout.trim() || '000' : '000';
  if (noSigCode === '401') {
    r.pass('Sandbox /v1/execute: 401 without signature');
  } else {
    r.fail(
      `Sandbox /v1/execute: expected 401 without signature, got ${noSigCode}`,
    );
  }

  // 2 MB + 1 body → 413 (streaming body cap fires before HMAC check). Piped
  // via stdin (`--data-binary @-`) to dodge the kernel's MAX_ARG_STRLEN.
  const tooBig = 'x'.repeat(2_097_153);
  const oversized = await capture(
    [
      'curl',
      '-sS',
      '-o',
      '/dev/null',
      '-w',
      '%{http_code}',
      '--max-time',
      '10',
      '-X',
      'POST',
      '-H',
      'content-type: application/json',
      '--data-binary',
      '@-',
      'http://localhost:8003/v1/execute',
    ],
    { stdin: tooBig },
  );
  const oversizedCode =
    oversized.exitCode === 0 ? oversized.stdout.trim() || '000' : '000';
  if (oversizedCode === '413') {
    r.pass('Sandbox /v1/execute: 413 on oversized body');
  } else {
    r.fail(
      `Sandbox /v1/execute: expected 413 on oversized body, got ${oversizedCode}`,
    );
  }
}

// =============================================================================
// Entry
// =============================================================================
let exitCode = 0;
try {
  exitCode = await main();
} catch (err) {
  console.error(err);
  exitCode = 1;
}

r.printSummary({
  title: 'CONTAINER SMOKE TEST RESULTS',
  nameWidth: 45,
  statusWord: true,
  successBanner: '🎉 ALL CONTAINER SMOKE TESTS PASSED',
});

await cleanup(exitCode !== 0);
process.exit(exitCode);
