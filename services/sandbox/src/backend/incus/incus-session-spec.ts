// The Incus instance of a session, as pure functions of the spawner's config —
// the Incus analogue of docker-session-args.ts and k8s-session-pod-spec.ts, so
// a unit test can read the whole create body without a node.
//
// A session is an OCI application container made from the runtime image the
// Docker and Kubernetes backends run. Incus copies the image's own ENV, user
// and working directory into the instance at creation; the config here
// overrides what a session needs differently (the entrypoint's `daemon`
// argument, the user, the proxy, the limits, the labels).
//
// What the instance does NOT get, and why:
//  - `limits.memory.swap`, `limits.memory.oom_priority`, `raw.*`: low-level
//    keys a restricted project refuses unless it allows every low-level key
//    (raw.lxc included), which a sandbox project must not. Swap is the node's
//    business (keep it off); the OOM order is Incus's default.
//  - a NIC: the profile owns it, with its ACL and port isolation. An instance
//    device of the same name replaces the profile's wholesale, which would
//    drop both.
//  - the user's seed environment: it reaches runnerd over its own API after
//    readiness, never the instance config (anyone who can read the instance
//    would read it).
//
// What it gets in their place is what Incus offers a restricted project: an
// unprivileged container with an isolated idmap of its own, Incus's default
// seccomp and AppArmor policy, no guest API, and `no_new_privs` on everything
// the entrypoint starts (below), which is Docker's `no-new-privileges`.

import { createHash } from 'node:crypto';

import { isIpv4Address, parseDindInnerPool } from '../../network-address.ts';
import { transparentEgressSupported } from '../../runtime-tier.ts';
import { RUNNERD_INCARNATION_ENV } from '../../session/runnerd-protocol.ts';
import {
  DEFAULT_SESSION_PROFILE,
  isAgentSessionProfile,
  SESSION_NO_PROXY,
  sessionAgentProfile,
  sessionDindEnabled,
  sessionPinsEgressAddress,
} from '../../session/session-profile.ts';
import type {
  IncusConfig,
  SessionAgentProfileConfig,
  SpawnerConfig,
} from '../../types.ts';
import type { SandboxSessionProfile } from '../../wire.ts';
import type {
  IncusConfigMap,
  IncusDevices,
  IncusInstanceCreate,
  IncusVolumeCreate,
} from './incus-api.ts';
import {
  incusInstanceName,
  incusWorkspaceVolumeName,
  LABEL,
} from './incus-naming.ts';
import { claimFile, STANDBY_COMMAND } from './incus-standby.ts';
import { toIncusSize } from './incus-units.ts';

/** Where a session's workspace volume is mounted. */
const WORKSPACE_PATH = '/agent';
/** The image's entrypoint and its dispatch argument. */
const SESSION_COMMAND = '/docker-entrypoint.sh daemon';
/**
 * Sets `no_new_privs` before the entrypoint runs: no program it starts, however
 * deep, gains privilege through a setuid bit or file capabilities (`su`,
 * `newuidmap`, `mount` are in the image), which is what Docker's
 * `no-new-privileges` does for the other backends. The entrypoint's own drop
 * from root to the profile user is a privilege reduction, which the bit allows.
 * Incus has no config key for it in a restricted project (`raw.lxc` is
 * forbidden), so the entrypoint is wrapped instead. `setpriv` is util-linux's,
 * which the image installs for exactly that drop.
 */
const NO_NEW_PRIVS = '/usr/bin/setpriv --no-new-privs --';
const ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const ORG_RE = /^[a-zA-Z0-9_-]{1,128}$/;
const TOKEN_RE = /^[a-f0-9]{1,128}$/;

/** The Incus section of a spawner config that selected the Incus backend. */
export function incusOf(cfg: SpawnerConfig): IncusConfig {
  if (cfg.incus === undefined) {
    throw new Error('the Incus backend needs SANDBOX_BACKEND=incus');
  }
  return cfg.incus;
}

