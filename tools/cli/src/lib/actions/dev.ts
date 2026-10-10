import { join, relative } from 'node:path';

import {
  chain,
  classifyBuildKit,
  classifyBackend,
  classifyDockerCompose,
  classifyPlatformContainer,
  classifyVite,
  createStreamClassifier,
} from '@tale/shared/classify';
import { openUrl, RingBuffer } from '@tale/shared/process';
import {
  detailLines,
  doneLine,
  infoLine,
  rule,
  runStep,
  sourceLine,
  warnLine,
} from '@tale/shared/tux';

import pkg from '../../../package.json';
import { isUserInterrupt } from '../../utils/exit-codes';
import {
  CliError,
  ExitCode,
  externalDepError,
  preconditionError,
} from '../../utils/fail';
import { getProjectId, loadEnv } from '../../utils/load-env';
import * as logger from '../../utils/logger';
import { getOutputMode } from '../../utils/output-mode';
import { findComposeOverride } from '../compose/find-compose-override';
import { DEV_VOLUME_NAMES } from '../compose/generators/constants';
import {
  generateDevCompose,
  orgConfigMountTargets,
} from '../compose/generators/generate-dev-compose';
import {
  BACKEND_WORKER_STOP_GRACE_S,
  backendStopGraceSeconds,
} from '../compose/services/create-backend-services';
import { ALL_SERVICES } from '../compose/types';
import { resolveDevOrigin } from '../config/dev-origin';
import { daemonReachable } from '../docker/daemon-reachable';
import { dockerCompose } from '../docker/docker-compose';
import { ensureConfigMountpoints } from '../docker/ensure-config-mountpoints';
import { ensureDocker } from '../docker/ensure-docker';
import { ensureImagePresent } from '../docker/ensure-image-present';
import { ensureNetwork, ensureSandboxNetwork } from '../docker/ensure-network';
import { ensureSandboxRuntimeImage } from '../docker/ensure-sandbox-runtime-image';
import { ensureVolumes } from '../docker/ensure-volumes';
import { exec } from '../docker/exec';
import { getContainerHealth } from '../docker/get-container-health';
import { isContainerRunning } from '../docker/is-container-running';
import { composeCreatedContainerFilters } from '../docker/list-service-containers';
import { migrateConfigVolume } from '../docker/migrate-config-volume';
import {
  assertComposeAvailable,
  assertDockerEngineSupported,
} from '../docker/setup-checks';
import { findChildProject, findProject } from '../project/find-project';
import {
  resolveOrAssignProjectContext,
  resolveProjectContext,
} from '../project/project-context';
import { withLock } from '../state/with-lock';
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
  if (getOutputMode().ci || !process.stdin.isTTY || !process.stdout.isTTY)
    return;
  const opened = await openUrl(url, { onDebug: logger.debug });
  if (!opened) {
    warnLine(`Could not open browser automatically. Visit: ${url}`);
  }
}

/**
 * Wait for the local services, including the API behind the web tier.
 * The old probe fetched `${url}/health` — but that path is answered by the
 * proxy alone (it returns 200 with no platform container at all), and the
 * dev proxy's self-signed certificate failed default TLS verification on
 * every poll, so readiness was never observed. The container health is the
 * signal deploy already trusts, needs no TLS exception, and only flips once
 * the app itself is serving.
 */
async function waitForHealth(
  signal?: AbortSignal,
  maxAttempts = 120,
): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    if (signal?.aborted) return false;
    const ready = await Promise.all(
      ALL_SERVICES.map(async (service) => {
        const containerName = `${getProjectId()}-${service}`;
        const running = await isContainerRunning(containerName);
        if (!running) return false;
        const health = await getContainerHealth(containerName);
        // Match Compose --wait when an override disables a health probe.
        return health === 'healthy' || health === 'none';
      }),
    );
    if (ready.every(Boolean)) {
      return true;
    }
    await Bun.sleep(2000);
  }
  return false;
}

