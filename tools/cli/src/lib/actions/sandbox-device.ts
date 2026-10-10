import { rm } from 'node:fs/promises';
import { hostname as osHostname } from 'node:os';

import {
  CliError,
  ExitCode,
  preconditionError,
  usageError,
} from '../../utils/fail';
import { emitJson } from '../../utils/json-output';
import * as logger from '../../utils/logger';
import { getOutputMode } from '../../utils/output-mode';
import { confirm as promptConfirm } from '../../utils/prompt';
import { ensureDocker } from '../docker/ensure-docker';
import type { ExecResult } from '../docker/exec';
import {
  buildSandboxDeviceConfig,
  cliServerUrl,
  defaultMaxSessions,
  isReleaseVersion,
  readSandboxDeviceConfig,
  sandboxDeviceConfigPath,
  sandboxDeviceHome,
  type SandboxDeviceConfig,
  writeSandboxDeviceConfig,
} from '../sandbox-device/config';
import {
  describeSandboxDevice,
  deviceWasRemoved,
  type FetchLike,
  joinSandboxDevice,
  leaveSandboxDevice,
  type SandboxDeviceSelf,
  SandboxDeviceServerError,
} from '../sandbox-device/server';
import {
  applyDeviceStack,
  defaultStackDeps,
  dockerReachable,
  readAppliedVersion,
  readStackState,
  readUpdateStatus,
  removeDeviceStack,
  showDeviceLogs,
  type StackDeps,
} from '../sandbox-device/stack';

/**
 * `tale sandbox` — turn this machine into a sandbox device of a Tale
 * organization, and look after it.
 *
 *   connect     trade the join token from Settings → Sandboxes for the
 *               device's own credential, then lay out and start the device's
 *               containers (the sandbox image's `device-apply` helper);
 *   status      the containers, the release, and the server's view;
 *   update      re-lay the stack out at the server's release (the device
 *               also does this by itself when the server is updated);
 *   disconnect  remove the device from its organization and this machine.
 */

export interface SandboxDeviceDeps extends StackDeps {
  home: () => string;
  fetch: FetchLike;
  ensureDocker: () => Promise<{ ok: boolean; detail: string }>;
  hostname: () => string;
  platform: () => { os: string; arch: string };
  sleep: (ms: number) => Promise<void>;
  confirm: (message: string) => Promise<boolean>;
  assumeYes: () => boolean;
  json: () => boolean;
}

const defaultSandboxDeviceDeps: SandboxDeviceDeps = {
  ...defaultStackDeps,
  home: sandboxDeviceHome,
  fetch: (input, init) => fetch(input, init),
  ensureDocker: async () => {
    const result = await ensureDocker({ assumeYes: getOutputMode().assumeYes });
    return {
      ok: result.status === 'ready' || result.status === 'installed',
      detail: result.detail,
    };
  },
  hostname: osHostname,
  platform: () => ({ os: process.platform, arch: process.arch }),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  confirm: (message) => promptConfirm({ message, default: false }),
  assumeYes: () => getOutputMode().assumeYes,
  json: () => getOutputMode().json,
};

const CONNECT_TIMEOUT_MS = 120_000;

/** `studio-mac.local` → `studio-mac`; something printable and short. */
export function deviceNameFrom(hostname: string): string {
  const name = hostname
    .replace(/\.(local|lan|home)$/i, '')
    .replace(/[^\w.-]+/g, '-')
    .slice(0, 64);
  return name === '' ? 'tale-device' : name;
}

async function dockerMachine(
  docker: (args: string[]) => Promise<ExecResult>,
): Promise<{
  cpus: number | null;
  memoryBytes: number | null;
  version: string | null;
}> {
  const res = await docker([
    'info',
    '--format',
    '{{.NCPU}}|{{.MemTotal}}|{{.ServerVersion}}',
  ]);
  if (!res.success) return { cpus: null, memoryBytes: null, version: null };
  const [cpus = '', memory = '', version = ''] = res.stdout.trim().split('|');
  const n = Number(cpus);
  const m = Number(memory);
  return {
    cpus: Number.isFinite(n) && n > 0 ? n : null,
    memoryBytes: Number.isFinite(m) && m > 0 ? m : null,
    version: version === '' ? null : version,
  };
}

function serverFailure(err: unknown, what: string): CliError {
  if (err instanceof SandboxDeviceServerError) {
    if (err.code === 'JOIN_TOKEN_INVALID') {
      return preconditionError(
        'This connect command has expired or was already used.',
        'Copy a new one from Settings → Sandboxes → Add device.',
      );
    }
    return new CliError({
      summary: `${what}: ${err.message}`,
      code: err.status === 0 ? ExitCode.ExternalDep : ExitCode.Generic,
    });
  }
  return new CliError({
    summary: what,
    cause: err instanceof Error ? err : String(err),
  });
}