/** What differs between sessions as far as the instance goes. */
export interface SessionShape {
  profile: SandboxSessionProfile;
  /** Docker inside. */
  dind: boolean;
  limits: SessionAgentProfileConfig;
  /** Transparent egress through redsocks, installed by the entrypoint. */
  transparentEgress: boolean;
  /** The entrypoint starts as root and drops to uid:gid itself (Docker
   * inside, or transparent egress, which needs to install iptables rules). */
  bootsAsRoot: boolean;
  uid: number;
  gid: number;
}

export function sessionShape(
  cfg: SpawnerConfig,
  profile: SandboxSessionProfile,
  docker?: boolean,
): SessionShape {
  const dind = sessionDindEnabled(cfg, profile, docker);
  const limits = isAgentSessionProfile(profile)
    ? sessionAgentProfile(cfg, dind)
    : DEFAULT_SESSION_PROFILE;
  const transparentEgress =
    cfg.transparentEgress && transparentEgressSupported(cfg.runtimeTier);
  return {
    profile,
    dind,
    limits,
    transparentEgress,
    bootsAsRoot: dind || transparentEgress,
    uid: limits.uid,
    gid: limits.gid,
  };
}

/** The proxy address a session pins, when it pins one: the literal the
 * config requires, recorded so a changed address is noticed. */
export function pinnedEgressAddress(
  cfg: SpawnerConfig,
  shape: SessionShape,
): string | undefined {
  if (!sessionPinsEgressAddress(cfg, shape.dind)) return undefined;
  const { hostname } = new URL(cfg.egressProxy);
  return isIpv4Address(hostname) ? hostname : undefined;
}

function assertSafe(name: string, value: string, re: RegExp): void {
  if (!re.test(value)) {
    throw new Error(
      `incus-session-spec: ${name} rejected by safety regex: ${JSON.stringify(value)}`,
    );
  }
}

function requireSize(variable: string, value: string): string {
  const size = toIncusSize(value);
  if (size === undefined) {
    throw new Error(`incus-session-spec: ${variable} is no size: ${value}`);
  }
  return size;
}

// ---- the environment ------------------------------------------------------

/** The variables every session of a shape shares; the per-session token and
 * incarnation come on top (cold) or with the claim (standby). */
function sharedEnvironment(
  cfg: SpawnerConfig,
  shape: SessionShape,
): Record<string, string> {
  const env: Record<string, string> = {
    HTTPS_PROXY: cfg.egressProxy,
    HTTP_PROXY: cfg.egressProxy,
    NO_PROXY: SESSION_NO_PROXY,
    // HOME on the persistent workspace so agent state survives every exec
    // and a resume.
    HOME: '/agent/.runtime/home',
    TALE_EXEC_STALL_MS: String(cfg.session.execStallMs),
    TALE_EXEC_ADMISSION_MEMORY_PERCENT: String(
      cfg.session.execAdmissionMemoryPercent,
    ),
  };
  if (shape.dind) {
    env.TALE_DIND = '1';
    // The entrypoint asserts, for the tier it is told, that container root is
    // not host root. An unprivileged, idmap-isolated Incus container is that
    // tier.
    env.TALE_RUNTIME_TIER = cfg.runtimeTier;
    if (cfg.dindInnerPool !== undefined) {
      env.TALE_DIND_INNER_POOL_OVERRIDE = parseDindInnerPool(cfg.dindInnerPool);
    }
  }
  if (shape.transparentEgress) {
    env.TALE_TRANSPARENT_EGRESS = '1';
    if (!shape.dind) {
      env.TALE_DROP_UID = String(shape.uid);
      env.TALE_DROP_GID = String(shape.gid);
    }
  }
  return env;
}

/**
 * The command line of an instance's main process. A session with Docker
 * inside keeps the privileges to grow: its inner engine runs containers whose
 * runtime needs them, and the Docker backend leaves `no-new-privileges` off
 * for it too.
 */
