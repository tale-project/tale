// =============================================================================
// Tale — Static-site container test helper (web / docs)
// =============================================================================
// Shared helper for container-web-test.ts and container-docs-test.ts. Both
// services run the same shape: a Bun server fronting a static SPA dist with a
// /api/health endpoint. This module builds, validates, and smoke-tests one of
// them via its standalone compose files.
//
// Optional env:
//   SMOKE_TEST_TIMEOUT  max seconds to wait for healthy (default: 120)
//   SKIP_BUILD          'true' to use pre-built images (release pipeline)
//   KEEP_RUNNING        'true' to skip teardown (debugging)
// =============================================================================
import { existsSync, writeFileSync } from 'node:fs';

import {
  Compose,
  composeArgs,
  dockerInspect,
  healthStatus,
  httpStatus,
  imageSizeMb,
  nowSec,
  sleep,
} from './lib/docker';
import { projectRoot } from './lib/exec';
import { CYAN, GREEN, header, NC, RED, Results, YELLOW } from './lib/log';

interface StaticSiteProbe {
  /** Path relative to the site origin, e.g. `/pricing`. */
  path: string;
  /** Expected HTTP status. */
  status: number;
  /** Optional substring that must appear in Content-Type. */
  contentTypeIncludes?: string;
  /** When true, require a Cache-Control header to be present. */
  expectCacheControl?: boolean;
}

interface StaticSiteTestOptions {
  /** Logical service name, e.g. "web" or "docs". */
  name: string;
  /** Host port for the test container, e.g. 13001. */
  port: number;
  /** Size budget in MB. */
  sizeBudgetMb: number;
  /** Extra HTTP probes beyond `/api/health`. */
  probes?: readonly StaticSiteProbe[];
}

