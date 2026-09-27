// `device-apply` — lays a device's containers out from its config. The CLI
// runs it once when a machine connects (`tale sandbox connect`), and the
// device's own spawner runs the NEXT release's copy when the server moves on
// (the auto-update): because the layout lives in the image, a device always
// runs the stack definition of the release it runs.
//
// The stack (all names in device-config.ts):
//   tale-device-net     internal network the sessions live on (no route out)
//   tale-device-uplink  outbound network for the spawner and the egress proxy
//   tale-device-egress  tinyproxy + SSRF firewall, `sandbox-egress` to sessions
//   tale-device-sandbox the device spawner; answers the platform's relay
//                       names (`backend-api`, `sandbox-llm-gateway`, …) on
//                       tale-device-net and dials the hub on the uplink
//
// Idempotent: a container whose spec hash still matches keeps running, so a
// re-run after a failed update only replaces what changed. Images are pulled
// BEFORE anything is stopped, so a failed pull leaves the running stack alone.

import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  IMAGE_PULL_TIMEOUT_MS,
  runDocker,
  type RunDockerResult,
} from '../spawn-util.ts';
import {
  DEVICE_EGRESS_CONTAINER,
  DEVICE_INSTANCE,
  DEVICE_SANDBOX_CONTAINER,
  DEVICE_SANDBOX_NETWORK,
  DEVICE_STACK_LABEL,
  DEVICE_UPDATER_CONTAINER,
  DEVICE_UPLINK_NETWORK,
  deviceImages,
  sessionRoot,
  writeUpdateStatus,
  type DeviceConfig,
} from './device-config.ts';
import { relayEndpoint } from './relay-policy.ts';

const SPEC_LABEL = 'tale.device-spec';
const HEALTH_TIMEOUT_MS = 180_000;

export interface ApplyDeps {
  docker: (
    args: string[],
    opts?: { timeoutMs?: number },
  ) => Promise<RunDockerResult>;
  log: (line: string) => void;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

const defaultDeps: ApplyDeps = {
  docker: (args, opts) => runDocker(args, opts),
  log: (line) => console.log(line),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: Date.now,
};

class DeviceApplyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeviceApplyError';
  }
}

async function must(
  deps: ApplyDeps,
  what: string,
  args: string[],
  timeoutMs?: number,
): Promise<string> {
  const result = await deps.docker(
    args,
    timeoutMs === undefined ? {} : { timeoutMs },
  );
  if (result.exitCode !== 0) {
    throw new DeviceApplyError(
      `${what} failed: ${result.stderr.trim() || result.stdout.trim() || `exit ${result.exitCode}`}`,
    );
  }
  return result.stdout;
}

/** Make sure the image is on the machine; answer its content id. */
async function ensurePulled(deps: ApplyDeps, image: string): Promise<string> {
  const inspect = () =>
    deps.docker(['image', 'inspect', '--format', '{{.Id}}', image]);
  const present = await inspect();
  if (present.exitCode === 0) return present.stdout.trim();
  deps.log(`Pulling ${image} …`);
  await must(
    deps,
    `docker pull ${image}`,
    ['pull', '--quiet', image],
    IMAGE_PULL_TIMEOUT_MS,
  );
  const pulled = await inspect();
  return pulled.exitCode === 0 ? pulled.stdout.trim() : image;
}

async function ensureNetwork(
  deps: ApplyDeps,
  name: string,
  internal: boolean,
): Promise<void> {
  const inspect = await deps.docker([
    'network',
    'inspect',
    '--format',
    '{{.Internal}}',
    name,
  ]);
  if (inspect.exitCode === 0) {
    if (internal && inspect.stdout.trim() !== 'true') {
      throw new DeviceApplyError(
        `network ${name} exists but is not internal — sessions would bypass the egress proxy. Remove it (docker network rm ${name}) and run \`tale sandbox update\`.`,
      );
    }
    return;
  }
  await must(deps, `docker network create ${name}`, [
    'network',
    'create',
    '--driver',
    'bridge',
    '--ipv6=false',
    '--label',
    `${DEVICE_STACK_LABEL}=network`,
    ...(internal ? ['--internal'] : []),
    name,
  ]);
}