function launchCommand(shape: SessionShape, command: string): string {
  return shape.dind ? command : `${NO_NEW_PRIVS} ${command}`;
}

function asConfig(env: Record<string, string>): IncusConfigMap {
  return Object.fromEntries(
    Object.entries(env).map(([name, value]) => [`environment.${name}`, value]),
  );
}

// ---- the instance's own config and devices ---------------------------------

function resourceConfig(
  cfg: SpawnerConfig,
  shape: SessionShape,
): IncusConfigMap {
  const { limits } = shape;
  const kernel: IncusConfigMap = shape.dind
    ? {
        // The inner dockerd inherits these: a per-file cap would fail layer
        // extraction, and it needs a daemon-class descriptor budget.
        'limits.kernel.nofile': `${Math.max(limits.nofileSoft, 65536)}:${Math.max(limits.nofileHard, 1048576)}`,
      }
    : {
        'limits.kernel.nofile': `${limits.nofileSoft}:${limits.nofileHard}`,
        'limits.kernel.fsize': String(limits.fsizeBytes),
      };
  return {
    // `--cpus=N`: a hard quota of N CPUs' worth of time.
    'limits.cpu.allowance': `${Math.round(limits.cpus * 100)}ms/100ms`,
    'limits.memory': requireSize('profile memory', limits.memory),
    // The inner dockerd and every nested build share the cgroup's pid budget.
    'limits.processes': String(
      shape.dind ? Math.max(limits.pidsLimit, 16384) : limits.pidsLimit,
    ),
    ...kernel,
    'limits.kernel.core': '0:0',
    // Sessions are IPv4-only, as on the Docker network.
    'linux.sysctl.net.ipv6.conf.all.disable_ipv6': '1',
    'linux.sysctl.net.ipv6.conf.default.disable_ipv6': '1',
    ...(shape.dind ? incusOf(cfg).dockerConfig : {}),
  };
}

function baseConfig(
  cfg: SpawnerConfig,
  shape: SessionShape,
  command: string,
  bootUser: { uid: number; gid: number },
): IncusConfigMap {
  return {
    'security.idmap.isolated': 'true',
    // /dev/incus would let session code talk to the node's guest API.
    'security.guestapi': 'false',
    // An instance does not come back by itself after the node restarts: its
    // runnerd and every exec would be gone, as with a Docker container that
    // has no restart policy.
    'boot.autostart': 'false',
    'oci.entrypoint': command,
    'oci.uid': String(bootUser.uid),
    'oci.gid': String(bootUser.gid),
    'oci.dns.nameservers': incusOf(cfg).dns.join(','),
    ...resourceConfig(cfg, shape),
    ...asConfig(sharedEnvironment(cfg, shape)),
  };
}

function sharedDevices(cfg: SpawnerConfig, shape: SessionShape): IncusDevices {
  const incus = incusOf(cfg);
  if (!incus.shmDevice) return {};
  return {
    // Chromium (Playwright) crashes on the 64 MiB /dev/shm the image mounts.
    shm: {
      type: 'disk',
      source: 'tmpfs:',
      path: '/dev/shm',
      size: requireSize('shm size', incus.shmSize ?? shape.limits.shmSize),
      'initial.mode': '1777',
    },
  };
}

function workspaceDevice(cfg: SpawnerConfig, sessionId: string): IncusDevices {
  return {
    workspace: {
      type: 'disk',
      pool: incusOf(cfg).storagePool,
      source: incusWorkspaceVolumeName(sessionId),
      path: WORKSPACE_PATH,
    },
  };
}

// ---- a session ----------------------------------------------------------------

export interface SessionInstanceInput {
  sessionId: string;
  organizationId: string;
  profile: SandboxSessionProfile;
  docker?: boolean;
  createdAtMs: number;
  /** Random per create attempt; a failed create removes only its own. */
  createAttemptId: string;
  /** The session's runnerd token (deriveRunnerdToken). */
  runnerdToken: string;
  /** The proxy address the session pins, when it pins one. */
  egressAddress?: string;
  /** When the create gives up; peers read it to tell an abandoned start. */
  startupDeadlineMs: number;
}

