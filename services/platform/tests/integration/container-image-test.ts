#!/usr/bin/env bun
// =============================================================================
// Tale — Container Image Validation Tests
// =============================================================================
// Validates built Docker images for security, compliance, and size budgets.
// Does NOT require running containers — inspects images only.
//
// Usage:
//   bun tests/container-image-test.ts
//   bun run docker:test:image
//
// Prerequisites:
//   Images must be built first:
//     docker compose -f compose.yml -f compose.test.yml --env-file .env.test -p tale-test build
// =============================================================================
import {
  Compose,
  composeArgs,
  dockerInspect,
  imageExists,
  imageSizeMb,
} from './lib/docker';
import { capture, projectRoot, stream } from './lib/exec';
import { BOLD, GREEN, header, NC, RED, Results, YELLOW } from './lib/log';

const PROJECT_ROOT = projectRoot();
const compose = new Compose(
  composeArgs({
    files: ['compose.yml', 'compose.test.yml'],
    envFile: '.env.test',
    project: 'tale-test',
  }),
  PROJECT_ROOT,
);

const r = new Results();

// Image size budgets (in MB) — based on optimized sizes + 10% headroom.
const SIZE_BUDGETS: Record<string, number> = {
  crawler: 2100,
  rag: 1400,
  platform: 2900,
  db: 1200,
  proxy: 100,
  convex: 2500,
  sandbox: 320,
  'sandbox-egress': 80,
  // Carries a heavy toolchain by design, on top of the playwright/chromium base
  // and native docker/compose-in-session (runtime tiers, #1881):
  //   - document conversion: libreoffice + poppler + pandoc (~570 MB)
  //   - LaTeX/XeTeX for pandoc publication-grade PDF: texlive-xetex +
  //     latex-recommended + fonts-recommended + lang-chinese + lmodern (~660 MB)
  // The amd64 image is ~4.0 GB as a result; ~10% headroom over that.
  'sandbox-runtime': 4400,
};

const SERVICES = [
  'crawler',
  'rag',
  'platform',
  'db',
  'proxy',
  'convex',
  'sandbox',
  'sandbox-egress',
  'sandbox-runtime',
];

const SECRET_KEYS = [
  'OPENAI_API_KEY',
  'DB_PASSWORD',
  'BETTER_AUTH_SECRET',
  'ENCRYPTION_SECRET_HEX',
  'INSTANCE_SECRET',
];

const SAFE_SECRET_VALUES = new Set([
  'test-key-not-real',
  'test-secret-do-not-use-in-production-1234567890',
]);

/** Resolve a service's image ref, with the sandbox-runtime fallbacks. */
async function getImage(service: string): Promise<string> {
  const fromCompose = await compose.imageFor(service);
  if (fromCompose) return fromCompose;
  if (service === 'sandbox-runtime') {
    if (await imageExists('tale-sandbox-runtime:latest'))
      return 'tale-sandbox-runtime:latest';
    const ghcr = 'ghcr.io/tale-project/tale/tale-sandbox-runtime:latest';
    if (await imageExists(ghcr)) return ghcr;
  }
  return '';
}

