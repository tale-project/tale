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
      'object-store',
      'backend-api',
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

  // `backend-worker` shares the api's image but disables its healthcheck (no
  // HTTP surface), so the wait list carries only the health-checked tier.
  const services = [
    'db',
    'knowledge-db',
    'object-store',
    'backend-api',
    'platform',
    'proxy',
    'sandbox',
    'sandbox-egress',
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

  // Through-proxy platform health: the documented external readiness probe
  // ({SITE_URL}/api/health — README.md, tests/manual/SETUP.md §1C). Guards the
  // Caddyfile route: without an explicit /api/health handle the generic /api/*
  // catch-all sends it to the backend, whose 404 would fail the documented
  // probe (#2553). Self-signed cert, so
  // skip verification; busybox wget --spider fails on any non-2xx status.
  if (
    await dockerExecOk(proxyContainer, [
      'wget',
      '--no-check-certificate',
      '--no-verbose',
      '--tries=1',
      '--spider',
      'https://localhost/api/health',
    ])
  ) {
    r.pass('Proxy routes /api/health to platform');
  } else {
    r.fail('Proxy routes /api/health to platform');
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

  // The application backend lives in its own container — probe it directly.
  const backendContainer = await compose.containerName('backend-api');
  if (
    await dockerExecOk(backendContainer, [
      'curl',
      '-sf',
      'http://localhost:3005/ping',
    ])
  ) {
    r.pass('Backend api /ping');
  } else {
    r.fail('Backend api /ping');
  }

  // The PII data tree is baked into the backend image at
  // TALE_CONFIG_SYSTEM_DIR (/app/system/pii); an image built without it
  // cannot enforce any organization's `pii_config` policy and only says so
  // in a boot log line. Load the registry inside the built image exactly as
  // the backend does — the same node flags and loader — so a packaging
  // regression fails this job rather than a customer's governance policy.
  // The flags and loader path mirror the `backend)` launch line in
  // docker-entrypoint.sh by hand: change them together, or this probe fails
  // for the wrong reason.
  if (
    await dockerExecOk(backendContainer, [
      'node',
      '--experimental-transform-types',
      '--disable-warning=ExperimentalWarning',
      '--import',
      '/app/backend/node-loader.mjs',
      '--input-type=module',
      '-e',
      "const { PatternRegistry } = await import('/app/lib/pii/index.ts'); PatternRegistry.fromDefaults();",
    ])
  ) {
    r.pass(
      'Backend image loads the PII data tree (PatternRegistry.fromDefaults)',
    );
  } else {
    r.fail(
      'Backend image loads the PII data tree (PatternRegistry.fromDefaults)',
    );
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

  // Critical path: the web tier must reach the application backend over the
  // docker network — every /api lane the proxy and the SPA use rides it.
  if (
    await dockerExecOk(platformContainer, [
      'curl',
      '-sf',
      'http://backend-api:3005/ping',
    ])
  ) {
    r.pass('Platform → backend-api /ping connectivity');
  } else {
    r.fail('Platform → backend-api /ping connectivity');
  }
  // The backend must reach the blob store it seeds the deployment default
  // against at boot — an unreachable store means every upload 503s.
  if (
    await dockerExecOk(backendContainer, [
      'curl',
      '-sf',
      'http://object-store:9000/minio/health/live',
    ])
  ) {
    r.pass('Backend → object-store health connectivity');
  } else {
    r.fail('Backend → object-store health connectivity');
  }
  // NOTE: knowledge-db reachability is covered by the `Knowledge DB pg_isready`
  // datastore check above.

  // 6. Sandbox session API end-to-end probe
  await sandboxSessionProbe();

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
        // Don't fail immediately — Docker may mark unhealthy during a long
        // first boot (migrations, the platform's vite build). Keep waiting.
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
// Sandbox session API end-to-end probe (+ negative cases).
//
// The session model replaced the one-shot /v1/execute contract: every run is
// create session → stage files → exec (SSE) → destroy. The probe walks that
// exact lifecycle. The source ships inline (`contentBase64`) — runnerd inside
// the session container writes it to /agent; a URL fixture host would not be
// reachable from the isolated sandbox network.
// =============================================================================

/** HMAC-signed curl against the sandbox spawner. Signing contract (auth.ts):
 * METHOD\npath\ntimestamp\nsha256Hex(body). */
async function signedSandboxCurl(
  token: string,
  method: string,
  path: string,
  body: string,
  maxTimeSec: number,
): Promise<{ httpCode: string; responseBody: string }> {
  const ts = Date.now();
  const bodyHash = createHash('sha256').update(body).digest('hex');
  const signedString = `${method}\n${path}\n${ts}\n${bodyHash}`;
  const sig = createHmac('sha256', token).update(signedString).digest('hex');
  const outFile = `${PROJECT_ROOT}/.sandbox-smoke-out.${process.pid}`;
  const probe = await capture([
    'curl',
    '-sS',
    '-o',
    outFile,
    '-w',
    '%{http_code}',
    '--max-time',
    String(maxTimeSec),
    '-X',
    method,
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
  return { httpCode, responseBody };
}

function dumpSandboxResponse(httpCode: string, responseBody: string): void {
  console.log(`  ${YELLOW}sandbox response (HTTP ${httpCode}):${NC}`);
  console.log(
    (responseBody.slice(0, 4000) || '    (empty body)')
      .split('\n')
      .map((l) => `    ${l}`)
      .join('\n'),
  );
  console.log('');
}

async function sandboxSessionProbe(): Promise<void> {
  header('Sandbox session API end-to-end');

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

  // Unique per-run sessionId so re-running doesn't return 409 Duplicate.
  const sessionId = `smoke-${process.pid}-${nowSec()}${String(process.hrtime.bigint()).slice(-6)}`;
  const sessionPath = `/v1/sessions/${sessionId}`;

  // Create — boots the session container and waits for runnerd health, so
  // the time budget is the largest of the probe.
  const create = await signedSandboxCurl(
    token,
    'POST',
    '/v1/sessions',
    JSON.stringify({
      sessionId,
      organizationId: 'smoke',
      profile: 'default',
    }),
    120,
  );
  const created =
    create.httpCode === '201' && create.responseBody.includes('"session"');
  if (created) {
    r.pass('Sandbox session create: 201 + session info');
  } else {
    dumpSandboxResponse(create.httpCode, create.responseBody);
    r.fail('Sandbox session create: expected 201 + session info');
  }

  if (created) {
    // Stage the 1-line source inline; runnerd writes it under /agent.
    const stage = await signedSandboxCurl(
      token,
      'POST',
      `${sessionPath}/files/stage`,
      JSON.stringify({
        files: [
          {
            path: 'code/main.py',
            contentBase64: Buffer.from('print(1)\n', 'utf8').toString('base64'),
          },
        ],
      }),
      30,
    );
    // The staged/skipped arrays echo the request path — a skip would echo it
    // too, so require a non-empty `staged` and an empty `skipped`.
    if (
      stage.httpCode === '200' &&
      stage.responseBody.includes('"staged":[{') &&
      stage.responseBody.includes('"skipped":[]')
    ) {
      r.pass('Sandbox session stage: main.py staged');
    } else {
      dumpSandboxResponse(stage.httpCode, stage.responseBody);
      r.fail('Sandbox session stage: expected 200 + staged main.py');
    }

    // Exec — the endpoint streams SSE and ends with an `event: result`.
    const execId = `exec-${nowSec()}${String(process.hrtime.bigint()).slice(-6)}`;
    const exec = await signedSandboxCurl(
      token,
      'POST',
      `${sessionPath}/exec`,
      JSON.stringify({
        execId,
        command: ['python3', '/agent/code/main.py'],
        timeoutMs: 30000,
      }),
      60,
    );
    if (
      exec.httpCode === '200' &&
      /^event: result/m.test(exec.responseBody) &&
      exec.responseBody.includes('"status":"completed"')
    ) {
      r.pass('Sandbox session exec: completed result');
    } else {
      dumpSandboxResponse(exec.httpCode, exec.responseBody);
      r.fail('Sandbox session exec: expected HTTP 200 + completed result');
    }
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
    '{"sessionId":"unauth","organizationId":"smoke"}',
    'http://localhost:8003/v1/sessions',
  ]);
  const noSigCode = noSig.exitCode === 0 ? noSig.stdout.trim() || '000' : '000';
  if (noSigCode === '401') {
    r.pass('Sandbox session create: 401 without signature');
  } else {
    r.fail(
      `Sandbox session create: expected 401 without signature, got ${noSigCode}`,
    );
  }

  // 8 MiB + 1 body → 413 (streaming body cap fires before HMAC check;
  // matches SANDBOX_MAX_REQUEST_BODY_BYTES default in sandbox config). Piped
  // via stdin (`--data-binary @-`) to dodge the kernel's MAX_ARG_STRLEN.
  const tooBig = 'x'.repeat(8 * 1024 * 1024 + 1);
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
      'http://localhost:8003/v1/sessions',
    ],
    { stdin: tooBig },
  );
  const oversizedCode =
    oversized.exitCode === 0 ? oversized.stdout.trim() || '000' : '000';
  if (oversizedCode === '413') {
    r.pass('Sandbox session create: 413 on oversized body');
  } else {
    r.fail(
      `Sandbox session create: expected 413 on oversized body, got ${oversizedCode}`,
    );
  }

  // Destroy — always attempted for a created session so a failed exec probe
  // doesn't leak the container into later runs.
  if (created) {
    const destroy = await signedSandboxCurl(
      token,
      'DELETE',
      sessionPath,
      '',
      30,
    );
    if (
      destroy.httpCode === '200' &&
      destroy.responseBody.includes('"destroyed":true')
    ) {
      r.pass('Sandbox session destroy: destroyed');
    } else {
      dumpSandboxResponse(destroy.httpCode, destroy.responseBody);
      r.fail('Sandbox session destroy: expected 200 + destroyed');
    }
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