/** Stop only this project's local Compose containers; no setup or deletion. */
export async function stopDev(): Promise<void> {
  const projectDir = findProject();
  if (!projectDir) {
    throw preconditionError(
      'No Tale project found.',
      'Run tale dev --stop from your project directory.',
    );
  }
  await resolveProjectContext(projectDir);
  const daemon = await daemonReachable();
  if (!daemon.reachable) {
    throw preconditionError('Docker is not reachable.', daemon.detail);
  }
  const projectName = `${getProjectId()}-dev`;
  const listed = await exec(
    'docker',
    [
      'ps',
      '--quiet',
      ...composeCreatedContainerFilters(projectName),
      '--filter',
      'label=com.docker.compose.oneoff=False',
    ],
    { silent: true, timeout: 10 },
  );
  if (!listed.success) {
    throw externalDepError(
      'Could not inspect the local Tale containers.',
      new Error(listed.stderr),
    );
  }
  const ids = listed.stdout.split(/\s+/).filter(Boolean);
  if (ids.some((id) => !/^[a-f0-9]{12,64}$/.test(id))) {
    throw externalDepError(
      'Docker returned an invalid container ID; no containers were stopped.',
    );
  }
  if (ids.length === 0) {
    infoLine('Local Tale is already stopped.');
    return;
  }
  // A worker may take its whole stop grace to hand its runs on: the client
  // waits a little longer than that, so it never gives up on a stop the
  // daemon is still carrying out.
  loadEnv(projectDir);
  const stopped = await exec('docker', ['stop', ...ids], {
    timeout: backendStopGraceSeconds(BACKEND_WORKER_STOP_GRACE_S) + 30,
  });
  if (!stopped.success) {
    throw externalDepError(
      'Could not stop every local Tale container.',
      new Error(stopped.stderr),
    );
  }
  doneLine('Local Tale stopped. Your project and data are preserved.');
  infoLine('Start again with: tale dev');
}