export async function runStaticSiteTest(
  opts: StaticSiteTestOptions,
): Promise<void> {
  const svc = opts.name;
  const hostPort = opts.port;
  const sizeBudgetMb = opts.sizeBudgetMb;
  const timeout = Number(process.env.SMOKE_TEST_TIMEOUT ?? 120);

  const root = projectRoot();
  const compose = new Compose(
    composeArgs({
      files: [`compose.${svc}.yml`, `compose.${svc}.test.yml`],
      envFile: '.env.test',
      project: `tale-${svc}-test`,
    }),
    root,
  );

  const r = new Results();

  const cleanup = async (failing: boolean): Promise<void> => {
    if (process.env.KEEP_RUNNING === 'true') {
      console.log(`${YELLOW}KEEP_RUNNING=true — skipping teardown${NC}`);
      return;
    }
    if (failing) {
      header('Container logs (last 100 lines) on failure');
      await compose.run(['logs', '--tail=100', '--no-color']);
    }
    header(`Tearing down ${svc} test containers`);
    await compose.down();
  };

  /** Early-exit path (build/env failures): teardown, no summary box, exit 1. */
  const abort = async (): Promise<never> => {
    await cleanup(true);
    process.exit(1);
  };

  try {
    // Ensure dummy .env files exist so compose env_file directives don't fail.
    const svcEnv = `${root}/services/${svc}/.env`;
    if (!existsSync(svcEnv)) {
      console.log(
        `  ${YELLOW}⚠ No services/${svc}/.env — creating empty placeholder${NC}`,
      );
      writeFileSync(svcEnv, '');
    }
    if (!existsSync(`${root}/.env.test`)) {
      console.error('Missing .env.test at project root');
      await abort();
    }

    // Always start clean (in case a previous run left containers around).
    await compose.down();

    // 1. Build (or skip when reusing pre-pulled images)
    if (process.env.SKIP_BUILD !== 'true') {
      header(`Building ${svc} image`);
      if ((await compose.run(['build'])) !== 0) {
        console.error(`${RED}Build failed!${NC}`);
        await abort();
      }
    }

    const image = await compose.imageHead();
    if (!image) {
      console.error(`Failed to resolve ${svc} image name from compose`);
      await abort();
    }
    console.log(`  ${CYAN}Image: ${image}${NC}`);

    // 2. Image-level checks
    header('Image checks');

    const labelsJson = await dockerInspect(image, '{{json .Config.Labels}}');
    const title = parseLabel(labelsJson, 'org.opencontainers.image.title');
    if (title.includes(`tale-${svc}`)) {
      r.pass(`${svc}: OCI title label present (tale-${svc})`);
    } else {
      r.fail(`${svc}: OCI title label missing or wrong`);
    }

    const user = await dockerInspect(image, '{{.Config.User}}');
    if (user && user !== 'root' && user !== '0') {
      r.pass(`${svc}: runs as non-root user '${user}'`);
    } else {
      r.fail(`${svc}: runs as root (expected non-root for static site)`);
    }

    const healthcheck = await dockerInspect(image, '{{.Config.Healthcheck}}');
    if (healthcheck && healthcheck !== '<nil>') {
      r.pass(`${svc}: HEALTHCHECK defined`);
    } else {
      r.fail(`${svc}: no HEALTHCHECK instruction`);
    }

    const sizeMb = await imageSizeMb(image);
    if (sizeMb <= sizeBudgetMb) {
      r.pass(`${svc}: ${sizeMb} MB ≤ ${sizeBudgetMb} MB budget`);
    } else {
      r.fail(`${svc}: ${sizeMb} MB exceeds ${sizeBudgetMb} MB budget`);
    }

    // 3. Smoke test: bring up + probe /api/health
    header(`Smoke test: ${svc} /api/health`);
    await compose.run(['up', '-d']);
    const containerName = await compose.containerName(svc);

    const startTime = nowSec();
    let healthy = false;
    for (;;) {
      const elapsed = nowSec() - startTime;
      if (elapsed >= timeout) {
        console.log(`  ${RED}✗${NC} ${svc}: timed out after ${timeout}s`);
        const logs = await compose.capture(['logs', '--tail=40', svc]);
        console.log(
          logs.combined
            .split('\n')
            .map((l) => `    ${l}`)
            .join('\n'),
        );
        break;
      }
      const status = await healthStatus(containerName);
      if (status === 'healthy') {
        healthy = true;
        console.log(`  ${GREEN}✓${NC} ${svc}: healthy (${elapsed}s)`);
        break;
      }
      await sleep(3000);
    }

    if (healthy) r.pass(`${svc} health check`);
    else r.fail(`${svc} health check`);

    const code = await httpStatus(
      `http://localhost:${hostPort}/api/health`,
      10,
    );
    if (code === '200') {
      r.pass(`${svc}: /api/health HTTP 200`);
    } else {
      r.fail(`${svc}: /api/health expected 200, got ${code}`);
    }

    for (const probe of opts.probes ?? []) {
      const url = `http://localhost:${hostPort}${probe.path}`;
      const res = await fetch(url, { redirect: 'manual' }).catch(() => null);
      const status = res?.status ?? 0;
      if (status === probe.status) {
        r.pass(`${svc}: ${probe.path} HTTP ${probe.status}`);
      } else {
        r.fail(`${svc}: ${probe.path} expected ${probe.status}, got ${status}`);
      }
      if (res && probe.contentTypeIncludes) {
        const ct = res.headers.get('content-type') ?? '';
        if (ct.includes(probe.contentTypeIncludes)) {
          r.pass(
            `${svc}: ${probe.path} content-type has ${probe.contentTypeIncludes}`,
          );
        } else {
          r.fail(
            `${svc}: ${probe.path} content-type missing ${probe.contentTypeIncludes} (got ${ct})`,
          );
        }
      }
      if (res && probe.expectCacheControl) {
        const cc = res.headers.get('cache-control');
        if (cc) r.pass(`${svc}: ${probe.path} has Cache-Control`);
        else r.fail(`${svc}: ${probe.path} missing Cache-Control`);
      }
    }

    // Summary — printed before teardown, matching the bash trap ordering.
    const exitCode = r.failed === 0 ? 0 : 1;
    r.printSummary({
      title: `${svc.toUpperCase()} CONTAINER TEST RESULTS`,
      nameWidth: 50,
    });
    await cleanup(exitCode !== 0);
    process.exit(exitCode);
  } catch (err) {
    console.error(err);
    await cleanup(true);
    process.exit(1);
  }
}

/**
 * Pull a single label value out of `{{json .Config.Labels}}`. Mirrors the
 * bash `grep -o '"<key>":"[^"]*"'` extraction rather than parsing the JSON,
 * which keeps the matcher free of unsafe `any` assertions.
 */
function parseLabel(json: string, key: string): string {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`"${escaped}":"([^"]*)"`).exec(json);
  return match?.[1] ?? '';
}