async function main(): Promise<number> {
  // Build images explicitly to ensure we are testing the local codebase.
  header('Building all images locally');
  console.log(`  ${YELLOW}Building images using compose...${NC}`);

  if (process.env.SKIP_BUILD === 'true') {
    console.log(`  ${YELLOW}⚠ SKIP_BUILD=true — using pre-built images${NC}`);
  } else {
    if ((await compose.run(['build', '--parallel'])) !== 0) {
      console.error(`${RED}Build failed!${NC}`);
      return 1;
    }
    // sandbox-runtime is not a compose service — build it separately. Tag
    // matches the spawner default; build context is the repo root.
    if (!(await imageExists('tale-sandbox-runtime:latest'))) {
      console.log(`  ${YELLOW}Building tale-sandbox-runtime:latest...${NC}`);
      const code = await stream(
        [
          'docker',
          'build',
          '-t',
          'tale-sandbox-runtime:latest',
          '-f',
          'services/sandbox-runtime/Dockerfile',
          '.',
        ],
        { cwd: PROJECT_ROOT },
      );
      if (code !== 0) {
        console.error(`${RED}sandbox-runtime build failed!${NC}`);
        return 1;
      }
    }
  }

  const images = new Map<string, string>();
  for (const svc of SERVICES) {
    const img = await getImage(svc);
    images.set(svc, img);
    if (img) {
      console.log(`  ${GREEN}✓${NC} ${svc}: ${img}`);
    } else {
      console.log(
        `  ${YELLOW}⚠${NC} ${svc}: image not found (skipping checks)`,
      );
    }
  }

  // 1. OCI label checks
  header('Checking OCI labels');
  for (const svc of SERVICES) {
    const img = images.get(svc);
    if (!img) continue;
    const labels = await dockerInspect(img, '{{json .Config.Labels}}');
    if (labels.includes('org.opencontainers.image.source')) {
      r.pass(`${svc}: OCI labels present`);
    } else {
      r.warn(`${svc}: OCI labels missing (acceptable for local builds)`);
    }
  }

  // 2. Non-root user (where applicable)
  header('Checking non-root user');
  for (const svc of SERVICES) {
    const img = images.get(svc);
    if (!img) continue;
    const user = await dockerInspect(img, '{{.Config.User}}');
    const nonRoot = Boolean(user) && user !== 'root' && user !== '0';
    switch (svc) {
      case 'platform':
        r.pass(`${svc}: root (expected — gosu to app at runtime)`);
        break;
      case 'db':
      case 'convex':
        r.pass(`${svc}: root (expected — gosu to app/postgres at runtime)`);
        break;
      case 'proxy':
        r.pass(`${svc}: base Caddy image (acceptable)`);
        break;
      case 'crawler':
      case 'rag':
        if (nonRoot) r.pass(`${svc}: runs as user '${user}' (non-root)`);
        else
          r.warn(
            `${svc}: runs as root (consider adding non-root user in future)`,
          );
        break;
      case 'sandbox':
      case 'sandbox-egress':
        r.pass(
          `${svc}: root (expected — privilege drops to docker.sock owner / tinyproxy user)`,
        );
        break;
      case 'sandbox-runtime':
        if (nonRoot) r.pass(`${svc}: runs as user '${user}' (non-root)`);
        else r.fail(`${svc}: runtime image must not run as root`);
        break;
    }
  }

  // 3. No secrets baked in
  header('Checking for baked-in secrets');
  for (const svc of SERVICES) {
    const img = images.get(svc);
    if (!img) continue;
    let foundSecret = false;

    const envRaw = await dockerInspect(
      img,
      '{{range .Config.Env}}{{.}} {{end}}',
    );
    const tokens = envRaw.split(/\s+/).filter(Boolean);
    for (const key of SECRET_KEYS) {
      const entry = tokens.find(
        (tok) => tok.startsWith(`${key}=`) && tok.length > key.length + 1,
      );
      if (entry) {
        const value = entry.slice(key.length + 1);
        if (value && !SAFE_SECRET_VALUES.has(value)) {
          r.fail(`${svc}: secret ${key} found in image env`);
          foundSecret = true;
        }
      }
    }

    // Check for .env files in the image filesystem.
    const find = await capture([
      'docker',
      'run',
      '--rm',
      '--entrypoint=',
      img,
      'find',
      '/',
      '-maxdepth',
      '3',
      '-name',
      '.env',
      '-o',
      '-name',
      '.env.local',
      '-o',
      '-name',
      '.env.production',
    ]);
    if (find.stdout.includes('.env')) {
      r.fail(`${svc}: .env file found in image filesystem`);
      foundSecret = true;
    }

    if (!foundSecret) r.pass(`${svc}: no secrets baked in`);
  }

  // 4. Health check defined
  header('Checking HEALTHCHECK instruction');
  for (const svc of SERVICES) {
    const img = images.get(svc);
    if (!img) continue;
    // sandbox-runtime is an exec'd ephemeral container — HEALTHCHECK never runs.
    if (svc === 'sandbox-runtime') {
      r.pass(`${svc}: HEALTHCHECK skipped (ephemeral exec container)`);
      continue;
    }
    const healthcheck = await dockerInspect(img, '{{.Config.Healthcheck}}');
    if (healthcheck && healthcheck !== '<nil>') {
      r.pass(`${svc}: HEALTHCHECK defined`);
    } else {
      r.fail(`${svc}: no HEALTHCHECK instruction`);
    }
  }

  // 5. Image size budget
  header('Checking image size budgets');
  console.log('');
  console.log(
    `  ${BOLD}${'SERVICE'.padEnd(12)}  ${'SIZE (MB)'.padEnd(10)}  ${'BUDGET'.padEnd(10)}  ${'STATUS'.padEnd(8)}${NC}`,
  );
  console.log('  ──────────  ─────────  ─────────  ────────');
  for (const svc of SERVICES) {
    const img = images.get(svc);
    if (!img) continue;
    const sizeMb = await imageSizeMb(img);
    const budget = SIZE_BUDGETS[svc] ?? 0;
    if (sizeMb <= budget) {
      console.log(
        `  ${GREEN}${svc.padEnd(12)}  ${`${sizeMb} MB`.padEnd(10)}  ${`${budget} MB`.padEnd(10)}  ✓ OK${NC}`,
      );
      r.pass(`${svc}: ${sizeMb} MB ≤ ${budget} MB budget`);
    } else {
      console.log(
        `  ${RED}${svc.padEnd(12)}  ${`${sizeMb} MB`.padEnd(10)}  ${`${budget} MB`.padEnd(10)}  ✗ OVER${NC}`,
      );
      r.fail(`${svc}: ${sizeMb} MB exceeds ${budget} MB budget`);
    }
  }

  // 6. No unnecessary package managers (Python images)
  header('Checking for unnecessary packages (Python images)');
  for (const svc of ['crawler', 'rag']) {
    const img = images.get(svc);
    if (!img) continue;
    const pip = await capture([
      'docker',
      'run',
      '--rm',
      '--entrypoint=',
      img,
      'pip',
      '--version',
    ]);
    if (pip.exitCode === 0)
      r.warn(`${svc}: pip still installed (consider removing)`);
    else r.pass(`${svc}: pip removed`);
  }

  return r.failed === 0 ? 0 : 1;
}

let exitCode = 0;
try {
  exitCode = await main();
} catch (err) {
  console.error(err);
  exitCode = 1;
}

r.printSummary({
  title: 'CONTAINER IMAGE TEST RESULTS',
  nameWidth: 50,
  showWarnings: true,
  successBanner: '🎉 ALL IMAGE VALIDATION TESTS PASSED',
});

process.exit(exitCode);