/** The clean READY block: an ASCII rule and the app URL. */
function printReadyBlock(url: string): void {
  rule();
  doneLine(`Tale is running — open ${url}`);
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
  const origin = resolveDevOrigin(options.host, options.port);
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
  const docker = await ensureDocker({
    assumeYes: options.assumeYes ?? getOutputMode().assumeYes,
  });
  if (docker.status === 'refused' || docker.status === 'failed') {
    throw new Error(docker.detail);
  }
  await assertDockerAvailable();
  await assertComposeAvailable();
  await assertDockerEngineSupported();

  const imageVersion = pkg.version.includes('-dev') ? 'latest' : pkg.version;
  const appImage = `${env.GHCR_REGISTRY}/tale-platform:${imageVersion}`;
  const devPrefix = `${getProjectId()}-dev_`;

  // Both images the CLI needs in its own hands before compose runs, fetched
  // under a label that says so. The spawner's runtime image is a `docker run`
  // and never a compose service; the app image is what the config-mountpoint
  // helper runs on, and waiting for that download inside "Preparing volumes &
  // networks" spends minutes of a first run under a label about neither.
  await runStep(
    {
      active: 'Fetching the sandbox runtime and app images',
      done: 'Images ready',
    },
    async () => {
      await ensureSandboxRuntimeImage(env.GHCR_REGISTRY, imageVersion);
      await ensureImagePresent(appImage);
    },
  );

  await runStep(
    {
      active: 'Preparing volumes & networks',
      done: 'Volumes & networks ready',
    },
    () =>
      // Project-scoped lock so parallel `tale dev` / `tale deploy` shells can't
      // race on docker volumes. Released before compose starts.
      withLock(projectDir, 'dev', async () => {
        // One-time config-store rename before anything mounts a volume —
        // the dev compose names `config-data` too, and a dev stack that
        // came up on an empty one would look like every org config had
        // vanished. Throws on a failed copy, leaving `convex-data` intact.
        await migrateConfigVolume(devPrefix);
        if (!(await ensureVolumes([...DEV_VOLUME_NAMES], devPrefix))) {
          throw new Error('Failed to create dev volumes');
        }
        // The web tier mounts the config volume read-only and the compose file
        // nests one bind per `<slug>/<domain>` under it. runc cannot create a
        // mountpoint inside a read-only mount, and the backend only creates
        // those directories when it seeds the volume — which races the web
        // tier on a first bring-up. Creating them here settles it.
        await ensureConfigMountpoints(
          `${devPrefix}config-data`,
          orgConfigMountTargets(projectDir),
          appImage,
        );
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

  const version = imageVersion;
  const { port, host: hostAlias, siteUrl: url } = origin;

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
    const ring = new RingBuffer<string>(200);
    await runStep(
      {
        active: 'Starting Tale and waiting for services',
        done: 'Services ready',
      },
      async () => {
        const result = await dockerCompose(
          compose,
          ['up', '-d', '--wait', '--wait-timeout', '600'],
          {
            ...composeOpts,
            onLine(line) {
              ring.push(line);
            },
          },
        );
        if (!result.success) {
          if (!isUserInterrupt(result.exitCode)) detailLines(ring.tail(15));
          throw new CliError({
            summary:
              'Tale did not become ready. The containers are kept for diagnosis.',
            code: ExitCode.ExternalDep,
            next: [
              'tale status',
              'tale logs backend-api --tail 100',
              'tale logs proxy --tail 100',
              `Retry: tale dev --detach --host "${hostAlias}" --port ${port}`,
              'Stop without deleting data: tale dev --stop',
            ],
          });
        }
      },
    );
    void openBrowser(url);
    printReadyBlock(url);
    infoLine('Stop with: tale dev --stop');
    return;
  }

  // ── Foreground: attach to `docker compose up` so Ctrl-C is delivered to
  //    compose, which stops the stack gracefully (the original contract) — no
  //    manual signal handling, no compose-down spew. Build/pull/HMR noise is
  //    classified away; only meaningful lifecycle/warn/error lines surface. A
  //    concurrent announcer prints the READY block once the platform
  //    container reports healthy. ──
  const classify = createStreamClassifier(
    chain(
      classifyBuildKit,
      classifyDockerCompose,
      classifyBackend,
      classifyVite,
      classifyPlatformContainer,
    ),
  );

  const announce = (async (): Promise<void> => {
    // Patient by design: a first run pulls several GB of images before any
    // service can answer, so a bounded wait would declare failure mid-pull
    // and the READY block would never print. Poll until the stack answers or
    // compose exits (abort), with a one-time note so the wait never looks
    // hung.
    const NOTE_AFTER_MS = 120_000;
    const started = Date.now();
    let noted = false;
    let ok = false;
    while (!ok && !abortController.signal.aborted) {
      ok = await waitForHealth(abortController.signal, 30);
      if (!ok && !noted && Date.now() - started >= NOTE_AFTER_MS) {
        noted = true;
        infoLine(
          'Still waiting for services — a first run downloads several GB of images before they can start. Leave this running; rerun with --verbose for full output.',
        );
      }
    }
    if (!ok || abortController.signal.aborted) return;
    void openBrowser(url);
    printReadyBlock(url);
  })();

  infoLine('Starting Tale — press Ctrl-C to stop.');
  let result;
  try {
    result = await dockerCompose(compose, ['up'], {
      ...composeOpts,
      onLine(line) {
        const c = classify(line);
        if (c.kind === 'error') sourceLine('tale', 'error', c.text ?? c.raw);
        else if (c.kind === 'warn') sourceLine('tale', 'warn', c.text ?? c.raw);
        else if (c.kind === 'info' && c.text)
          sourceLine('tale', 'info', c.text);
        // progress/noise (layer pulls, HMR, "Watching…") collapse silently.
      },
    });
  } finally {
    abortController.abort();
    await announce;
  }

  // Compose has exited (Ctrl-C → graceful stop, or a real failure). Stop the
  // readiness announcer and report only genuine, non-interrupt failures.
  if (!result.success && !isUserInterrupt(result.exitCode)) {
    logger.error('Tale stopped unexpectedly.');
    if (result.stderr) logger.error(result.stderr);
    throw new Error('Start failed');
  }
}