export interface ConnectOptions {
  url: string;
  token: string;
  name?: string;
  maxSessions?: number;
  autoUpdate: boolean;
  dockerSocket?: string;
  /** Development: the URL the device's containers use to reach the site. */
  deviceServerUrl?: string;
  /** Development: explicit images (a local build) instead of a release. */
  images?: SandboxDeviceConfig['images'];
  /** Development: the image tag to run instead of the server's release. */
  imageTag?: string;
}

export async function connectSandboxDevice(
  options: ConnectOptions,
  deps: SandboxDeviceDeps = defaultSandboxDeviceDeps,
): Promise<void> {
  let url: URL;
  try {
    url = new URL(options.url);
  } catch {
    throw usageError(`"${options.url}" is not a URL`, [
      'tale sandbox connect https://your-tale-site --token tsdj_…',
    ]);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw usageError('The Tale site must be an http(s) URL');
  }
  if (!options.token.startsWith('tsdj_')) {
    throw usageError(
      'That is not a device connect token (it starts with tsdj_).',
      'Copy the command from Settings → Sandboxes → Add device.',
    );
  }
  const home = deps.home();
  const existing = await readSandboxDeviceConfig(sandboxDeviceConfigPath(home));
  if (existing !== null) {
    throw preconditionError(
      `This machine is already connected as "${existing.name}" to ${cliServerUrl(existing)}.`,
      ['tale sandbox status', 'tale sandbox disconnect   # then connect again'],
    );
  }
  const host = deps.platform();
  if (host.os !== 'linux' && host.os !== 'darwin') {
    throw preconditionError(
      `Sandbox devices run on Linux and macOS; this machine runs ${host.os}.`,
    );
  }

  const docker = await deps.ensureDocker();
  if (!docker.ok) {
    throw preconditionError(`Docker is required: ${docker.detail}`, [
      'Install Docker (https://docs.docker.com/get-docker/), start it, and run the command again.',
    ]);
  }
  const machine = await dockerMachine(deps.docker);
  const name = deviceNameFrom(options.name ?? deps.hostname());
  const maxSessions =
    options.maxSessions ??
    defaultMaxSessions(machine.cpus, machine.memoryBytes);
  const serverUrl = url.toString().replace(/\/+$/, '');

  logger.step(`Connecting this machine to ${serverUrl} as "${name}"…`);
  let joined;
  try {
    joined = await joinSandboxDevice(
      serverUrl,
      {
        token: options.token,
        name,
        maxSessions,
        platform: {
          os: host.os,
          arch: host.arch,
          cpus: machine.cpus,
          memoryBytes: machine.memoryBytes,
          dockerVersion: machine.version,
        },
      },
      deps.fetch,
    );
  } catch (err) {
    throw serverFailure(err, 'Could not connect this machine');
  }

  const version = options.imageTag ?? joined.serverVersion;
  const hasImages = options.images?.sandbox !== undefined;
  if (!isReleaseVersion(version) && !hasImages) {
    try {
      await leaveSandboxDevice(serverUrl, joined.deviceSecret, deps.fetch);
    } catch (cleanupError) {
      logger.warn(
        `Could not revoke the development device registration: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`,
      );
    }
    throw preconditionError(
      `The server runs a development build (${version || 'unknown'}), which publishes no images to follow.`,
      [
        'tale sandbox update --image-tag <release>',
        'or run a released Tale server, then: tale sandbox update',
      ],
    );
  }
  const config = buildSandboxDeviceConfig(joined, {
    stateDir: home,
    maxSessions,
    host: { os: host.os, arch: host.arch, hostname: deps.hostname() },
    autoUpdate: options.autoUpdate,
    cliServerUrl: serverUrl,
    ...(options.deviceServerUrl !== undefined
      ? { deviceServerUrl: options.deviceServerUrl }
      : {}),
    ...(options.images !== undefined ? { images: options.images } : {}),
    ...(options.dockerSocket !== undefined
      ? { dockerSocket: options.dockerSocket }
      : {}),
  });
  await writeSandboxDeviceConfig(config, sandboxDeviceConfigPath(home));

  logger.step(
    `Starting the sandbox device (Tale ${version}). The first start downloads the sandbox images, which can take a few minutes…`,
  );
  try {
    await applyDeviceStack(
      config,
      sandboxDeviceConfigPath(home),
      version,
      deps,
    );
  } catch (err) {
    throw new CliError({
      summary:
        'The machine is registered, but its sandbox containers did not start.',
      cause: err instanceof Error ? err : String(err),
      next: [
        'tale sandbox update       # try again',
        'tale sandbox logs',
        'tale sandbox disconnect   # undo',
      ],
    });
  }

  logger.step('Waiting for the device to reach the server…');
  const deadline = Date.now() + CONNECT_TIMEOUT_MS;
  let self: SandboxDeviceSelf | null = null;
  while (Date.now() < deadline) {
    try {
      self = await describeSandboxDevice(
        serverUrl,
        config.deviceSecret,
        deps.fetch,
      );
      if (self.connected) break;
    } catch (err) {
      logger.debug(
        `device status not available yet: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    await deps.sleep(2_000);
  }
  if (self?.connected !== true) {
    logger.warn(
      'The device started but has not reached the server yet. It keeps trying in the background.',
    );
    logger.info('See what it is doing: tale sandbox logs --follow');
    return;
  }
  logger.success(
    `"${name}" is connected${self.organizationName ? ` to ${self.organizationName}` : ''}. It runs up to ${maxSessions} sandbox${maxSessions === 1 ? '' : 'es'} at a time, keeps running after restarts and updates itself when Tale is updated.`,
  );
  logger.info('Check it any time: tale sandbox status');
}

export interface SandboxDeviceStatusReport {
  connected: boolean;
  configured: boolean;
  name?: string;
  server?: string;
  organization?: string | null;
  serverReachable?: boolean;
  removedFromOrganization?: boolean;
  appliedVersion?: string | null;
  serverVersion?: string | null;
  containers?: {
    sandbox: string;
    egress: string;
  };
  runningSandboxes?: number;
  maxSessions?: number;
  update?: {
    state: string;
    targetVersion: string | null;
    error: string | null;
  } | null;
}

function containerLabel(
  state: { status: string; health: string | null } | null,
): string {
  if (state === null) return 'missing';
  return state.health ? `${state.status} (${state.health})` : state.status;
}

export async function sandboxDeviceStatus(
  deps: SandboxDeviceDeps = defaultSandboxDeviceDeps,
): Promise<SandboxDeviceStatusReport> {
  const config = await readSandboxDeviceConfig(
    sandboxDeviceConfigPath(deps.home()),
  );
  if (config === null) {
    const report: SandboxDeviceStatusReport = {
      connected: false,
      configured: false,
    };
    if (deps.json()) emitJson('sandbox status', report);
    else {
      logger.info('This machine is not connected to a Tale organization.');
      logger.info(
        'Add it from Settings → Sandboxes → Add device, which gives you the command to run here.',
      );
    }
    return report;
  }
  const [stack, appliedVersion, update] = await Promise.all([
    readStackState(deps),
    readAppliedVersion(config.stateDir),
    readUpdateStatus(config.stateDir),
  ]);
  let self: SandboxDeviceSelf | null = null;
  let serverReachable = true;
  let removed = false;
  try {
    self = await describeSandboxDevice(
      cliServerUrl(config),
      config.deviceSecret,
      deps.fetch,
    );
  } catch (err) {
    if (deviceWasRemoved(err)) {
      removed = true;
    } else {
      serverReachable = false;
      logger.debug(
        `server status unavailable: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  const report: SandboxDeviceStatusReport = {
    connected: self?.connected === true,
    configured: true,
    name: config.name,
    server: cliServerUrl(config),
    organization: self?.organizationName ?? null,
    serverReachable,
    removedFromOrganization: removed,
    appliedVersion,
    serverVersion: self?.serverVersion ?? null,
    containers: {
      sandbox: containerLabel(stack.sandbox),
      egress: containerLabel(stack.egress),
    },
    runningSandboxes: stack.sessions,
    maxSessions: config.maxSessions,
    update,
  };
  if (deps.json()) {
    emitJson('sandbox status', report);
    return report;
  }
  logger.header(`Sandbox device "${config.name}"`);
  logger.table([
    ['Server', report.server ?? ''],
    ['Organization', report.organization ?? '—'],
    [
      'Connection',
      removed
        ? 'removed from its organization'
        : !serverReachable
          ? 'server unreachable'
          : report.connected
            ? 'connected'
            : 'not connected',
    ],
    ['Release', appliedVersion ?? '—'],
    ['Server release', report.serverVersion ?? '—'],
    ['Sandboxes running', `${stack.sessions} of up to ${config.maxSessions}`],
    ['Device container', report.containers?.sandbox ?? ''],
    ['Egress container', report.containers?.egress ?? ''],
  ]);
  if (update?.state === 'failed') {
    logger.warn(
      `The last automatic update (to ${update.targetVersion ?? '?'}) failed: ${update.error ?? 'unknown error'}. Run: tale sandbox update`,
    );
  }
  if (removed) {
    logger.warn(
      'The organization removed this device. Run tale sandbox disconnect to clean up this machine.',
    );
  }
  return report;
}

export async function updateSandboxDevice(
  options: { imageTag?: string },
  deps: SandboxDeviceDeps = defaultSandboxDeviceDeps,
): Promise<void> {
  const path = sandboxDeviceConfigPath(deps.home());
  const config = await readSandboxDeviceConfig(path);
  if (config === null) {
    throw preconditionError('This machine is not connected to Tale.', [
      'tale sandbox connect <site> --token <token>',
    ]);
  }
  let self: SandboxDeviceSelf | null = null;
  try {
    self = await describeSandboxDevice(
      cliServerUrl(config),
      config.deviceSecret,
      deps.fetch,
    );
  } catch (err) {
    // An explicit release needs nothing from the server.
    if (options.imageTag === undefined) {
      throw serverFailure(err, 'Could not ask the server for its release');
    }
    logger.warn(
      `Could not reach the server (${err instanceof Error ? err.message : String(err)}); keeping this device's sandbox addresses.`,
    );
  }
  const version = options.imageTag ?? self?.serverVersion ?? '';
  // The addresses sessions call can change after the device joined (the
  // operator moved the backend or the gateway): take the server's current
  // ones, which the stack below lays out.
  let current = config;
  if (
    self !== null &&
    self.relays !== null &&
    JSON.stringify(self.relays) !== JSON.stringify(config.relays)
  ) {
    current = { ...config, relays: self.relays };
    await writeSandboxDeviceConfig(current, path);
    logger.info("Took the server's current sandbox addresses.");
  }
  if (!isReleaseVersion(version) && config.images?.sandbox === undefined) {
    throw preconditionError(
      `The server runs a development build (${version || 'unknown'}), which publishes no images to follow.`,
      ['tale sandbox update --image-tag <release>'],
    );
  }
  logger.step(`Updating the sandbox device to Tale ${version}…`);
  await applyDeviceStack(current, path, version, deps);
  logger.success(`The sandbox device runs Tale ${version}.`);
}

export async function disconnectSandboxDevice(
  options: { keepData: boolean; force: boolean },
  deps: SandboxDeviceDeps = defaultSandboxDeviceDeps,
): Promise<void> {
  const path = sandboxDeviceConfigPath(deps.home());
  const config = await readSandboxDeviceConfig(path);
  if (config === null) {
    logger.info('This machine is not connected to a Tale organization.');
    return;
  }
  if (!options.force && !deps.assumeYes()) {
    const consequence = options.keepData
      ? 'Its sandboxes stop; their workspaces stay on this machine.'
      : 'Its sandboxes stop and their workspaces are deleted from this machine.';
    const ok = await deps.confirm(
      `Disconnect "${config.name}" from ${cliServerUrl(config)}? ${consequence}`,
    );
    if (!ok) {
      logger.info('Nothing changed.');
      return;
    }
  }
  // Nothing changes unless the device's containers can go too: they restart
  // with Docker, and without their config they would be stranded.
  if (!(await dockerReachable(deps))) {
    throw preconditionError(
      'Docker is not running, so the sandbox device cannot be stopped. Nothing changed.',
      ['Start Docker, then run `tale sandbox disconnect` again.'],
    );
  }
  try {
    await leaveSandboxDevice(
      cliServerUrl(config),
      config.deviceSecret,
      deps.fetch,
    );
    logger.success('Removed the device from its organization.');
  } catch (err) {
    if (deviceWasRemoved(err)) {
      logger.info('The organization had already removed this device.');
    } else {
      logger.warn(
        `Could not reach the server (${err instanceof Error ? err.message : String(err)}). An admin can remove "${config.name}" in Settings → Sandboxes → Devices.`,
      );
    }
  }
  const { containers } = await removeDeviceStack(
    config,
    { purgeData: !options.keepData },
    deps,
  );
  logger.success(
    `Stopped the sandbox device (${containers} container${containers === 1 ? '' : 's'} removed).`,
  );
  if (options.keepData) {
    // The credential is dead either way; keep only the workspaces.
    await rm(path, { force: true });
    logger.info(`Workspaces kept in ${config.stateDir}/sessions.`);
  } else {
    logger.info(`Removed ${config.stateDir}.`);
  }
}

export async function sandboxDeviceLogs(
  options: { follow: boolean; tail: number },
  deps: SandboxDeviceDeps = defaultSandboxDeviceDeps,
): Promise<void> {
  const config = await readSandboxDeviceConfig(
    sandboxDeviceConfigPath(deps.home()),
  );
  if (config === null) {
    throw preconditionError('This machine is not connected to Tale.');
  }
  const code = await showDeviceLogs(options, deps);
  if (code !== 0) {
    throw preconditionError(
      'The device container is not there.',
      'tale sandbox update   # lays the device out again',
    );
  }
}
