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
  platform: 2900,
  db: 1200,
  proxy: 100,
  sandbox: 320,
  'sandbox-egress': 80,
  // Debian-slim + the verbatim BuildKit static binaries + redsocks/iptables —
  // a lean, deterministic image (~335 MB amd64), ~13% headroom.
  'sandbox-buildkitd': 380,
  // Carries a heavy toolchain by design, on top of the playwright/chromium base
  // and native docker/compose-in-session (runtime tiers, #1881):
  //   - document conversion: libreoffice + poppler + pandoc (~570 MB)
  //   - LaTeX/XeTeX for pandoc publication-grade PDF: texlive-xetex +
  //     latex-recommended + fonts-recommended + lang-chinese + lmodern (~660 MB)
  //   - the baked external-agent CLIs (single-runtime-image doctrine): the
  //     2026-07-07 wave — Codex (~290 MB, single-platform Rust binary),
  //     OpenClaw (~170 MB), Pi (~80 MB) — landed on top of claude-code,
  //     opencode, cursor, gemini and hermes, pushing amd64 from ~4.3 GB to
  //     ~4.9 GB (their per-PR Build runs were concurrency-cancelled, so the
  //     over-budget check never surfaced before merge).
  // ~10% headroom over the ~4.9 GB amd64 image.
  'sandbox-runtime': 5400,
};

const SERVICES = [
  'platform',
  'db',
  'proxy',
  'sandbox',
  'sandbox-egress',
  'sandbox-buildkitd',
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

// Spawner-managed images that are NOT compose services — the sandbox spawner
// `docker run`s them, so they're tagged `:latest` locally (or pulled from ghcr
// in CI) rather than declared in compose.
const SPAWNER_IMAGES = new Set(['sandbox-runtime', 'sandbox-buildkitd']);

/** Resolve a service's image ref, with the spawner-image fallbacks. */
async function getImage(service: string): Promise<string> {
  const fromCompose = await compose.imageFor(service);
  if (fromCompose) return fromCompose;
  if (SPAWNER_IMAGES.has(service)) {
    const local = `tale-${service}:latest`;
    if (await imageExists(local)) return local;
    const ghcr = `ghcr.io/tale-project/tale/tale-${service}:latest`;
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
    // The spawner-managed images are not compose services — build each
    // separately. Tags match the spawner defaults; build context is the repo
    // root. In CI these are already pulled + tagged `:latest`, so this is a
    // local-only fallback.
    for (const svc of SPAWNER_IMAGES) {
      const tag = `tale-${svc}:latest`;
      if (await imageExists(tag)) continue;
      console.log(`  ${YELLOW}Building ${tag}...${NC}`);
      const code = await stream(
        ['docker', 'build', '-t', tag, '-f', `services/${svc}/Dockerfile`, '.'],
        { cwd: PROJECT_ROOT },
      );
      if (code !== 0) {
        console.error(`${RED}${svc} build failed!${NC}`);
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
        r.pass(`${svc}: root (expected — gosu to postgres at runtime)`);
        break;
      case 'proxy':
        r.pass(`${svc}: base Caddy image (acceptable)`);
        break;
      case 'sandbox':
      case 'sandbox-egress':
        r.pass(
          `${svc}: root (expected — privilege drops to docker.sock owner / tinyproxy user)`,
        );
        break;
      case 'sandbox-buildkitd':
        r.pass(
          `${svc}: root (expected — buildkitd needs root + --privileged for build mount/namespace ops)`,
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

  // 3b. Platform ships the config catalogs and an app-owned data mount point.
  // The retired convex image used to bake these; v0.5.0 shipped WITHOUT them:
  // every provider read 500'd on the missing /app/system, org scaffolding had
  // no /app/builtin seed catalog, and the backend roles (uid app) hit EACCES
  // writing the root-owned org-config volume at /app/data.
  header('Checking platform config catalogs');
  {
    const img = images.get('platform');
    if (img) {
      const probe = await capture([
        'docker',
        'run',
        '--rm',
        '--entrypoint=',
        img,
        'sh',
        '-c',
        'ls /app/system/providers | head -1; ls /app/builtin | head -1; stat -c %U /app/data',
      ]);
      const [firstProvider, firstBuiltin, dataOwner] = probe.stdout
        .trim()
        .split('\n')
        .map((line) => line.trim());
      if (firstProvider) r.pass(`platform: /app/system/providers is populated`);
      else r.fail(`platform: /app/system/providers missing or empty`);
      if (firstBuiltin) r.pass(`platform: /app/builtin seed catalog present`);
      else r.fail(`platform: /app/builtin missing or empty`);
      if (dataOwner === 'app') r.pass(`platform: /app/data owned by app`);
      else r.fail(`platform: /app/data owner is '${dataOwner}', expected app`);
    }
  }

  // 4. Health check defined
  header('Checking HEALTHCHECK instruction');
  for (const svc of SERVICES) {
    const img = images.get(svc);
    if (!img) continue;
    // Spawner-managed images carry no docker HEALTHCHECK: sandbox-runtime is an
    // exec'd ephemeral container, and sandbox-buildkitd is a daemon whose
    // readiness the spawner probes (services/sandbox/src/buildkitd.ts).
    if (SPAWNER_IMAGES.has(svc)) {
      r.pass(
        `${svc}: HEALTHCHECK skipped (spawner-managed, not docker-supervised)`,
      );
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
