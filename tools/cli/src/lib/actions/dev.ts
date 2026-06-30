import { join, relative } from 'node:path';

import {
  chain,
  classifyBuildKit,
  classifyConvex,
  classifyDockerCompose,
  classifyPlatformContainer,
  classifyVite,
  createStreamClassifier,
} from '@tale/shared/classify';
import { openUrl } from '@tale/shared/process';
import {
  detailLines,
  doneLine,
  infoLine,
  rule,
  runStep,
  sourceLine,
  StepWarning,
  warnLine,
} from '@tale/shared/tux';

import pkg from '../../../package.json';
import { isUserInterrupt } from '../../utils/exit-codes';
import { getProjectId, loadEnv } from '../../utils/load-env';
import * as logger from '../../utils/logger';
import { findComposeOverride } from '../compose/find-compose-override';
import { DEV_VOLUME_NAMES } from '../compose/generators/constants';
import { generateDevCompose } from '../compose/generators/generate-dev-compose';
import { dockerCompose } from '../docker/docker-compose';
import { ensureDocker } from '../docker/ensure-docker';
import { ensureNetwork, ensureSandboxNetwork } from '../docker/ensure-network';
import { ensureVolumes } from '../docker/ensure-volumes';
import { exec } from '../docker/exec';
import { findChildProject, findProject } from '../project/find-project';
import { resolveOrAssignProjectContext } from '../project/project-context';
import { withLock } from '../state/with-lock';
import { getAdminKey } from './convex-admin';
import { init } from './init';

async function assertDockerAvailable(): Promise<void> {
  try {
    const result = await exec('docker', ['info'], {
      silent: true,
      timeout: 10,
    });
    if (!result.success) {
      throw new Error(
        `Docker daemon is not running. Start Docker and try again.\n${result.stderr}`,
      );
    }
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      (err as NodeJS.ErrnoException).code === 'ENOENT'
    ) {
      throw new Error(
        'Docker is not installed. Install it from https://docs.docker.com/get-docker/',
        { cause: err },
      );
    }
    throw err;
  }
}

async function openBrowser(url: string): Promise<void> {
  const opened = await openUrl(url, { onDebug: logger.debug });
  if (!opened) {
    warnLine(`Could not open browser automatically. Visit: ${url}`);
  }
}