interface ContainerSpec {
  name: string;
  role: 'egress' | 'sandbox';
  /** `docker create` arguments (without the name and spec label). */
  create: string[];
  /** Aliases on the device's internal network. */
  aliases: string[];
}

/** What makes a running container current: its arguments, its aliases and
 * the CONTENT of the images it runs — a tag rebuilt or re-pushed under the
 * same name still gets its container replaced. */
function specHash(spec: ContainerSpec, imageIds: readonly string[]): string {
  return createHash('sha256')
    .update(JSON.stringify([spec.create, spec.aliases, imageIds]))
    .digest('hex')
    .slice(0, 32);
}

export function egressSpec(config: DeviceConfig, image: string): ContainerSpec {
  return {
    name: DEVICE_EGRESS_CONTAINER,
    role: 'egress',
    aliases: ['sandbox-egress'],
    create: [
      '--restart',
      'unless-stopped',
      '--network',
      DEVICE_UPLINK_NETWORK,
      // Same posture as the deployment's egress service: all capabilities
      // dropped, the seven the entrypoint provably needs added back, IPv6 off
      // so the IPv4 firewall is the whole fence.
      '--sysctl',
      'net.ipv6.conf.all.disable_ipv6=1',
      '--sysctl',
      'net.ipv6.conf.default.disable_ipv6=1',
      '--cap-drop',
      'ALL',
      ...[
        'NET_ADMIN',
        'DAC_OVERRIDE',
        'CHOWN',
        'SETUID',
        'SETGID',
        'NET_BIND_SERVICE',
        'KILL',
      ].flatMap((cap) => ['--cap-add', cap]),
      '--memory',
      '512m',
      '--pids-limit',
      '512',
      '--ulimit',
      'nofile=4096:8192',
      '--log-opt',
      'max-size=10m',
      '--log-opt',
      'max-file=3',
      '--label',
      `tale.device-id=${config.deviceId}`,
      image,
    ],
  };
}

export function sandboxSpec(
  config: DeviceConfig,
  configPath: string,
  images: { sandbox: string; runtime: string },
): ContainerSpec {
  const aliases = new Set<string>();
  for (const relay of config.relays) {
    const { hostname } = relayEndpoint(relay.url);
    aliases.add(hostname);
    // The deployment's gateway also answers its older alias, which a session
    // pinned to a pre-rename address may still call.
    if (relay.name === 'gateway' && hostname === 'sandbox-llm-gateway') {
      aliases.add('llm-gateway');
    }
  }
  const socket = config.dockerSocket ?? '/var/run/docker.sock';
  return {
    name: DEVICE_SANDBOX_CONTAINER,
    role: 'sandbox',
    aliases: [...aliases].sort(),
    create: [
      '--restart',
      'unless-stopped',
      '--network',
      DEVICE_UPLINK_NETWORK,
      '--stop-timeout',
      '30',
      '--volume',
      `${socket}:/var/run/docker.sock`,
      // 1:1 so the paths the spawner hands the daemon (session workspaces,
      // this config) are the same inside and out.
      '--volume',
      `${config.stateDir}:${config.stateDir}`,
      '--env',
      `SANDBOX_DEVICE_CONFIG=${configPath}`,
      '--env',
      `SANDBOX_TOKEN=${config.localToken}`,
      '--env',
      `SANDBOX_HOST_SESSION_ROOT=${sessionRoot(config)}`,
      '--env',
      `SANDBOX_INSTANCE=${DEVICE_INSTANCE}`,
      '--env',
      `SANDBOX_EGRESS_NETWORK=${DEVICE_SANDBOX_NETWORK}`,
      '--env',
      'SANDBOX_EGRESS_PROXY=http://sandbox-egress:3128',
      '--env',
      `SANDBOX_RUNTIME_IMAGE=${images.runtime}`,
      '--env',
      `SANDBOX_MAX_SESSIONS=${config.maxSessions}`,
      // A device runs plain runc sessions: no privileged inner Docker on
      // someone's workstation, and no per-org build-cache daemons.
      '--env',
      'SANDBOX_DOCKER_IN_CONTAINER=false',
      '--env',
      'SANDBOX_DOCKER_BUILD_CACHE=false',
      // The runtime image is pulled by this helper, before the spawner starts.
      '--env',
      'SANDBOX_SKIP_IMAGE_WARMUP=1',
      '--memory',
      '512m',
      '--pids-limit',
      '512',
      '--log-opt',
      'max-size=10m',
      '--log-opt',
      'max-file=3',
      '--label',
      `tale.device-id=${config.deviceId}`,
      // The spawner reads its relays from the config at start: naming them
      // here puts a changed address (a port, not just a host) in the spec
      // hash, so the container is replaced when they change.
      '--label',
      `tale.device-relays=${config.relays.map((r) => `${r.name}=${r.url}`).join(',')}`,
      images.sandbox,
    ],
  };
}