function assertInput(input: SessionInstanceInput): void {
  assertSafe('sessionId', input.sessionId, ID_RE);
  assertSafe('organizationId', input.organizationId, ORG_RE);
  assertSafe('createAttemptId', input.createAttemptId, ID_RE);
  assertSafe('runnerdToken', input.runnerdToken, TOKEN_RE);
  if (
    input.egressAddress !== undefined &&
    !isIpv4Address(input.egressAddress)
  ) {
    throw new Error(
      `incus-session-spec: egressAddress rejected by safety check: ${JSON.stringify(input.egressAddress)}`,
    );
  }
}

/** The `user.*` keys that make the instance a session. */
function sessionLabels(
  cfg: SpawnerConfig,
  shape: SessionShape,
  input: SessionInstanceInput,
): IncusConfigMap {
  return {
    [LABEL.sandboxSession]: '1',
    [LABEL.session]: input.sessionId,
    [LABEL.organization]: input.organizationId,
    [LABEL.profile]: input.profile,
    [LABEL.docker]: String(shape.dind),
    [LABEL.created]: String(input.createdAtMs),
    [LABEL.createAttempt]: input.createAttemptId,
    [LABEL.startupDeadline]: String(input.startupDeadlineMs),
    ...(cfg.instance === '' ? {} : { [LABEL.spawnerInstance]: cfg.instance }),
    ...(input.egressAddress === undefined
      ? {}
      : { [LABEL.egress]: input.egressAddress }),
  };
}

/**
 * The create of a session started cold: the instance with its final name,
 * its token and incarnation in the environment, the workspace volume
 * attached, started in the same operation.
 */
export function buildSessionInstance(
  cfg: SpawnerConfig,
  input: SessionInstanceInput,
): IncusInstanceCreate {
  assertInput(input);
  const incus = incusOf(cfg);
  const shape = sessionShape(cfg, input.profile, input.docker);
  const bootUser = shape.bootsAsRoot
    ? { uid: 0, gid: 0 }
    : { uid: shape.uid, gid: shape.gid };
  return {
    name: incusInstanceName(input.sessionId),
    // A stopped session leaves nothing but its workspace.
    ephemeral: true,
    profiles: [incus.profile],
    config: {
      ...baseConfig(
        cfg,
        shape,
        launchCommand(shape, SESSION_COMMAND),
        bootUser,
      ),
      ...asConfig({
        TALE_RUNNERD_TOKEN: input.runnerdToken,
        [RUNNERD_INCARNATION_ENV]: String(input.createdAtMs),
      }),
      ...sessionLabels(cfg, shape, input),
    },
    devices: {
      ...sharedDevices(cfg, shape),
      ...workspaceDevice(cfg, input.sessionId),
    },
    source: { type: 'image', alias: incus.image },
    start: true,
  };
}

/**
 * The workspace volume: a quota'd custom volume that outlives the instance.
 * `security.shifted` lets every new instance (each with an idmap of its own)
 * mount it without Incus rewriting the ownership of every file first; the
 * initial owner is the session's user.
 */
export function buildWorkspaceVolume(
  cfg: SpawnerConfig,
  input: Pick<SessionInstanceInput, 'sessionId' | 'organizationId' | 'profile'>,
  poolDriver: string,
): IncusVolumeCreate {
  assertSafe('sessionId', input.sessionId, ID_RE);
  assertSafe('organizationId', input.organizationId, ORG_RE);
  const shape = sessionShape(cfg, input.profile);
  return {
    name: incusWorkspaceVolumeName(input.sessionId),
    type: 'custom',
    content_type: 'filesystem',
    config: {
      size: incusOf(cfg).workspaceSize,
      'security.shifted': 'true',
      'initial.uid': String(shape.uid),
      'initial.gid': String(shape.gid),
      'initial.mode': '755',
      // The quota should not count the snapshots a backup takes.
      ...(poolDriver === 'zfs' ? { 'zfs.use_refquota': 'true' } : {}),
      [LABEL.workspace]: '1',
      [LABEL.session]: input.sessionId,
      [LABEL.organization]: input.organizationId,
      [LABEL.profile]: input.profile,
      ...(cfg.instance === '' ? {} : { [LABEL.spawnerInstance]: cfg.instance }),
    },
  };
}