/** Poll `${url}/health` until it answers 200 or the attempt budget runs out. */
async function waitForHealth(
  url: string,
  signal?: AbortSignal,
): Promise<boolean> {
  const healthUrl = `${url}/health`;
  const maxAttempts = 120;
  for (let i = 0; i < maxAttempts; i++) {
    if (signal?.aborted) return false;
    try {
      const fetchSignal = signal
        ? AbortSignal.any([AbortSignal.timeout(2000), signal])
        : AbortSignal.timeout(2000);
      const res = await fetch(healthUrl, { signal: fetchSignal });
      if (res.ok) return true;
    } catch (err) {
      if (signal?.aborted) return false;
      logger.debug(
        `Health check attempt ${i + 1} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    await Bun.sleep(1000);
  }
  return false;
}

/**
 * Derive the Convex dashboard admin key once the platform container is up,
 * retrying while it boots. Best-effort: a failure must never fail `tale dev`.
 */
async function fetchAdminKeyWhenReady(
  signal?: AbortSignal,
): Promise<string | null> {
  const maxAttempts = 60;
  for (let i = 0; i < maxAttempts; i++) {
    if (signal?.aborted) return null;
    try {
      return await getAdminKey();
    } catch (err) {
      logger.debug(
        `Admin key fetch attempt ${i + 1} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    await Bun.sleep(1000);
  }
  return null;
}

/** The clean READY block: an ASCII rule, the app URL, the fixed Convex sub-paths
 *  (derived host-side — no log scraping), and the dashboard admin key. */
function printReadyBlock(url: string, adminKey: string | null): void {
  rule();
  doneLine(`Tale is running — open ${url}`);
  infoLine(`Convex API   ${url}/ws_api`);
  infoLine(`Actions      ${url}/http_api`);
  infoLine(`Dashboard    ${url}/convex-dashboard`);
  if (adminKey) infoLine(`Admin key    ${adminKey}`);
  rule();
}

interface DevOptions {
  detach?: boolean;
  port?: number;
  host?: string;
  /** Non-interactive: auto-accept prompts (e.g. installing/starting Docker). */
  assumeYes?: boolean;
}

export async function runDev(options: DevOptions): Promise<void> {
  let projectDir = findProject();
  if (!projectDir) {
    // `tale init` scaffolds into a named subdirectory, so a common mistake is
    // running `tale dev` one level up. Point at the child project rather than
    // silently initializing a second one on top.
    const childProject = findChildProject();
    if (childProject) {
      const rel = relative(process.cwd(), childProject);
      throw new Error(
        `No Tale project in this directory — found one at ./${rel}. ` +
          `Run it from there:\n  cd ${rel} && tale dev`,
      );
    }
    warnLine('No Tale project found. Initializing in current directory...');
    await init({ directory: process.cwd() });
    projectDir = findProject();
    if (!projectDir) {
      throw new Error('Initialization failed: tale.json was not created.');
    }
  }

  // Environment setup runs unconditionally so `tale dev` after a CLI upgrade
  // that introduces a new auto-secret picks it up before compose starts.
  const envPath = join(projectDir, '.env');
  const { ensureEnv } = await import('../config/ensure-env');
  const { success: envOk } = await ensureEnv({ deployDir: projectDir });
  if (!envOk) {
    throw new Error(
      `Environment setup failed. Cannot start without ${envPath}.`,
    );
  }

  await resolveOrAssignProjectContext(projectDir);
  const env = loadEnv(projectDir);

  // Zero-prerequisite: install/start Docker if needed.
  const docker = await ensureDocker({ assumeYes: options.assumeYes });
  if (docker.status === 'refused' || docker.status === 'failed') {
    throw new Error(docker.detail);
  }
  await assertDockerAvailable();

  const devPrefix = `${getProjectId()}-dev_`;
  await runStep(
    {
      active: 'Preparing volumes & networks',
      done: 'Volumes & networks ready',
    },
    () =>
      // Project-scoped lock so parallel `tale dev` / `tale deploy` shells can't
      // race on docker volumes. Released before compose starts.
      withLock(projectDir, 'dev', async () => {
        if (!(await ensureVolumes([...DEV_VOLUME_NAMES], devPrefix))) {
          throw new Error('Failed to create dev volumes');
        }
        if (!(await ensureNetwork('internal', devPrefix))) {
          throw new Error('Failed to create dev network');
        }
        // Fixed-name (`tale-sandbox-net`), internal-only, IPv6-off bridge so the
        // spawner can target it directly from `docker run --network`.
        if (!(await ensureSandboxNetwork())) {
          throw new Error('Failed to create sandbox network');
        }
      }),
  );

  const version = pkg.version.includes('-dev') ? 'latest' : pkg.version;
  const port = options.port ?? 443;
  const hostAlias = options.host ?? 'localhost';
  const portSuffix = port === 443 ? '' : `:${port}`;
  const url = `${env.SITE_URL.replace(/:443$/, '')}${portSuffix}`;

  const compose = generateDevCompose(
    { version, registry: env.GHCR_REGISTRY },
    hostAlias,
    port,
    { projectDir },
  );
  const overrideFile = findComposeOverride(projectDir);
  if (overrideFile) infoLine('Using compose override: compose.override.yml');

  const projectName = `${getProjectId()}-dev`;
  const composeOpts = {
    projectName,
    cwd: projectDir,
    overrideFile: overrideFile ?? undefined,
  };
  const abortController = new AbortController();

  // ── Detached: clean step-by-step bring-up, then leave the stack running. ──
  // Build/pull noise is captured to a ring and dumped only if the step fails.
  if (options.detach) {
    const ring: string[] = [];
    await runStep(
      { active: 'Starting Tale', done: 'Tale started' },
      async () => {
        const result = await dockerCompose(compose, ['up', '-d'], {
          ...composeOpts,
          onLine(line) {
            ring.push(line);
            if (ring.length > 200) ring.shift();
          },
        });
        if (!result.success) {
          if (!isUserInterrupt(result.exitCode)) detailLines(ring.slice(-15));
          throw new Error('docker compose up failed');
        }
      },
    );
    const healthy = await runStep(
      { active: 'Waiting for services', done: 'Services healthy' },
      async () => {
        if (!(await waitForHealth(url, abortController.signal))) {
          throw new StepWarning(
            'not healthy yet — they may still be warming up; check `tale logs`',
          );
        }
        return true;
      },
    );
    const adminKey = await fetchAdminKeyWhenReady(abortController.signal);
    if (healthy) void openBrowser(url);
    printReadyBlock(url, adminKey);
    infoLine(`Stop with: docker compose -p ${projectName} down`);
    return;
  }

  // ── Foreground: attach to `docker compose up` so Ctrl-C is delivered to
  //    compose, which stops the stack gracefully (the original contract) — no
  //    manual signal handling, no compose-down spew. Build/pull/HMR noise is
  //    classified away; only meaningful lifecycle/warn/error lines surface. A
  //    concurrent announcer prints the READY block once /health answers. ──
  const classify = createStreamClassifier(
    chain(
      classifyBuildKit,
      classifyDockerCompose,
      classifyConvex,
      classifyVite,
      classifyPlatformContainer,
    ),
  );

  const announce = (async (): Promise<void> => {
    const ok = await waitForHealth(url, abortController.signal);
    if (abortController.signal.aborted) return;
    if (!ok) {
      warnLine(
        'Services did not become healthy in time — check the log above.',
      );
      return;
    }
    const adminKey = await fetchAdminKeyWhenReady(abortController.signal);
    if (abortController.signal.aborted) return;
    void openBrowser(url);
    printReadyBlock(url, adminKey);
  })();

  infoLine('Starting Tale — press Ctrl-C to stop.');
  const result = await dockerCompose(compose, ['up'], {
    ...composeOpts,
    onLine(line) {
      const c = classify(line);
      if (c.kind === 'error') sourceLine('tale', 'error', c.text ?? c.raw);
      else if (c.kind === 'warn') sourceLine('tale', 'warn', c.text ?? c.raw);
      else if (c.kind === 'info' && c.text) sourceLine('tale', 'info', c.text);
      // progress/noise (layer pulls, HMR, "Watching…") collapse silently.
    },
  });

  // Compose has exited (Ctrl-C → graceful stop, or a real failure). Stop the
  // readiness announcer and report only genuine, non-interrupt failures.
  abortController.abort();
  await announce;
  if (!result.success && !isUserInterrupt(result.exitCode)) {
    logger.error('Tale stopped unexpectedly.');
    if (result.stderr) logger.error(result.stderr);
    throw new Error('Start failed');
  }
}