async function containerState(
  deps: ApplyDeps,
  name: string,
): Promise<{ spec: string; running: boolean } | null> {
  const inspect = await deps.docker([
    'container',
    'inspect',
    '--format',
    `{{index .Config.Labels "${SPEC_LABEL}"}}|{{.State.Running}}`,
    name,
  ]);
  if (inspect.exitCode !== 0) return null;
  const [spec = '', running = ''] = inspect.stdout.trim().split('|');
  return { spec, running: running === 'true' };
}

async function waitHealthy(deps: ApplyDeps, name: string): Promise<void> {
  const deadline = deps.now() + HEALTH_TIMEOUT_MS;
  let last = '';
  while (deps.now() < deadline) {
    const res = await deps.docker([
      'container',
      'inspect',
      '--format',
      '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}',
      name,
    ]);
    last = res.stdout.trim();
    if (last === 'healthy' || last === 'running') return;
    if (last === 'exited' || last === 'dead') break;
    await deps.sleep(1_000);
  }
  const logs = await deps.docker(['logs', '--tail', '20', name]);
  throw new DeviceApplyError(
    `${name} did not become healthy (${last || 'unknown'}). Last log lines:\n${(logs.stdout + logs.stderr).trim()}`,
  );
}

/** Create (or keep) one container of the stack. Returns whether it changed. */
async function ensureContainer(
  deps: ApplyDeps,
  spec: ContainerSpec,
  imageIds: readonly string[],
): Promise<boolean> {
  const hash = specHash(spec, imageIds);
  const current = await containerState(deps, spec.name);
  if (current !== null && current.spec === hash && current.running) {
    return false;
  }
  if (current !== null) {
    deps.log(`Replacing ${spec.name} …`);
    // A graceful stop first: the spawner releases its lock and the egress
    // proxy finishes open tunnels; running sessions are not touched.
    await deps.docker(['stop', '--time', '30', spec.name], {
      timeoutMs: 60_000,
    });
    await must(
      deps,
      `docker rm ${spec.name}`,
      ['rm', '--force', spec.name],
      60_000,
    );
  }
  await must(deps, `docker create ${spec.name}`, [
    'create',
    '--name',
    spec.name,
    '--label',
    `${DEVICE_STACK_LABEL}=${spec.role}`,
    '--label',
    `${SPEC_LABEL}=${hash}`,
    ...spec.create,
  ]);
  // Attach the internal network BEFORE starting, so the process inside sees
  // both interfaces from its first instruction (dnsmasq binds at start).
  await must(deps, `docker network connect ${spec.name}`, [
    'network',
    'connect',
    ...spec.aliases.flatMap((alias) => ['--alias', alias]),
    DEVICE_SANDBOX_NETWORK,
    spec.name,
  ]);
  await must(deps, `docker start ${spec.name}`, ['start', spec.name], 60_000);
  return true;
}

async function writeState(
  config: DeviceConfig,
  state: Record<string, unknown>,
): Promise<void> {
  const path = join(config.stateDir, 'state.json');
  const tmp = `${path}.${process.pid}.tmp`;
  // Readable by the machine's user: written by root inside a container, read
  // by `tale sandbox status`, and holding no secret.
  await writeFile(tmp, JSON.stringify(state, null, 2), { mode: 0o644 });
  await rename(tmp, path);
}