// ---- the warm pool ---------------------------------------------------------

/** The one shape the pool keeps ready: an agent session with the
 * deployment's default Docker capability. */
export function poolShape(cfg: SpawnerConfig): SessionShape {
  return sessionShape(cfg, 'agent');
}

/** Can a standby of the pool shape become this session? */
export function poolServes(pool: SessionShape, shape: SessionShape): boolean {
  return isAgentSessionProfile(shape.profile) && shape.dind === pool.dind;
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function standbyStaticSpec(cfg: SpawnerConfig, shape: SessionShape) {
  const incus = incusOf(cfg);
  return {
    profiles: [incus.profile],
    config: baseConfig(cfg, shape, launchCommand(shape, STANDBY_COMMAND), {
      uid: 0,
      gid: 0,
    }),
    devices: sharedDevices(cfg, shape),
    image: incus.image,
  };
}

/** A fingerprint of everything a standby is made of apart from its name: a
 * standby made under another config (a moved proxy, a new limit) no longer
 * matches and is replaced. */
export function poolFingerprint(
  cfg: SpawnerConfig,
  shape: SessionShape,
): string {
  return createHash('sha256')
    .update(stable(standbyStaticSpec(cfg, shape)))
    .digest('hex')
    .slice(0, 16);
}

/** The create of a standby: stopped, so the standby script can be pushed
 * into it before it first runs. */
export function buildPoolInstance(
  cfg: SpawnerConfig,
  shape: SessionShape,
  entry: { name: string; imageFingerprint: string; nowMs: number },
): IncusInstanceCreate {
  const spec = standbyStaticSpec(cfg, shape);
  return {
    name: entry.name,
    ephemeral: true,
    profiles: spec.profiles,
    config: {
      ...spec.config,
      [LABEL.pool]: poolFingerprint(cfg, shape),
      [LABEL.poolImage]: entry.imageFingerprint,
      [LABEL.poolSince]: String(entry.nowMs),
      ...(cfg.instance === '' ? {} : { [LABEL.spawnerInstance]: cfg.instance }),
    },
    devices: spec.devices,
    source: { type: 'image', alias: spec.image },
    start: false,
  };
}

/**
 * What turns a standby into a session: the labels and the workspace volume
 * (one instance PATCH — an emptied pool label reads as removed) and the claim
 * file the standby script is waiting for.
 */
export function buildClaim(
  cfg: SpawnerConfig,
  shape: SessionShape,
  input: SessionInstanceInput,
): { patch: { config: IncusConfigMap; devices: IncusDevices }; file: string } {
  assertInput(input);
  const variables: Record<string, string> = {
    TALE_RUNNERD_TOKEN: input.runnerdToken,
    [RUNNERD_INCARNATION_ENV]: String(input.createdAtMs),
  };
  if (!shape.bootsAsRoot) {
    // The standby boots as root; nothing in the entrypoint would drop it.
    variables.TALE_STANDBY_UID = String(shape.uid);
    variables.TALE_STANDBY_GID = String(shape.gid);
  }
  return {
    patch: {
      config: {
        ...sessionLabels(cfg, shape, input),
        [LABEL.pool]: '',
        [LABEL.poolImage]: '',
        [LABEL.poolSince]: '',
      },
      devices: workspaceDevice(cfg, input.sessionId),
    },
    file: claimFile(variables),
  };
}