/** The release the stack was last laid out at (its `state.json`), or null. */
export async function readAppliedVersion(
  config: DeviceConfig,
): Promise<string | null> {
  try {
    const parsed: unknown = JSON.parse(
      await readFile(join(config.stateDir, 'state.json'), 'utf8'),
    );
    const version =
      parsed !== null && typeof parsed === 'object'
        ? Reflect.get(parsed, 'appliedVersion')
        : undefined;
    return typeof version === 'string' ? version : null;
  } catch (err) {
    if (
      !(
        err !== null &&
        typeof err === 'object' &&
        'code' in err &&
        err.code === 'ENOENT'
      )
    ) {
      console.warn('[sandbox.devices] unreadable device state:', err);
    }
    return null;
  }
}

/** Bring the device stack to `version`. */
export async function applyDeviceStack(
  config: DeviceConfig,
  configPath: string,
  version: string,
  deps: ApplyDeps = defaultDeps,
): Promise<void> {
  const images = deviceImages(config, version);
  await mkdir(sessionRoot(config), { recursive: true });
  deps.log(`Preparing the Tale sandbox device (${version}) …`);
  // Pull everything first: nothing running is touched until the new release
  // is fully on the machine.
  const egressId = await ensurePulled(deps, images.egress);
  const sandboxId = await ensurePulled(deps, images.sandbox);
  const runtimeId = await ensurePulled(deps, images.runtime);
  await ensureNetwork(deps, DEVICE_UPLINK_NETWORK, false);
  await ensureNetwork(deps, DEVICE_SANDBOX_NETWORK, true);

  const egressChanged = await ensureContainer(
    deps,
    egressSpec(config, images.egress),
    [egressId],
  );
  await waitHealthy(deps, DEVICE_EGRESS_CONTAINER);
  // A new runtime image replaces the spawner too: it starts the sessions.
  const sandboxChanged = await ensureContainer(
    deps,
    sandboxSpec(config, configPath, images),
    [sandboxId, runtimeId],
  );
  await waitHealthy(deps, DEVICE_SANDBOX_CONTAINER);
  await writeState(config, {
    appliedVersion: version,
    images,
    appliedAtMs: deps.now(),
  });
  deps.log(
    egressChanged || sandboxChanged
      ? 'The Tale sandbox device is running.'
      : 'The Tale sandbox device was already up to date.',
  );
}

/** Launch the NEXT release's helper to replace this device's stack. It runs
 * detached in its own container, so it outlives the spawner it replaces. */
export async function launchSelfUpdate(
  config: DeviceConfig,
  configPath: string,
  version: string,
  deps: ApplyDeps = defaultDeps,
): Promise<void> {
  const image = deviceImages(config, version).sandbox;
  await writeUpdateStatus(config.stateDir, {
    state: 'updating',
    targetVersion: version,
    error: null,
    atMs: deps.now(),
  });
  const socket = config.dockerSocket ?? '/var/run/docker.sock';
  const result = await deps.docker(
    [
      'run',
      '--detach',
      '--rm',
      '--name',
      DEVICE_UPDATER_CONTAINER,
      '--label',
      `${DEVICE_STACK_LABEL}=updater`,
      '--volume',
      `${socket}:/var/run/docker.sock`,
      '--volume',
      `${config.stateDir}:${config.stateDir}`,
      image,
      'device-apply',
      configPath,
      '--version',
      version,
    ],
    { timeoutMs: IMAGE_PULL_TIMEOUT_MS },
  );
  if (result.exitCode !== 0) {
    // Another updater already holds the name: it is doing this job.
    if (/already in use/i.test(result.stderr)) return;
    const error = result.stderr.trim() || `exit ${result.exitCode}`;
    await writeUpdateStatus(config.stateDir, {
      state: 'failed',
      targetVersion: version,
      error: error.slice(0, 500),
      atMs: deps.now(),
    });
    throw new DeviceApplyError(
      `launching the ${version} updater failed: ${error}`,
    );
  }
}
