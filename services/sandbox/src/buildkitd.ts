// Persistent build cache shared only by sessions from one organization.
// Each daemon and its registry mirrors have private volumes and an internal
// organization network. Legacy global resources are never adopted; their
// retirement (buildkit-resources.ts retireLegacyBuildkitd) stops and, after
// the cache retention, removes them.

import { createHash } from 'node:crypto';
import { statfs } from 'node:fs/promises';

import type { BuildCacheUpkeep } from './backend/types.ts';
import {
  DEFAULT_CACHE_RETENTION_MS,
  ensureBuildkitNetwork,
  ensureBuildkitVolume,
  forgetKnownEgress,
  inspectBuildkitContainer,
  inspectBuildkitHelper,
  inspectBuildkitHelpers,
  readDockerMetadata,
  removeBuildkitNetwork,
  removeBuildkitVolume,
  retireLegacyBuildkitd,
  type BuildkitHelperObservation,
  type BuildkitHelperReading,
  type BuildkitNetworkPlan,
} from './buildkit-resources.ts';
import {
  operationSignal,
  outsideOperationBudget,
  waitWithinOperation,
  withOperationBudget,
} from './operation-budget.ts';
import { dockerTarget, runDocker } from './spawn-util.ts';
import type { SpawnerConfig } from './types.ts';

const ORG_RE = /^[a-zA-Z0-9_-]{1,128}$/;

// gRPC port the buildkitd listens on (matches services/sandbox-buildkitd/
// buildkitd.toml). On the internal sandbox network only; never host-published.
const BUILDKITD_PORT = 1234;

// Marker the buildkitd entrypoint (services/sandbox-buildkitd/
// docker-entrypoint.sh) writes ONLY after its transparent-egress fence is fully
// installed (redsocks + default route + a [dns] block pinned to the CURRENT
// egress IP). We probe it before reusing a running daemon: one that restarted
// (--restart unless-stopped) while sandbox-egress was unreachable comes up with
// no fence and silently serves builds with no internet (RUN steps fail to
// resolve any external host). Keep this path in sync with EGRESS_READY in the
// entrypoint.
export const EGRESS_READY_MARKER = '/run/tale-buildkitd-egress-ready';

// The live buildkitd config the entrypoint regenerates on every start: it
// appends a `[dns] nameservers = ["<egress-ip>"]` block pinned to the egress
// IP resolved AT THAT MOMENT. We read it back to detect drift — sandbox-egress
// is recreated (and can land on a new IP) by every stack restart (`bun dev`,
// `docker:dev`, `docker compose up`, `tale deploy`) while this --restart
// unless-stopped daemon keeps running with the now-stale nameserver. Keep this
// path in sync with LIVE_TOML in the entrypoint.
export const BUILDKITD_LIVE_TOML = '/etc/buildkit/buildkitd.toml';

const IPV4_RE = /^(?:\d{1,3}\.){3}\d{1,3}$/;

/**
 * Hostname the buildkitd resolves the egress proxy by (e.g. `sandbox-egress`
 * from `http://sandbox-egress:3128`). Returns null if the URL has no host — the
 * caller then skips drift detection rather than guessing.
 */
export function egressProxyHostname(proxyUrl: string): string | null {
  try {
    const host = new URL(proxyUrl).hostname;
    return host.length > 0 ? host : null;
  } catch {
    return null;
  }
}

/** First IPv4 token of `getent hosts <name>` output (`172.18.0.7  name`). */
export function firstIpv4(getentOutput: string): string | null {
  const token = getentOutput.trim().split(/\s+/)[0] ?? '';
  return IPV4_RE.test(token) ? token : null;
}

/**
 * The IP the live `[dns]` block pins RUN-step resolution to, parsed from the
 * buildkitd.toml the entrypoint writes. Null when there is no `[dns]` block —
 * i.e. the egress fence was never installed (TALE_SKIP_EGRESS dev mode, or a
 * boot where the egress was unreachable), in which case there is nothing to
 * compare and drift detection is skipped.
 */
export function parseDnsNameserver(tomlText: string): string | null {
  const match = tomlText.match(
    /nameservers\s*=\s*\[\s*"(\d{1,3}(?:\.\d{1,3}){3})"/,
  );
  return match?.[1] ?? null;
}

// Pull-through registry mirrors. buildkit's image-PULL DNS runs in the daemon
// process via Go's resolver against docker's embedded resolver (127.0.0.11),
// which SERVFAILs Go's queries for EXTERNAL names on a user-defined network
// ("server misbehaving") — and can't be fixed from inside the container
// (resolv.conf / [dns] / GODEBUG all ignored for pulls). The robust fix is to
// never resolve an upstream registry from buildkit at all: one registry
// pull-through cache PER upstream registry, each referenced by its docker NAME
// (a SIBLING name, which the embedded resolver answers locally without
// forwarding → no SERVFAIL). buildkit pulls base images by name from the mirror;
// the mirror reaches upstream via the egress proxy (HTTPS_PROXY) so it needs no
// external DNS itself, and caches base-image layers across sessions (a bonus).
// A `FROM` base from a registry NOT in this list can't be pulled (so the default
// covers the common base-image registries; extend via the config env).
const MIRROR_PORT = 5000;
const MIRROR_PREFIX = 'tale-buildkitd-mirror';
// The base-image registries we stand up a pull-through cache for, built in. A
// `FROM` base from a registry NOT mirrored here can't be pulled (buildkit can't
// resolve its external name), so this covers the common public registries
// directly — no operator config to get right. Add one here to support more.
export const MIRROR_REGISTRIES = ['docker.io', 'ghcr.io', 'quay.io'] as const;

function registryLabel(registry: string): string {
  if (!MIRROR_REGISTRIES.some((known) => known === registry)) {
    throw new Error(`buildkitd: unsupported mirror registry ${registry}`);
  }
  return registry.replaceAll('.', '-');
}

/** Per-organization, per-registry pull-through cache container name. */
export function buildkitdMirrorContainerName(
  organizationId: string,
  registry: string,
): string {
  return `${MIRROR_PREFIX}-${orgKey(organizationId)}-${registryLabel(registry)}`;
}
export function buildkitdMirrorVolumeName(
  organizationId: string,
  registry: string,
): string {
  return `${MIRROR_PREFIX}-cache-${orgKey(organizationId)}-${registryLabel(registry)}`;
}
/** The mirror reference (`name:port`) buildkit points `registry` at. */
export function buildkitdMirrorRef(
  organizationId: string,
  registry: string,
): string {
  return `${buildkitdMirrorContainerName(organizationId, registry)}:${MIRROR_PORT}`;
}
// A registry proxies ONE upstream per instance; Docker Hub's registry API host
// differs from its canonical name.
function mirrorUpstream(registry: string): string {
  return registry === 'docker.io'
    ? 'https://registry-1.docker.io'
    : `https://${registry}`;
}

/** How long a mirror keeps a pulled blob. Distribution v3 makes the proxy's
 * expiry configurable (it was fixed at a week); two days keeps the base
 * layers of an organization's active builds while letting what it stopped
 * using go, and BuildKit's own cache keeps what its builds reuse. */
const MIRROR_PROXY_TTL = '48h';

/** Immutable mirror settings, also stamped so an existing helper adopts a
 * changed cleanup policy once its organization's builds finish. */
export function buildkitMirrorEnvironment(
  cfg: Pick<SpawnerConfig, 'egressProxy'>,
  registry: string,
): string[] {
  return [
    `REGISTRY_PROXY_REMOTEURL=${mirrorUpstream(registry)}`,
    `REGISTRY_PROXY_TTL=${MIRROR_PROXY_TTL}`,
    // Distribution's proxy TTL scheduler calls the storage deletion path.
    // Its default is disabled: expiration otherwise fails before removing
    // any layer bytes, even though the scheduler forgets the expired entry.
    'REGISTRY_STORAGE_DELETE_ENABLED=true',
    `HTTPS_PROXY=${cfg.egressProxy}`,
    `HTTP_PROXY=${cfg.egressProxy}`,
    'NO_PROXY=127.0.0.1,localhost',
  ];
}

function assertOrg(organizationId: string): void {
  if (!ORG_RE.test(organizationId)) {
    throw new Error(
      `buildkitd: refusing unsafe organizationId: ${JSON.stringify(organizationId)}`,
    );
  }
}

/** A bounded, case-sensitive organization identity. Hashing avoids DNS case
 * folding, underscore replacement, and truncation collisions. Every resource
 * is also labelled and checked against the full org id before reuse. */
function orgKey(organizationId: string): string {
  assertOrg(organizationId);
  return createHash('sha256').update(organizationId).digest('hex').slice(0, 24);
}

export function buildkitdContainerName(organizationId: string): string {
  return `tale-buildkitd-${orgKey(organizationId)}`;
}

export function buildkitdCacheVolumeName(organizationId: string): string {
  return `tale-buildkitd-cache-${orgKey(organizationId)}`;
}

export function buildkitdNetworkName(organizationId: string): string {
  return `tale-buildkitd-net-${orgKey(organizationId)}`;
}

/**
 * The remote-builder endpoint a session connects its buildx builder to.
 * Reachable by container name on the organization's private network — the session's
 * redsocks leaves RFC1918 direct, so this resolves + connects without
 * traversing the proxy.
 */
export function buildkitdEndpoint(organizationId: string): string {
  return `tcp://${buildkitdContainerName(organizationId)}:${BUILDKITD_PORT}`;
}

// Coalesce concurrent ensure* calls for the same container (two sessions from
// the same organization starting at once would otherwise both race past the
// inspect gate and both `docker run --name`, the second erroring). Mirrors
// ensureCacheVolume in volume.ts.
const ensureInFlight = new Map<string, Promise<BuildkitdReady>>();
const mirrorInFlight = new Map<string, Promise<unknown>>();
const organizationOperations = new Map<string, Promise<void>>();
const createLeases = new Map<string, number>();
const idleSince = new Map<string, number>();
// The prune before an idle stop in flight, by organization: a create that
// needs the builder cuts it short instead of waiting for it.
const idlePrunes = new Map<string, AbortController>();
let idleSweepInFlight: Promise<BuildkitIdleSweepResult> | undefined;
/** When a stopped builder last stopped, by organization and immutable
 * container id, as its inspect said. A container's FinishedAt only moves
 * forward, so a remembered one is never later than the truth: the retention
 * cannot have passed before it says so, and no inspect is needed until then.
 * Entries go once the container leaves the helper inventory. */
const builderFinishedAt = new Map<string, number>();
/** Per Docker target: when the helper inventory last came back empty while
 * the build cache was off. */
const helperlessSince = new Map<string, number>();

interface BuildkitIdleSweepResult {
  stopped: number;
  organizations: number;
  /** Organizations whose caches went because the session disk was short. */
  relieved?: number;
}

/** Keep helpers available across the gap between ensure and docker run. The
 * Docker backend holds this lease until session create/health has completed,
 * including failure cleanup. Its release is idempotent for finally handlers. */
export function retainBuildkitd(organizationId: string): () => void {
  assertOrg(organizationId);
  createLeases.set(organizationId, (createLeases.get(organizationId) ?? 0) + 1);
  idleSince.delete(organizationId);
  // The helpers are wanted again: an idle stop under way gives up, and its
  // prune does not hold the create behind the organization's lock.
  idlePrunes.get(organizationId)?.abort();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const remaining = (createLeases.get(organizationId) ?? 1) - 1;
    if (remaining > 0) createLeases.set(organizationId, remaining);
    else createLeases.delete(organizationId);
    idleSince.delete(organizationId);
  };
}

/** Serialize launch and idle-stop for an org. Docker deployments run one
 * spawner per host session root (DockerBackend's host lock and serialized
 * deploy); this is an in-process lock, not a distributed-replica lease. */
async function withBuildkitdOperation<T>(
  organizationId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = organizationOperations.get(organizationId);
  const result = waitWithinOperation(previous ?? Promise.resolve()).then(() => {
    operationSignal()?.throwIfAborted();
    return operation();
  });
  const done = result.then(
    () => undefined,
    () => undefined,
  );
  // A waiter may cancel before the producer ahead of it finishes. Its queue
  // slot still retains that producer, so later callers cannot overtake it.
  const settled = Promise.all([previous, done]).then(() => undefined);
  organizationOperations.set(organizationId, settled);
  void settled.then(() => {
    if (organizationOperations.get(organizationId) === settled) {
      organizationOperations.delete(organizationId);
    }
    return undefined;
  });
  return result;
}

const DOCKER_ID_RE = /^[a-f0-9]{12,64}$/;

const MIB = 1024 * 1024;

/** A Docker memory size (`8g`, `1536m`, `4294967296`) in bytes, or null. */
function dockerMemoryBytes(value: string): number | null {
  const m = /^(\d+(?:\.\d+)?)([bkmg])?$/i.exec(value.trim());
  if (!m) return null;
  const unit = { b: 1, k: 1024, m: MIB, g: 1024 * MIB }[
    (m[2] ?? 'b').toLowerCase()
  ];
  return unit === undefined ? null : Number(m[1]) * unit;
}

/** The memory one organization's builder may use: the operator's
 * (SANDBOX_BUILDKITD_MEMORY), else twice an agent session's — every agent
 * session of the organization builds in it, so it holds a couple of heavy
 * builds at once. A ceiling, not a reservation: an idle builder uses little. */
/** What a helper's bounds are read from. */
type HelperBoundsConfig = Pick<
  SpawnerConfig,
  'session' | 'buildkitdCpus' | 'buildkitdMemoryBytes'
>;

function builderMemory(cfg: HelperBoundsConfig): string {
  if (cfg.buildkitdMemoryBytes !== undefined) {
    return `${Math.max(1, Math.floor(cfg.buildkitdMemoryBytes / MIB))}m`;
  }
  const agent = cfg.session.agentProfile.memory;
  const bytes = dockerMemoryBytes(agent);
  return bytes === null ? agent : `${Math.floor((2 * bytes) / MIB)}m`;
}

/** The cgroup, process and log bounds a helper runs under. A build's RUN steps
 * execute inside the builder, outside any session's cgroup: unbounded, one
 * organization's parallel builds could take the whole host, and under memory
 * pressure the kernel killed sessions (OOM score 500) before the builder (0).
 * The builder is shared by every agent session of its organization and gets
 * {@link builderMemory} and an agent session's CPUs unless the operator sets
 * SANDBOX_BUILDKITD_CPUS; a mirror idles at about 10 MB. Both take an agent
 * session's CPU weight: a build is session work, and under contention it
 * yields to the control plane like the session that started it. Logging is
 * set in full, as for a session (docker-session-args.ts): an option left unset
 * falls through to the host daemon's defaults, which can make the run fail. */
export function buildkitHelperLimits(
  cfg: HelperBoundsConfig,
  role: 'builder' | 'mirror',
): string[] {
  const agent = cfg.session.agentProfile;
  const memory = role === 'builder' ? builderMemory(cfg) : '512m';
  const cpus = cfg.buildkitdCpus ?? agent.cpus;
  return [
    `--cpus=${role === 'builder' ? cpus : 1}`,
    `--cpu-shares=${agent.cpuShares}`,
    `--memory=${memory}`,
    `--memory-swap=${memory}`,
    `--pids-limit=${role === 'builder' ? Math.max(agent.pidsLimit, 16384) : 256}`,
    '--oom-score-adj=500',
    '--log-driver=json-file',
    '--log-opt',
    'max-size=10m',
    '--log-opt',
    'max-file=1',
    '--log-opt',
    'compress=false',
  ];
}

/** The label a helper carries with {@link helperStamp}. */
const HELPER_STAMP_LABEL = 'tale.helper-config';

/** How a helper was launched — its image, bounds and settings — as a short hash: a
 * running helper whose stamp differs predates the current release or
 * settings. */
export function helperStamp(
  image: string,
  limits: readonly string[],
  configuration: readonly string[] = [],
): string {
  return createHash('sha256')
    .update([image, ...limits, ...configuration].join('\n'))
    .digest('hex')
    .slice(0, 16);
}

/** The bounds a busy helper takes in place. Never its memory: on cgroup v2 a
 * limit below what the helper uses OOM-kills its running builds there and
 * then, so memory waits for the recreate once the helper is idle. */
const LIVE_LIMIT_FLAGS = ['--cpus=', '--cpu-shares=', '--pids-limit='];
// Running helpers whose bounds were updated in place, with the stamp they were
// updated to: done once per stamp, not on every ensure.
const limitsUpdated = new Map<string, string>();

/** Bring a busy helper's CPU and process bounds up to date without a restart
 * (its memory, image and log options stay as they were until it is
 * recreated). Best effort. */
async function updateHelperLimits(
  name: string,
  stamp: string,
  limits: readonly string[],
): Promise<void> {
  if (limitsUpdated.get(name) === stamp) return;
  const live = limits.filter((flag) =>
    LIVE_LIMIT_FLAGS.some((prefix) => flag.startsWith(prefix)),
  );
  const result = await runDocker(['update', ...live, name], {
    timeoutMs: 10_000,
  });
  if (result.exitCode !== 0) {
    console.warn(
      `[sandbox.buildkitd] could not update the limits of ${name}: ${result.stderr.trim()}`,
    );
    return;
  }
  limitsUpdated.set(name, stamp);
}

// The image id a reference names, briefly remembered: `tale deploy` re-tags
// `:latest` in place, so a release changes the id, not the reference.
const IMAGE_ID_TTL_MS = 30_000;
const imageIds = new Map<string, { id: string; atMs: number }>();

/** The id of the image `reference` names here, or null when there is none. */
async function currentImageId(reference: string): Promise<string | null> {
  const known = imageIds.get(reference);
  if (known !== undefined && Date.now() - known.atMs < IMAGE_ID_TTL_MS) {
    return known.id;
  }
  const result = await runDocker(
    ['image', 'inspect', '--format', '{{.Id}}', reference],
    { timeoutMs: 5_000 },
  );
  const id = result.exitCode === 0 ? result.stdout.trim() : '';
  if (id === '') return null;
  imageIds.set(reference, { id, atMs: Date.now() });
  return id;
}

/** How long a background image pull may take. */
const IMAGE_PULL_TIMEOUT_MS = 15 * 60_000;
/** Image pulls under way, by reference: one per image, however many
 * launches asked for it. */
const imagePulls = new Map<string, Promise<void>>();

/** Pull an image a helper launch found missing, beside every create: a pull
 * inside a create's few-second provisioning budget is cut short at each
 * attempt, so the launch reports the helper unavailable instead and the pull
 * runs to its own bound. Logged; never rejects. */
function pullImageInBackground(reference: string): void {
  if (imagePulls.has(reference)) return;
  console.warn(
    `[sandbox.buildkitd] ${reference} is not on this host; pulling it in the background`,
  );
  const pull = (async () => {
    try {
      const result = await outsideOperationBudget(() =>
        runDocker(['pull', reference], { timeoutMs: IMAGE_PULL_TIMEOUT_MS }),
      );
      imageIds.delete(reference);
      if (result.exitCode === 0) {
        console.log(`[sandbox.buildkitd] pulled ${reference}`);
      } else {
        console.warn(
          `[sandbox.buildkitd] could not pull ${reference} (the next launch tries again): ${result.stderr.trim()}`,
        );
      }
    } catch (error) {
      console.warn(
        `[sandbox.buildkitd] could not pull ${reference} (the next launch tries again):`,
        error,
      );
    } finally {
      imagePulls.delete(reference);
    }
  })();
  imagePulls.set(reference, pull);
}

/** Does a `docker run --pull never` failure say its image is missing? */
function imageMissing(stderr: string): boolean {
  return /no such image|unable to find image/i.test(stderr);
}

/** Was this running helper launched otherwise than it would be now: other
 * bounds or another image reference (its stamp), or an image its reference no
 * longer names? An id that cannot be read is no drift. */
async function helperDrifted(
  helper: { stamp: string | undefined; image: string | undefined },
  stamp: string,
  imageReference: string,
): Promise<boolean> {
  if (helper.stamp !== stamp) return true;
  if (helper.image === undefined) return false;
  const id = await currentImageId(imageReference);
  return id !== null && id !== helper.image;
}

/** Is no build running in this builder? A record still `STARTED` is a build
 * under way; an answer that cannot be read counts as busy. */
async function builderIdle(name: string): Promise<boolean> {
  const result = await runDocker(
    ['exec', name, 'buildctl', 'debug', 'histories', '--format', '{{.Type}}'],
    { timeoutMs: 10_000 },
  );
  if (result.exitCode !== 0) return false;
  return !result.stdout.split('\n').some((line) => line.trim() === 'STARTED');
}

/** {@link builderIdle}, asked at most once. */
function idleOnce(name: string): () => Promise<boolean> {
  let answer: Promise<boolean> | null = null;
  return () => (answer ??= builderIdle(name));
}

/** No builder runs, so nothing builds. */
const NOTHING_BUILDS = () => Promise.resolve(true);

/** The build cache an organization's builder keeps when it stops for want of
 * agent sessions, unless SANDBOX_BUILDKITD_IDLE_CACHE says otherwise. */
const DEFAULT_IDLE_CACHE_BYTES = 5 * 1024 ** 3;

/** Bound on the prune before an idle stop: deleting tens of GB of snapshots
 * takes a while, and the stop goes on either way. */
const IDLE_PRUNE_TIMEOUT_MS = 120_000;

/** Shrink an idle builder's cache to the idle budget, least recently used
 * first. BuildKit collects garbage only while it runs — at start and after a
 * build — so a builder stopped for want of sessions kept its whole cache, up
 * to the policy's cap, for as long as its organization did not build again,
 * however full the disk it shares with every session got. Best effort: a
 * prune that fails or runs out of time is logged and the stop goes on; one a
 * create cuts short (retainBuildkitd) is left to the builder, which keeps
 * running. */
async function pruneIdleBuilderCache(
  cfg: SpawnerConfig,
  organizationId: string,
  builderId: string,
): Promise<void> {
  const keepBytes = cfg.buildkitdIdleCacheBytes ?? DEFAULT_IDLE_CACHE_BYTES;
  const cut = new AbortController();
  idlePrunes.set(organizationId, cut);
  try {
    const pruned = await runDocker(
      [
        'exec',
        builderId,
        'buildctl',
        'prune',
        '--all',
        // buildctl counts storage in MB of 10^6 bytes.
        '--keep-storage',
        String(Math.floor(keepBytes / 1e6)),
      ],
      {
        timeoutMs: IDLE_PRUNE_TIMEOUT_MS,
        stdoutMaxBytes: 64 * 1024,
        signal: cut.signal,
      },
    );
    if (cut.signal.aborted) return;
    if (pruned.exitCode !== 0) {
      console.warn(
        `[sandbox.buildkitd] could not prune the idle build cache of ${organizationId} (exit ${pruned.exitCode}; stopping its builder anyway): ${pruned.stderr.trim() || 'no output'}`,
      );
    }
  } finally {
    if (idlePrunes.get(organizationId) === cut) {
      idlePrunes.delete(organizationId);
    }
  }
}

async function liveBuildkitOrganizations(
  organizationId?: string,
): Promise<Set<string>> {
  const sessions = await readDockerMetadata([
    'ps',
    '--all',
    '--no-trunc',
    '--filter',
    'label=tale.sandbox-session=1',
    ...(organizationId ? ['--filter', `label=tale.org=${organizationId}`] : []),
    '--format',
    '{{.ID}}\t{{.State}}\t{{.Label "tale.org"}}\t{{.Label "tale.profile"}}\t{{.Label "tale.docker"}}',
  ]);
  if (sessions.exitCode !== 0) {
    throw new Error('buildkitd: cannot establish idle session dependencies');
  }
  const live = new Set<string>();
  for (const line of sessions.stdout.split('\n').filter(Boolean)) {
    const [id, status, org, profile, docker, extra] = line.split('\t');
    if (
      !id ||
      !DOCKER_ID_RE.test(id) ||
      !status ||
      !org ||
      !ORG_RE.test(org) ||
      extra !== undefined
    ) {
      throw new Error('buildkitd: invalid session inventory during idle sweep');
    }
    // Only agent sessions build: a crawler render or a script session of the
    // organization kept its helpers running for nothing. A container without
    // the label predates it and counts, as before.
    if (
      profile === 'default' ||
      profile === 'agent-light' ||
      docker === 'false'
    )
      continue;
    // Created, paused, restarting, removing and unrecognized non-terminal
    // states may still use the cache. Pinned/warm runtimes are also retained.
    if (status !== 'exited' && status !== 'dead') live.add(org);
  }
  return live;
}

function organizationHelperNames(organizationId: string): string[] {
  return [
    buildkitdContainerName(organizationId),
    ...MIRROR_REGISTRIES.map((registry) =>
      buildkitdMirrorContainerName(organizationId, registry),
    ),
  ];
}

/** How long an organization's helpers keep running once no agent session
 * that builds may use them, unless SANDBOX_BUILDKITD_IDLE_MS says otherwise.
 * Shorter than the session idle window: a stopped builder starts again with
 * its cache in seconds, while a running one holds its memory all along. */
const DEFAULT_HELPER_IDLE_MS = 10 * 60_000;

function finishedAtKey(org: string, containerId: string): string {
  return `${org}\t${containerId}`;
}

/** Remove an organization's helpers and caches when its builder has been
 * stopped for longer than the retention and nothing may use them now. The
 * builder is inspected (its owner and stop time) only once the retention
 * could have passed since the stop time last read. */
async function expireStoppedBuildCache(
  cfg: SpawnerConfig,
  org: string,
  builderId: string,
  nowMs: number,
  wanted: () => Promise<boolean>,
): Promise<void> {
  const retentionMs =
    cfg.buildkitdCacheRetentionMs ?? DEFAULT_CACHE_RETENTION_MS;
  if (retentionMs <= 0) return;
  const key = finishedAtKey(org, builderId);
  const known = builderFinishedAt.get(key);
  if (known !== undefined && nowMs - known < retentionMs) return;
  const builder = await inspectBuildkitHelper(
    builderId,
    org,
    buildkitdNetworkName(org),
    'shared',
  );
  if (
    builder !== null &&
    !builder.running &&
    builder.finishedAtMs !== undefined
  ) {
    builderFinishedAt.set(key, builder.finishedAtMs);
  }
  if (
    builder === null ||
    builder.running ||
    builder.finishedAtMs === undefined ||
    nowMs - builder.finishedAtMs < retentionMs
  ) {
    return;
  }
  if (await wanted()) return;
  const removed = await removeOrganizationBuildkitUnlocked(org);
  console.log(
    `[sandbox.buildkitd] removed ${org}'s build helpers and caches, stopped since ${new Date(builder.finishedAtMs).toISOString()} (${removed.containers} containers, ${removed.volumes} volumes); the next build starts cold`,
  );
}

/** Remove an idle organization's registry mirrors and their cache volumes.
 * The builder's own cache, pruned to the idle budget before it stopped,
 * still holds the base layers its builds used, so the mirrors' copies only
 * cost disk while the organization does not build; its next build recreates
 * them empty. Each mirror is inspected by its immutable id right before its
 * removal and must be owned, private and stopped; its volume goes only after
 * it, by exact name and ownership label, and Docker refuses to remove a
 * volume any container still uses. A mirror that cannot go is logged and
 * kept. Returns how many volumes went. */
async function retireIdleMirrors(
  org: string,
  mirrorIds: ReadonlyArray<{ registry: string; id: string }>,
): Promise<number> {
  const network = buildkitdNetworkName(org);
  let volumes = 0;
  for (const { registry, id } of mirrorIds) {
    // A create that took the organization's lease meanwhile waits behind
    // its lock with only its provisioning budget: it goes first, and the
    // next sweep removes what is left.
    if (createLeases.has(org)) break;
    try {
      const mirror = await inspectBuildkitHelper(id, org, network, 'shared');
      // Gone already, or running again: never the cache of a running mirror.
      if (mirror === null || mirror.running) continue;
      const removed = await runDocker(['rm', id], { timeoutMs: 35_000 });
      if (
        removed.exitCode !== 0 &&
        !/no such container/i.test(removed.stderr)
      ) {
        throw new Error(
          `buildkitd: cannot remove idle mirror ${id}: ${removed.stderr.trim()}`,
        );
      }
      if (
        await removeBuildkitVolume(
          buildkitdMirrorVolumeName(org, registry),
          org,
        )
      ) {
        volumes++;
      }
    } catch (error) {
      console.warn(
        `[sandbox.buildkitd] keeping ${org}'s ${registry} mirror cache for now:`,
        error,
      );
    }
  }
  return volumes;
}

/** An organization's mirror containers in the helper inventory. */
function inventoriedMirrors(
  org: string,
  names: ReadonlyMap<string, string>,
): Array<{ registry: string; id: string }> {
  return MIRROR_REGISTRIES.flatMap((registry) => {
    const id = names.get(buildkitdMirrorContainerName(org, registry));
    return id === undefined ? [] : [{ registry, id }];
  });
}

/** {@link retireIdleMirrors} once nothing wants the helpers, logged. */
async function retireIdleMirrorsUnlessWanted(
  org: string,
  names: ReadonlyMap<string, string>,
  wanted: () => Promise<boolean>,
): Promise<void> {
  const mirrors = inventoriedMirrors(org, names);
  if (mirrors.length === 0 || (await wanted())) return;
  const volumes = await retireIdleMirrors(org, mirrors);
  if (volumes > 0) {
    console.log(
      `[sandbox.buildkitd] removed ${org}'s idle registry mirrors and ${volumes} mirror cache volumes; its next build fills them again`,
    );
  }
}

/** At most this many organizations' caches go in one sweep for want of
 * disk: each removal is measured before the next. */
const PRESSURE_REMOVALS_PER_SWEEP = 3;
/** How long removals stay paused once one freed nothing on the session disk
 * (the build caches live on another disk than the workspaces). */
const PRESSURE_PAUSE_MS = 6 * 60 * 60 * 1000;
/** Until when removals for want of disk are paused (epoch ms). */
let pressurePausedUntilMs = 0;

/** Release only compute after an org has had no live session for the
 * helpers' idle window (SANDBOX_BUILDKITD_IDLE_MS). A fresh spawner observes a
 * full window before reclaiming anything. Persistent volumes, private networks and container configuration
 * survive; the next ensure recreates stopped helpers from their caches. While
 * the disk the workspaces live on is below its floor, the caches of
 * organizations whose helpers are all stopped go too, the longest-stopped
 * first (`upkeep.sessionDisk`). */
export function sweepIdleBuildkitd(
  cfg: SpawnerConfig,
  nowMs = Date.now(),
  upkeep: BuildCacheUpkeep = {},
): Promise<BuildkitIdleSweepResult> {
  if (cfg.backend !== 'docker')
    return Promise.resolve({ stopped: 0, organizations: 0 });
  idleSweepInFlight ??= sweepIdleBuildkitdUnlocked(cfg, nowMs, upkeep).finally(
    () => {
      idleSweepInFlight = undefined;
    },
  );
  return idleSweepInFlight;
}

/** Helper states `docker ps` reports for a container that is not running
 * and is not about to: such a helper needs no inspect, since it is never
 * stopped. Anything else (running, paused, restarting, removing, a state
 * this code does not know) is inspected before a decision. */
const STOPPED_HELPER_STATES = new Set(['exited', 'created', 'dead']);

/** With the build cache off nothing in this process starts a helper, so an
 * empty helper inventory is read again at most this often: often enough to
 * find what a flip of the setting or a spawner with it on left behind. */
const HELPERLESS_RECHECK_MS = 60 * 60_000;

async function sweepIdleBuildkitdUnlocked(
  cfg: SpawnerConfig,
  nowMs: number,
  upkeep: BuildCacheUpkeep,
): Promise<BuildkitIdleSweepResult> {
  const target = dockerTarget();
  const cacheOn = cfg.dockerInContainer && cfg.dockerBuildCache;
  const helperlessAt = helperlessSince.get(target);
  if (
    !cacheOn &&
    helperlessAt !== undefined &&
    nowMs >= helperlessAt &&
    nowMs - helperlessAt < HELPERLESS_RECHECK_MS
  ) {
    return { stopped: 0, organizations: 0 };
  }
  const helpers = await readDockerMetadata([
    'ps',
    '--all',
    '--no-trunc',
    '--filter',
    'label=tale.buildkitd=1',
    '--format',
    '{{.ID}}\t{{.Names}}\t{{.Label "tale.org"}}\t{{.State}}',
  ]);
  if (helpers.exitCode !== 0)
    throw new Error('buildkitd: cannot inventory idle helpers');
  const byOrg = new Map<string, Map<string, string>>();
  const stateById = new Map<string, string>();
  for (const line of helpers.stdout.split('\n').filter(Boolean)) {
    const [id, name, org, state, extra] = line.split('\t');
    if (
      !id ||
      !DOCKER_ID_RE.test(id) ||
      !name ||
      !state ||
      extra !== undefined
    ) {
      throw new Error('buildkitd: invalid helper inventory during idle sweep');
    }
    // The legacy retirement lane owns global resources. Unknown org labels
    // and arbitrary similarly-labelled containers are never stop candidates.
    if (
      !org ||
      !ORG_RE.test(org) ||
      !organizationHelperNames(org).includes(name)
    )
      continue;
    const names = byOrg.get(org) ?? new Map<string, string>();
    if (names.has(name))
      throw new Error('buildkitd: duplicate helper inventory');
    names.set(name, id);
    byOrg.set(org, names);
    stateById.set(id, state);
    // A builder that may run again stops at a later time than remembered.
    if (
      name === buildkitdContainerName(org) &&
      !STOPPED_HELPER_STATES.has(state)
    ) {
      builderFinishedAt.delete(finishedAtKey(org, id));
    }
  }
  for (const key of builderFinishedAt.keys()) {
    const [org, id] = key.split('\t');
    if (
      org === undefined ||
      id === undefined ||
      byOrg.get(org)?.get(buildkitdContainerName(org)) !== id
    ) {
      builderFinishedAt.delete(key);
    }
  }
  if (byOrg.size === 0) {
    idleSince.clear();
    if (cacheOn) helperlessSince.delete(target);
    else helperlessSince.set(target, nowMs);
    return { stopped: 0, organizations: 0 };
  }
  helperlessSince.delete(target);
  const live = await liveBuildkitOrganizations();
  for (const org of idleSince.keys()) {
    if (!byOrg.has(org)) idleSince.delete(org);
  }
  const result: BuildkitIdleSweepResult = { stopped: 0, organizations: 0 };
  for (const [org, names] of byOrg) {
    // One organization's helpers that cannot be judged or stopped (a wedged
    // container, a stranger under a helper name) must not keep every other
    // organization's helpers running: it is logged and retried next sweep.
    const stopped = await withBuildkitdOperation(org, async () => {
      if (live.has(org) || createLeases.has(org)) {
        idleSince.delete(org);
        return 0;
      }
      const since = idleSince.get(org);
      if (since === undefined || nowMs < since) {
        idleSince.set(org, nowMs);
        return 0;
      }
      if (nowMs - since < (cfg.buildkitdIdleMs ?? DEFAULT_HELPER_IDLE_MS))
        return 0;

      const runningIds: string[] = [];
      // Validate EVERY candidate before the first stop. Inspect and stop by
      // immutable ID, so same-name replacement cannot redirect a stop to an
      // uninspected container. Stop builder first, then its mirrors. A
      // helper the inventory just listed as stopped is no candidate: an
      // organization whose helpers all stopped long ago costs no inspect.
      for (const name of organizationHelperNames(org)) {
        const id = names.get(name);
        if (
          id &&
          !STOPPED_HELPER_STATES.has(stateById.get(id) ?? '') &&
          (await inspectBuildkitContainer(
            id,
            org,
            buildkitdNetworkName(org),
            'shared',
          )) === 'running'
        )
          runningIds.push(id);
      }
      const builderId = names.get(buildkitdContainerName(org));
      // Inventory is complete and fresh immediately before each mutation;
      // a late visible session from any spawner also cancels idle-stop.
      const wanted = async () => {
        const latestLive = await liveBuildkitOrganizations(org);
        if (!latestLive.has(org) && !createLeases.has(org)) return false;
        idleSince.delete(org);
        return true;
      };
      // Helpers stopped long ago keep their caches only so long: past the
      // retention, an organization that has not built since gives back the
      // disk its caches hold, and its next build starts cold.
      if (runningIds.length === 0 && builderId !== undefined) {
        // Mirrors an earlier stop left behind go now; an organization
        // without any costs nothing here.
        await retireIdleMirrorsUnlessWanted(org, names, wanted);
        await expireStoppedBuildCache(cfg, org, builderId, nowMs, wanted);
        return 0;
      }
      let stoppedCount = 0;
      forgetVerified(org);
      for (const id of runningIds) {
        if (await wanted()) return stoppedCount;
        if (id === builderId) {
          // The last moment the builder can collect its own garbage. The
          // prune takes a while, so the helpers are judged again after it.
          await pruneIdleBuilderCache(cfg, org, id);
          if (await wanted()) return stoppedCount;
        }
        const stopResult = await runDocker(['stop', '--time', '30', id], {
          timeoutMs: 35_000,
        });
        if (stopResult.exitCode !== 0)
          throw new Error(`buildkitd: failed to stop idle helper ${id}`);
        stoppedCount++;
      }
      await retireIdleMirrorsUnlessWanted(org, names, wanted);
      idleSince.delete(org);
      return stoppedCount;
    }).catch((error: unknown) => {
      console.warn(
        `[sandbox.buildkitd] idle sweep of ${org}'s helpers failed (next sweep retries):`,
        error,
      );
      return 0;
    });
    if (stopped > 0) {
      result.stopped += stopped;
      result.organizations++;
    }
  }
  if (upkeep.sessionDisk !== undefined && nowMs >= pressurePausedUntilMs) {
    const relieved = await relieveDiskPressure(
      byOrg,
      stateById,
      live,
      upkeep.sessionDisk,
      nowMs,
    );
    if (relieved > 0) result.relieved = relieved;
  }
  return result;
}

/** The session disk is below its floor: give back the caches of the
 * organizations whose helpers are all stopped and that nothing may use now,
 * the longest-stopped first, retention or not, until the disk is above its
 * floor again or {@link PRESSURE_REMOVALS_PER_SWEEP} have gone. A removal
 * that frees no space there means the caches live on another disk: no more
 * go for {@link PRESSURE_PAUSE_MS}. Returns how many organizations' caches
 * went. */
async function relieveDiskPressure(
  byOrg: ReadonlyMap<string, ReadonlyMap<string, string>>,
  stateById: ReadonlyMap<string, string>,
  live: ReadonlySet<string>,
  sessionDisk: NonNullable<BuildCacheUpkeep['sessionDisk']>,
  nowMs: number,
): Promise<number> {
  let disk = await sessionDisk();
  if (disk === null || !disk.short) return 0;
  const candidates: Array<{
    org: string;
    builderId: string;
    finishedAtMs: number;
  }> = [];
  for (const [org, names] of byOrg) {
    if (live.has(org) || createLeases.has(org)) continue;
    const builderId = names.get(buildkitdContainerName(org));
    if (builderId === undefined) continue;
    try {
      // Judged from the inventory: a helper it lists as stopped is not
      // inspected, nor a stopped builder whose stop time is remembered, so
      // a disk that stays short for hours does not cost every stopped
      // organization's helpers an inspect a minute. The owner and state are
      // read again under the organization's lock right before a removal.
      const network = buildkitdNetworkName(org);
      let anyRunning = false;
      for (const name of organizationHelperNames(org)) {
        const id = names.get(name);
        if (
          id !== undefined &&
          id !== builderId &&
          !STOPPED_HELPER_STATES.has(stateById.get(id) ?? '') &&
          (await inspectBuildkitContainer(id, org, network, 'shared')) ===
            'running'
        ) {
          anyRunning = true;
          break;
        }
      }
      if (anyRunning) continue;
      const key = finishedAtKey(org, builderId);
      let finishedAtMs = STOPPED_HELPER_STATES.has(
        stateById.get(builderId) ?? '',
      )
        ? builderFinishedAt.get(key)
        : undefined;
      if (finishedAtMs === undefined) {
        const builder = await inspectBuildkitHelper(
          builderId,
          org,
          network,
          'shared',
        );
        if (
          builder === null ||
          builder.running ||
          builder.finishedAtMs === undefined
        ) {
          continue;
        }
        finishedAtMs = builder.finishedAtMs;
        builderFinishedAt.set(key, finishedAtMs);
      }
      candidates.push({ org, builderId, finishedAtMs });
    } catch (error) {
      console.warn(
        `[sandbox.buildkitd] cannot judge ${org}'s stopped helpers for the short session disk (next sweep retries):`,
        error,
      );
    }
  }
  candidates.sort((a, b) => a.finishedAtMs - b.finishedAtMs);
  let relieved = 0;
  for (const candidate of candidates) {
    if (relieved >= PRESSURE_REMOVALS_PER_SWEEP) break;
    const before = disk.availableBytes;
    const removed = await withBuildkitdOperation(candidate.org, async () => {
      // Judged again under the organization's lock: a session or a create
      // that came since keeps the caches.
      const latestLive = await liveBuildkitOrganizations(candidate.org);
      if (latestLive.has(candidate.org) || createLeases.has(candidate.org)) {
        return null;
      }
      const builder = await inspectBuildkitHelper(
        candidate.builderId,
        candidate.org,
        buildkitdNetworkName(candidate.org),
        'shared',
      );
      if (builder === null || builder.running) return null;
      return removeOrganizationBuildkitUnlocked(candidate.org);
    }).catch((error: unknown) => {
      console.warn(
        `[sandbox.buildkitd] could not remove ${candidate.org}'s build caches for the short session disk (next sweep retries):`,
        error,
      );
      return null;
    });
    if (removed === null) continue;
    relieved++;
    const after = await sessionDisk();
    console.log(
      `[sandbox.buildkitd] the session disk is short: removed ${candidate.org}'s build helpers and caches, stopped since ${new Date(candidate.finishedAtMs).toISOString()} (${removed.containers} containers, ${removed.volumes} volumes); its next build starts cold`,
    );
    if (after === null) break;
    // The most constrained filesystem can change after a removal. A smaller
    // free-byte count on the next one is not evidence of no benefit on the
    // first; re-evaluate it next sweep instead of suppressing upkeep for hours.
    if (after.filesystem !== disk.filesystem) break;
    if (after.availableBytes <= before) {
      pressurePausedUntilMs = nowMs + PRESSURE_PAUSE_MS;
      console.warn(
        `[sandbox.buildkitd] removing ${candidate.org}'s build caches freed no space on the session disk: the caches live on another disk, and no more are removed for want of it for ${PRESSURE_PAUSE_MS / 3_600_000} h`,
      );
      break;
    }
    disk = after;
    if (!disk.short) break;
  }
  return relieved;
}

/** Forget a pause of the removals for want of disk (tests). */
export function resetDiskPressurePause(): void {
  pressurePausedUntilMs = 0;
}

/**
 * Remove every build resource of an organization that no longer exists: its
 * builder and mirrors, their cache volumes and its private network. Runs
 * under the organization's launch/idle-stop lock and refuses while a session
 * create still holds a lease on the helpers. Containers are inventoried by
 * their ownership labels and removed by immutable id — only the helper names
 * this organization's ensure creates, so a similarly-labelled stranger is
 * left alone — and every volume and the network are ownership-checked before
 * removal. Idempotent: a second call finds nothing and reports zeros.
 */
export async function removeOrganizationBuildkit(
  organizationId: string,
): Promise<{ containers: number; volumes: number; networks: number }> {
  assertOrg(organizationId);
  return withBuildkitdOperation(organizationId, async () => {
    if (createLeases.has(organizationId)) {
      throw new Error(
        `buildkitd: a session create of ${organizationId} still holds its build helpers`,
      );
    }
    return removeOrganizationBuildkitUnlocked(organizationId);
  });
}

/** {@link removeOrganizationBuildkit} inside the organization's operation. */
async function removeOrganizationBuildkitUnlocked(
  organizationId: string,
): Promise<{ containers: number; volumes: number; networks: number }> {
  forgetVerified(organizationId);
  const result = { containers: 0, volumes: 0, networks: 0 };
  const listed = await readDockerMetadata([
    'ps',
    '--all',
    '--no-trunc',
    '--filter',
    'label=tale.buildkitd=1',
    '--filter',
    `label=tale.org=${organizationId}`,
    '--format',
    '{{.ID}}\t{{.Names}}',
  ]);
  if (listed.exitCode !== 0) {
    throw new Error('buildkitd: cannot inventory the organization helpers');
  }
  const helperNames = organizationHelperNames(organizationId);
  for (const line of listed.stdout.split('\n').filter(Boolean)) {
    const [id, name, extra] = line.split('\t');
    if (!id || !DOCKER_ID_RE.test(id) || !name || extra !== undefined) {
      throw new Error('buildkitd: invalid helper inventory during teardown');
    }
    if (!helperNames.includes(name)) {
      console.warn(
        `[sandbox.buildkitd] leaving ${name}: labelled for ${organizationId} but not one of its helpers`,
      );
      continue;
    }
    const removed = await runDocker(['rm', '--force', id], {
      timeoutMs: 35_000,
    });
    if (removed.exitCode !== 0 && !/no such container/i.test(removed.stderr))
      throw new Error(`buildkitd: failed to remove helper ${name}`);
    result.containers++;
  }
  if (
    await removeBuildkitNetwork(
      buildkitdNetworkName(organizationId),
      organizationId,
    )
  ) {
    result.networks++;
  }
  for (const volume of [
    buildkitdCacheVolumeName(organizationId),
    ...MIRROR_REGISTRIES.map((registry) =>
      buildkitdMirrorVolumeName(organizationId, registry),
    ),
  ]) {
    if (await removeBuildkitVolume(volume, organizationId)) {
      result.volumes++;
    }
  }
  idleSince.delete(organizationId);
  return result;
}

/** A helper found running as it would be launched now, and kept as is. */
interface ReusedHelper {
  name: string;
  observation: BuildkitHelperObservation;
  stamp: string;
}

/**
 * Lazy, idempotent launch of every built-in pull-through mirror (one registry
 * per MIRROR_REGISTRIES entry). Returns the `registry=ref;...` mapping the
 * buildkitd entrypoint turns into `[registry."<x>"]` blocks, and the mirrors
 * that were running as launched now and kept as they were. Best-effort per
 * mirror — a registry whose mirror fails to come up is dropped from the mapping
 * (its base images then aren't pullable, but the others still work).
 */
async function ensureBuildkitdMirrors(
  cfg: SpawnerConfig,
  organizationId: string,
  /** Is the organization's builder idle? A drifted mirror is recreated only
   * then: the pulls through it come from that builder's builds. */
  idle: () => Promise<boolean>,
  /** The mirrors as one inspect of every helper read them. */
  readings: ReadonlyMap<string, BuildkitHelperReading>,
): Promise<{ mapping: string; reused: ReusedHelper[] }> {
  const outcomes = await Promise.all(
    MIRROR_REGISTRIES.map(async (registry) => {
      try {
        const reused = await ensureOneMirror(
          cfg,
          organizationId,
          registry,
          idle,
          readings.get(buildkitdMirrorContainerName(organizationId, registry)),
        );
        return {
          pair: `${registry}=${buildkitdMirrorRef(organizationId, registry)}`,
          reused,
        };
      } catch (err) {
        console.warn(
          `[sandbox.buildkitd] mirror for ${registry} unavailable; ` +
            `${registry} base images won't be pullable in builds:`,
          err,
        );
        return null;
      }
    }),
  );
  operationSignal()?.throwIfAborted();
  return {
    mapping: outcomes
      .filter((outcome) => outcome !== null)
      .map((outcome) => outcome.pair)
      .join(';'),
    reused: outcomes.flatMap((outcome) =>
      outcome?.reused ? [outcome.reused] : [],
    ),
  };
}

async function ensureOneMirror(
  cfg: SpawnerConfig,
  organizationId: string,
  registry: string,
  idle: () => Promise<boolean>,
  reading: BuildkitHelperReading | undefined,
): Promise<ReusedHelper | null> {
  const name = buildkitdMirrorContainerName(organizationId, registry);
  const existing = mirrorInFlight.get(name);
  if (existing) return waitWithinOperation(existing).then(() => null);
  const work = ensureOneMirrorUnlocked(
    cfg,
    organizationId,
    registry,
    name,
    idle,
    reading,
  ).finally(() => {
    mirrorInFlight.delete(name);
  });
  mirrorInFlight.set(name, work);
  return work;
}

/** Start a stopped helper again, by the immutable id its inspect showed.
 * One whose stamp and image are current was launched exactly as it would be
 * now, so a start spares the create and keeps its writable layer; its
 * entrypoint installs the egress fence again as on any start. False when it
 * did not start: the caller recreates it. */
async function startStoppedHelper(
  name: string,
  helper: BuildkitHelperObservation,
): Promise<boolean> {
  if (!DOCKER_ID_RE.test(helper.id)) return false;
  const started = await runDocker(['start', helper.id], { timeoutMs: 30_000 });
  if (started.exitCode === 0) return true;
  console.warn(
    `[sandbox.buildkitd] could not start ${name} again; recreating it: ${started.stderr.trim() || 'no output'}`,
  );
  return false;
}

/** A helper's reading from the shared inspect, or its own inspect when
 * there is none. A refused helper throws. */
async function helperFromReading(
  reading: BuildkitHelperReading | undefined,
  name: string,
  organizationId: string,
  network: string,
): Promise<BuildkitHelperObservation | null> {
  if (reading === undefined) {
    return inspectBuildkitHelper(name, organizationId, network);
  }
  if ('refused' in reading) throw reading.refused;
  return reading.helper;
}

async function ensureOneMirrorUnlocked(
  cfg: SpawnerConfig,
  organizationId: string,
  registry: string,
  name: string,
  idle: () => Promise<boolean>,
  reading: BuildkitHelperReading | undefined,
): Promise<ReusedHelper | null> {
  const limits = buildkitHelperLimits(cfg, 'mirror');
  const environment = buildkitMirrorEnvironment(cfg, registry);
  const stamp = helperStamp(cfg.buildkitdMirrorImage, limits, environment);
  const helper = await helperFromReading(
    reading,
    name,
    organizationId,
    cfg.egressNetwork,
  );
  if (helper !== null) {
    if (helper.running) {
      if (!(await helperDrifted(helper, stamp, cfg.buildkitdMirrorImage))) {
        return { name, observation: helper, stamp };
      }
      // A mirror launched otherwise than now keeps serving while a build
      // may pull through it, with the bounds that apply in place.
      if (!(await idle())) {
        if (helper.stamp !== stamp) {
          await updateHelperLimits(name, stamp, limits);
        }
        return null;
      }
    } else if (
      !(await helperDrifted(helper, stamp, cfg.buildkitdMirrorImage)) &&
      (await startStoppedHelper(name, helper))
    ) {
      return null;
    }
    const rm = await runDocker(['rm', '-f', name]);
    if (rm.exitCode !== 0) {
      console.warn(
        `[sandbox.buildkitd] could not reap mirror ${name}: ${rm.stderr.trim()}`,
      );
    }
  }

  const volume = buildkitdMirrorVolumeName(organizationId, registry);
  await ensureBuildkitVolume(volume, organizationId);

  const run = await runDocker(
    [
      'run',
      '-d',
      '--name',
      name,
      '--label',
      'tale.buildkitd=1',
      '--label',
      `tale.org=${organizationId}`,
      '--label',
      `${HELPER_STAMP_LABEL}=${stamp}`,
      '--restart',
      'unless-stopped',
      ...limits,
      // On this organization's network so buildkit reaches it by name; it pulls upstream
      // through the egress proxy (so the mirror itself needs no external DNS).
      '--network',
      cfg.egressNetwork,
      ...environment.flatMap((value) => ['--env', value]),
      '--mount',
      `type=volume,src=${volume},dst=/var/lib/registry`,
      // Idle mirrors are removed, so on a host where every organization is
      // idle nothing references this image, and an image prune can delete
      // it. A pull inside a create's budget would be cut short at every
      // attempt: a missing image is pulled in the background instead.
      '--pull',
      'never',
      cfg.buildkitdMirrorImage,
    ],
    // Bounded so a wedged daemon can't pin the session create (or boot)
    // forever.
    { timeoutMs: 120_000 },
  );
  if (run.exitCode !== 0) {
    if (imageMissing(run.stderr)) {
      pullImageInBackground(cfg.buildkitdMirrorImage);
      throw new Error(
        `buildkitd: ${cfg.buildkitdMirrorImage} is not on this host yet; the ${registry} mirror starts once it is pulled`,
      );
    }
    if (/already in use|already exists/i.test(run.stderr)) {
      if (
        (await inspectBuildkitContainer(
          name,
          organizationId,
          cfg.egressNetwork,
        )) === 'running'
      )
        return null;
    }
    throw new Error(
      `buildkitd: failed to launch mirror ${name}: ${run.stderr.trim() || run.stdout.trim()}`,
    );
  }
  return null;
}

/** An organization's builder, ready for a session: the endpoint its buildx
 * builder targets, the plan its attachment to the build network is checked
 * against, and the docker.io mirror a session's inner engine pulls through.
 * The mirror is absent when it did not come up, so no session engine tries a
 * name that does not resolve before every Docker Hub pull. */
export interface BuildkitdReady {
  endpoint: string;
  plan: BuildkitNetworkPlan;
  dockerHubMirror?: string;
}

/** The docker.io mirror a `registry=ref;…` mirror mapping names, if any. */
function dockerHubMirrorIn(mapping: string): string | undefined {
  for (const pair of mapping.split(';')) {
    const [registry, ref] = pair.split('=');
    if (registry === 'docker.io' && ref) return ref;
  }
  return undefined;
}

/**
 * Lazy, idempotent launch of the organization's buildkitd; returns the
 * endpoint a session's remote buildx builder should target and the private
 * network plan the session attaches by. An already-running daemon is detected
 * via `docker inspect` and reused (its persistent cache volume survives
 * spawner + daemon restarts). Helpers verified in full within the last
 * {@link VERIFIED_TTL_MS} are confirmed with one inspect instead; `fresh`
 * asks for the full check regardless. Throws on a hard launch failure — the
 * caller (docker-session-backend) treats the shared cache as an optimization
 * and proceeds without it on error, never failing session creation.
 */
export async function provisionBuildkitd(
  cfg: SpawnerConfig,
  organizationId: string,
  options: { fresh?: boolean } = {},
): Promise<BuildkitdReady> {
  const name = buildkitdContainerName(organizationId);
  if (options.fresh === true)
    verifiedHelpers.delete(verifiedKey(organizationId));
  const existing = ensureInFlight.get(name);
  if (existing) return waitWithinOperation(existing);
  const release = retainBuildkitd(organizationId);
  const work = outsideOperationBudget(() =>
    withOperationBudget(cfg.buildkitdProvisionTimeoutMs ?? 5_000, () =>
      withBuildkitdOperation(organizationId, () =>
        ensureBuildkitdUnlocked(cfg, organizationId, name),
      ),
    ),
  ).finally(() => {
    release();
    ensureInFlight.delete(name);
  });
  ensureInFlight.set(name, work);
  return waitWithinOperation(work);
}

/** {@link provisionBuildkitd}, for a caller that needs the endpoint alone. */
export async function ensureBuildkitd(
  cfg: SpawnerConfig,
  organizationId: string,
  options: { fresh?: boolean } = {},
): Promise<string> {
  return (await provisionBuildkitd(cfg, organizationId, options)).endpoint;
}

/** What one exec reads of a running builder's egress fence: whether its
 * marker is there, the live config, and what the proxy host resolves to now.
 * The host is the script's positional parameter, never part of its text. */
const FENCE_PROBE = `
if [ -f ${EGRESS_READY_MARKER} ]; then echo '#tale-fence marker 0'; else echo '#tale-fence marker 1'; fi
echo '#tale-fence toml'
cat ${BUILDKITD_LIVE_TOML} 2>/dev/null
echo '#tale-fence resolved'
if [ -n "$1" ]; then getent hosts "$1" 2>/dev/null; fi
exit 0
`;

/** {@link FENCE_PROBE}'s output, or null when it is not the probe's. */
export function parseFenceProbe(
  stdout: string,
): { marker: boolean; toml: string; resolved: string } | null {
  const match =
    /^#tale-fence marker ([01])\n#tale-fence toml\n([\s\S]*?)\n?#tale-fence resolved\n?([\s\S]*)$/.exec(
      stdout.replace(/^\s+/, ''),
    );
  if (match === null) return null;
  return {
    marker: match[1] === '0',
    toml: match[2] ?? '',
    resolved: match[3] ?? '',
  };
}

/** A running builder's egress fence: in place and current, missing or
 * stale, or not conclusively read. */
type FenceVerdict = 'healthy' | 'broken' | 'unknown';

/**
 * Is a RUNNING buildkitd's egress fence actually installed AND still pointing at
 * the current egress? Two failure modes, both of which leave the daemon serving
 * builds that can't reach the internet while it looks "Running":
 *
 *  1. Fence missing — the entrypoint writes EGRESS_READY_MARKER only after
 *     redsocks + the default route + the [dns] block are in place. Absent ⇒ the
 *     daemon restarted (--restart unless-stopped) while sandbox-egress was
 *     unreachable and came up with no fence at all.
 *  2. Fence stale — the [dns] nameserver (and the redsocks target, written from
 *     the same egress IP) is pinned to the egress IP resolved when the fence was
 *     LAST installed. sandbox-egress is recreated by every stack restart
 *     (`bun dev` / `docker:dev` / `docker compose up` / `tale deploy`) and can
 *     land on a different IP; this daemon, not being a compose service, keeps
 *     running with the old IP. RUN-step DNS then goes to whatever now holds that
 *     IP (a non-resolver) and every external lookup fails ("Temporary failure
 *     resolving 'archive.ubuntu.com'"). The marker is still present, so marker
 *     presence alone can't catch this — we compare the pinned IP to the live one.
 *
 * Either ⇒ 'broken': recreate (the entrypoint reinstalls the fence against the
 * CURRENT egress IP; the persistent cache volume is preserved). All three are
 * read in one exec. A probe that cannot be read conclusively is 'unknown': the
 * daemon is reused, so a transient `docker exec` hiccup never needlessly tears
 * down a working daemon, but it is not remembered as verified.
 */
async function buildkitdEgressFence(
  cfg: SpawnerConfig,
  name: string,
): Promise<FenceVerdict> {
  // The live [dns] pin and the egress's CURRENT IP are both read from inside
  // the daemon (its embedded resolver answers the sibling proxy name).
  const host = egressProxyHostname(cfg.egressProxy);
  const probe = await runDocker(
    ['exec', name, '/bin/sh', '-c', FENCE_PROBE, 'sh', host ?? ''],
    { timeoutMs: 5_000 },
  );
  if (probe.exitCode !== 0) return 'unknown'; // exec glitch ⇒ reuse, unproven
  const fence = parseFenceProbe(probe.stdout);
  if (fence === null) return 'unknown';
  if (!fence.marker) return 'broken'; // definitively absent ⇒ broken
  if (!host) return 'healthy'; // no proxy host configured ⇒ nothing to compare
  const pinnedIp = parseDnsNameserver(fence.toml);
  if (!pinnedIp) return 'healthy'; // no [dns] (skip-egress dev mode) ⇒ nothing to compare
  const currentIp = firstIpv4(fence.resolved);
  if (!currentIp) return 'unknown'; // unresolvable now ⇒ reuse, unproven
  if (currentIp === pinnedIp) return 'healthy';
  console.warn(
    `[sandbox.buildkitd] ${name} egress fence is stale: [dns] pinned to ${pinnedIp} ` +
      `but ${host} now resolves to ${currentIp} (sandbox-egress was recreated). ` +
      `Recreating so build RUN steps regain DNS + egress.`,
  );
  return 'broken';
}

/** How long an organization's helpers, once verified in full, are taken as
 * they were on the strength of one `docker inspect`: the helpers and the
 * egress proxy are the same containers, none restarted since, the proxy is
 * still on the organization's network at the address the fence pins, and
 * every stamp is the one a launch now would carry. A fence can only go stale
 * through one of those changing. Past this, the full check runs again, and
 * with it the image drift check. */
const VERIFIED_TTL_MS = 60_000;

interface VerifiedHelpers {
  /** When the full check that verified them started. */
  atMs: number;
  /** The organization's private network and its plan. */
  network: string;
  plan: BuildkitNetworkPlan;
  egress: { id: string; startedAt: string; ipAddress: string };
  helpers: ReusedHelper[];
  /** The docker.io mirror, up when they were verified. */
  dockerHubMirror?: string;
}

/** Per Docker target and organization: its helpers' last full verification. */
const verifiedHelpers = new Map<string, VerifiedHelpers>();

function verifiedKey(organizationId: string): string {
  return `${dockerTarget()}\t${organizationId}`;
}

/** Forget an organization's verified helpers: they are being stopped,
 * removed or recreated, and the next ensure checks them in full. */
function forgetVerified(organizationId: string): void {
  verifiedHelpers.delete(verifiedKey(organizationId));
}

/** Forget every verified organization (tests). */
export function forgetVerifiedBuildkitd(): void {
  verifiedHelpers.clear();
}

/** Forget every verified organization and remembered egress proxy (tests). */
export function resetBuildkitObservations(): void {
  verifiedHelpers.clear();
  forgetKnownEgress();
}

const VERIFY_FORMAT =
  '{"id":{{json .Id}},"running":{{json .State.Running}},"startedAt":{{json .State.StartedAt}},"labels":{{json .Config.Labels}},"networks":{{json .NetworkSettings.Networks}},"ports":{{json .HostConfig.PortBindings}}}';

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : null;
}

/** Are these helpers still as their full verification found them? One
 * inspect of the egress proxy and every helper by immutable id answers it;
 * any difference, a missing container or an unreadable answer is "no". */
async function stillVerified(
  organizationId: string,
  verified: VerifiedHelpers,
  nowMs: number,
): Promise<boolean> {
  if (nowMs < verified.atMs || nowMs - verified.atMs >= VERIFIED_TTL_MS) {
    return false;
  }
  const result = await readDockerMetadata(
    [
      'inspect',
      '--format',
      VERIFY_FORMAT,
      verified.egress.id,
      ...verified.helpers.map((helper) => helper.observation.id),
    ],
    { priority: true, timeoutMs: 5_000 },
  );
  if (result.exitCode !== 0) return false;
  const byId = new Map<string, Record<string, unknown>>();
  for (const line of result.stdout.split('\n').filter(Boolean)) {
    let data: Record<string, unknown> | null;
    try {
      data = record(JSON.parse(line));
    } catch (error) {
      console.warn(
        `[sandbox.buildkitd] unreadable helper inspect for ${organizationId}; checking its helpers in full:`,
        error,
      );
      return false;
    }
    if (data !== null && typeof data.id === 'string') byId.set(data.id, data);
  }
  const onNetwork = (data: Record<string, unknown> | undefined) =>
    record(record(data?.networks)?.[verified.network]);
  const egress = byId.get(verified.egress.id);
  const egressEndpoint = onNetwork(egress);
  if (
    egress?.running !== true ||
    egress.startedAt !== verified.egress.startedAt ||
    egressEndpoint?.NetworkID !== verified.plan.id ||
    egressEndpoint.IPAddress !== verified.egress.ipAddress
  ) {
    return false;
  }
  for (const { observation, stamp } of verified.helpers) {
    const helper = byId.get(observation.id);
    const labels = record(helper?.labels);
    const networks = record(helper?.networks);
    const ports = record(helper?.ports);
    if (
      helper?.running !== true ||
      helper.startedAt !== observation.startedAt ||
      labels?.['tale.buildkitd'] !== '1' ||
      labels['tale.org'] !== organizationId ||
      labels[HELPER_STAMP_LABEL] !== stamp ||
      networks === null ||
      Object.keys(networks).join('\n') !== verified.network ||
      onNetwork(helper)?.NetworkID !== verified.plan.id ||
      (ports !== null && Object.keys(ports).length > 0)
    ) {
      return false;
    }
  }
  return true;
}

async function ensureBuildkitdUnlocked(
  cfg: SpawnerConfig,
  organizationId: string,
  name: string,
): Promise<BuildkitdReady> {
  const endpoint = buildkitdEndpoint(organizationId);
  const key = verifiedKey(organizationId);
  const verified = verifiedHelpers.get(key);
  // Gone unless proven again: any failure below leaves it forgotten.
  verifiedHelpers.delete(key);
  const startedAtMs = Date.now();
  if (
    verified !== undefined &&
    (await stillVerified(organizationId, verified, startedAtMs))
  ) {
    verifiedHelpers.set(key, verified);
    return {
      endpoint,
      plan: verified.plan,
      ...(verified.dockerHubMirror === undefined
        ? {}
        : { dockerHubMirror: verified.dockerHubMirror }),
    };
  }
  // Stops drained legacy helpers only: their removal, a long one, belongs to
  // the upkeep sweep, never to a create's provisioning budget.
  await retireLegacyBuildkitd(cfg.buildkitdCacheRetentionMs, {
    stopOnly: true,
  });
  const privateNetwork = await ensureBuildkitNetwork(
    cfg,
    organizationId,
    buildkitdNetworkName(organizationId),
  );
  const { reused: helpers, mapping } = await ensureBuildkitdOnNetwork(
    {
      ...cfg,
      egressNetwork: privateNetwork.network,
      egressProxy: privateNetwork.proxy,
    },
    organizationId,
    name,
  );
  const dockerHubMirror = dockerHubMirrorIn(mapping);
  const egressEndpoint = privateNetwork.egress.networks[privateNetwork.network];
  if (
    helpers !== null &&
    helpers.length === organizationHelperNames(organizationId).length &&
    helpers.every(({ observation }) => DOCKER_ID_RE.test(observation.id)) &&
    egressEndpoint !== undefined &&
    egressEndpoint.networkId === privateNetwork.plan.id &&
    egressEndpoint.ipAddress !== ''
  ) {
    verifiedHelpers.set(key, {
      atMs: startedAtMs,
      network: privateNetwork.network,
      plan: privateNetwork.plan,
      egress: {
        id: privateNetwork.egress.id,
        startedAt: privateNetwork.egress.startedAt,
        ipAddress: egressEndpoint.ipAddress,
      },
      helpers,
      ...(dockerHubMirror === undefined ? {} : { dockerHubMirror }),
    });
  }
  return {
    endpoint,
    plan: privateNetwork.plan,
    ...(dockerHubMirror === undefined ? {} : { dockerHubMirror }),
  };
}

const GIB = 1024 ** 3;
/** The most build cache one organization's builder keeps: the cap its GC
 * policy ships with (BuildKit reads `20GB` as binary gigabytes). */
const MAX_CACHE_BYTES = 20 * GIB;
/** The cache GC never prunes below for want of free disk, at most. */
const MAX_RESERVED_BYTES = 2 * GIB;
/** The least cache a builder is capped to, however small the disk. */
const MIN_CACHE_BYTES = GIB;

/** The cache bounds one organization's builder runs with: the operator's cap
 * (SANDBOX_BUILDKITD_MAX_CACHE), else a tenth of the session disk's size, at
 * least 1 GiB and at most the 20 GiB the policy ships with. A fixed 20 GiB per
 * organization let ten building organizations claim 200 GiB of any disk. The
 * floor that disk pressure never prunes below stays a tenth of the cap, at
 * most 2 GiB. The disk-sized cap is whole GiB: some filesystems (ZFS among
 * them) report a total that moves with the pool's use, and a cap that moved
 * with it would change the builder's stamp, and recreate the builder, at
 * every disk re-read. The operator's cap is whole MiB. */
export function buildkitCacheBudget(
  diskTotalBytes: number | null,
  configuredBytes?: number,
): { maxUsedBytes: number; reservedBytes: number } {
  const sized =
    configuredBytes ??
    (diskTotalBytes === null || diskTotalBytes <= 0
      ? MAX_CACHE_BYTES
      : Math.min(
          MAX_CACHE_BYTES,
          Math.max(
            MIN_CACHE_BYTES,
            Math.floor(diskTotalBytes / 10 / GIB) * GIB,
          ),
        ));
  const maxUsedBytes = Math.floor(sized / MIB) * MIB;
  const reservedBytes =
    Math.floor(Math.min(MAX_RESERVED_BYTES, maxUsedBytes / 10) / MIB) * MIB;
  return { maxUsedBytes, reservedBytes };
}

/** How often the session disk's size is read again for the cache cap: a
 * disk is resized rarely, and a changed cap reaches a builder only when it
 * is recreated anyway. */
const DISK_SIZE_TTL_MS = 10 * 60_000;
let sessionDiskSize: { path: string; atMs: number; bytes: number } | undefined;
let sessionDiskSizeWarned = '';

/** The size of the disk the session root lives on, as the spawner's own
 * admission reads it (`statfs` of the session root, blocks times block
 * size). Null until it has been read once; afterwards the last size read
 * stands in for a read that fails, so a builder's stamp does not flip with
 * a passing error. */
async function sessionDiskTotalBytes(path: string): Promise<number | null> {
  const known = sessionDiskSize?.path === path ? sessionDiskSize : undefined;
  const nowMs = Date.now();
  if (known !== undefined && nowMs - known.atMs < DISK_SIZE_TTL_MS) {
    return known.bytes;
  }
  try {
    const disk = await statfs(path);
    const bytes = disk.blocks * disk.bsize;
    sessionDiskSize = { path, atMs: nowMs, bytes };
    return bytes;
  } catch (error) {
    if (sessionDiskSizeWarned !== path) {
      sessionDiskSizeWarned = path;
      console.warn(
        `[sandbox.buildkitd] cannot read the size of ${path}; build caches keep the ${MAX_CACHE_BYTES / GIB} GiB cap until it can be read:`,
        error,
      );
    }
    return known?.bytes ?? null;
  }
}

/** What a builder launched now is configured with beyond its image and
 * bounds, as its stamp records it: a builder launched with other settings
 * adopts them when it is recreated. */
export function builderConfiguration(
  parallelism: number,
  budget: { maxUsedBytes: number; reservedBytes: number },
): string[] {
  return [
    `solver-parallelism=${parallelism}`,
    `max-used-space=${budget.maxUsedBytes}`,
    `reserved-space=${budget.reservedBytes}`,
  ];
}

/** The solver parallelism a builder launched now runs with. */
export function builderParallelism(
  cfg: Pick<SpawnerConfig, 'buildkitdCpus' | 'session'>,
): number {
  return Math.max(
    1,
    Math.floor(cfg.buildkitdCpus ?? cfg.session.agentProfile.cpus),
  );
}

/** The label recording what a builder was launched with beyond its stamp:
 * the registries its mirror mapping covers and the proxy it egresses by. Both
 * come from its organization's network and mirrors as they are at its launch,
 * so a stopped builder started again by id keeps them. */
const BUILDER_LAUNCH_LABEL = 'tale.buildkitd-launch';

/** The {@link BUILDER_LAUNCH_LABEL} of a builder launched with this mirror
 * mapping (`registry=ref;…`) and egress proxy URL: `<proxy hash>;<registry>,…`.
 * The proxy is hashed, since a proxy URL may carry credentials. */
export function builderLaunchRecord(mirrors: string, proxy: string): string {
  const registries = mirrors
    .split(';')
    .filter(Boolean)
    .map((pair) => pair.split('=')[0])
    .join(',');
  const proxyHash = createHash('sha256')
    .update(proxy)
    .digest('hex')
    .slice(0, 16);
  return `${proxyHash};${registries}`;
}

/** Was this builder launched otherwise than it would be with the mirror
 * mapping its mirrors give now: through another proxy, or without a registry
 * a mirror serves now (one whose mirror failed to come up at its launch)? A
 * registry it maps whose mirror is down now is no drift: BuildKit cannot pull
 * from that registry without its mirror either way. A builder without the
 * record predates it. */
export function builderLaunchDrifted(
  launch: string | undefined,
  mirrors: string,
  proxy: string,
): boolean {
  if (launch === undefined) return true;
  const [haveProxy, haveRegistries = ''] = launch.split(';');
  const [wantProxy, wantRegistries = ''] = builderLaunchRecord(
    mirrors,
    proxy,
  ).split(';');
  if (haveProxy !== wantProxy) return true;
  const have = new Set(haveRegistries.split(','));
  return wantRegistries
    .split(',')
    .filter(Boolean)
    .some((registry) => !have.has(registry));
}

/** How a builder launched now is launched: its bounds, solver parallelism,
 * cache bounds and the stamp they make. */
async function builderLaunch(cfg: SpawnerConfig): Promise<{
  limits: string[];
  parallelism: number;
  budget: { maxUsedBytes: number; reservedBytes: number };
  stamp: string;
}> {
  const limits = buildkitHelperLimits(cfg, 'builder');
  const parallelism = builderParallelism(cfg);
  const budget = buildkitCacheBudget(
    await sessionDiskTotalBytes(cfg.hostSessionRoot),
    cfg.buildkitdMaxCacheBytes,
  );
  const stamp = helperStamp(
    cfg.buildkitdImage,
    limits,
    builderConfiguration(parallelism, budget),
  );
  return { limits, parallelism, budget, stamp };
}

/** Bring the builder and its mirrors up on the organization's network.
 * Returns the mirror mapping that is up, and every helper when all four were
 * found running as launched now, the builder's fence verified, and kept as
 * they were (`reused`, null otherwise). */
async function ensureBuildkitdOnNetwork(
  cfg: SpawnerConfig,
  organizationId: string,
  name: string,
): Promise<{ reused: ReusedHelper[] | null; mapping: string }> {
  // Already running? Reuse it ONLY if its egress fence is still installed AND
  // still pinned to the current egress IP. A daemon that restarted (--restart
  // unless-stopped) with sandbox-egress unreachable, or that kept running while
  // a stack restart moved sandbox-egress to a new IP, silently serves builds
  // with no working DNS/egress (RUN steps fail to resolve any external host) —
  // recreate it. See buildkitdEgressFence.
  const { limits, parallelism, budget, stamp } = await builderLaunch(cfg);
  // The builder and its three mirrors in one inspect.
  const readings = await inspectBuildkitHelpers(
    organizationHelperNames(organizationId),
    organizationId,
    cfg.egressNetwork,
  );
  const helper = await helperFromReading(
    readings.get(name),
    name,
    organizationId,
    cfg.egressNetwork,
  );
  // The mirror mapping the builder is launched with, once the mirrors are up.
  let mirrors: string | undefined;
  if (helper !== null) {
    if (helper.running) {
      const fence = await buildkitdEgressFence(cfg, name);
      if (fence !== 'broken') {
        // A builder launched by an earlier release or with other bounds runs
        // its old image (and with it the old cache policy): it is recreated
        // once no build is under way, and meanwhile gets the bounds that
        // apply in place.
        const idle = idleOnce(name);
        // A partial idle-stop/crash may have stopped mirrors while the
        // builder stayed healthy. Reusing the builder must revive those
        // caches too. They come first: a builder launched without a registry
        // their mapping covers now, or through another proxy, is drifted.
        const ensured = await ensureBuildkitdMirrors(
          cfg,
          organizationId,
          idle,
          readings,
        );
        const drifted =
          builderLaunchDrifted(
            helper.launch,
            ensured.mapping,
            cfg.egressProxy,
          ) || (await helperDrifted(helper, stamp, cfg.buildkitdImage));
        if (!drifted || !(await idle())) {
          if (helper.stamp !== stamp) {
            await updateHelperLimits(name, stamp, limits);
          }
          return {
            reused:
              !drifted && fence === 'healthy'
                ? [{ name, observation: helper, stamp }, ...ensured.reused]
                : null,
            mapping: ensured.mapping,
          };
        }
        mirrors = ensured.mapping;
        console.log(
          `[sandbox.buildkitd] recreating ${name}: it was launched with another ` +
            `image, other bounds, another proxy or fewer registry mirrors, and ` +
            `no build is running. The persistent cache volume is preserved.`,
        );
      } else {
        console.warn(
          `[sandbox.buildkitd] ${name} is running but its egress fence is missing or ` +
            `stale; recreating so build RUN steps regain internet. The persistent ` +
            `cache volume is preserved.`,
        );
      }
    } else if (!(await helperDrifted(helper, stamp, cfg.buildkitdImage))) {
      // Stopped for want of sessions and launched as it would be now: its
      // mirrors first (it pulls base images through them), then itself,
      // unless it was launched without a registry they serve now or through
      // another proxy: a start keeps the mapping and proxy of its launch.
      mirrors = (
        await ensureBuildkitdMirrors(
          cfg,
          organizationId,
          NOTHING_BUILDS,
          readings,
        )
      ).mapping;
      if (
        !builderLaunchDrifted(helper.launch, mirrors, cfg.egressProxy) &&
        (await startStoppedHelper(name, helper))
      ) {
        return { reused: null, mapping: mirrors };
      }
    }
    // Stopped/dead OR running-but-egress-broken: reap it so the `run --name`
    // below recreates it. The cache lives in the volume, not the container, so
    // nothing is lost.
    const rm = await runDocker(['rm', '-f', name]);
    if (rm.exitCode !== 0) {
      console.warn(
        `[sandbox.buildkitd] could not reap container ${name}: ${rm.stderr.trim()}`,
      );
    }
  }

  // Persistent cache volume. Owned solely by the root buildkitd daemon, so —
  // unlike the per-org dep caches (shared by two uids, hence 1777) — it needs no
  // perms fix; just ensure it exists.
  const volume = buildkitdCacheVolumeName(organizationId);
  await ensureBuildkitVolume(volume, organizationId);

  // Bring up the pull-through mirrors first (buildkit pulls base images from them
  // by name, sidestepping its broken external-name DNS — see MIRROR_REGISTRIES).
  mirrors ??= (
    await ensureBuildkitdMirrors(cfg, organizationId, NOTHING_BUILDS, readings)
  ).mapping;

  const run = await runDocker(
    [
      'run',
      '-d',
      '--name',
      name,
      '--label',
      'tale.buildkitd=1',
      '--label',
      `tale.org=${organizationId}`,
      '--label',
      `${HELPER_STAMP_LABEL}=${stamp}`,
      '--label',
      `${BUILDER_LAUNCH_LABEL}=${builderLaunchRecord(mirrors, cfg.egressProxy)}`,
      // Long-lived shared infra: survive a daemon crash + host docker restart.
      '--restart',
      'unless-stopped',
      ...limits,
      // Only this organization's sessions can reach the builder. RUN-step
      // egress goes through the proxy attached to this private bridge.
      '--network',
      cfg.egressNetwork,
      // buildkitd needs mount/namespace ops to run builds. This is a host-level
      // build daemon isolated from other organizations by its private network
      // and volumes; build RUN egress is fenced by the image entrypoint.
      // nosemgrep: tools.opengrep.rules.trailofbits.generic.container-privileged.container-privileged -- intentional: buildkitd requires privileged to run builds; this is host-level shared infra (not user-code), egress-fenced via sandbox-egress
      '--privileged',
      '--mount',
      `type=volume,src=${volume},dst=/var/lib/buildkit`,
      // The image entrypoint resolves the egress proxy from HTTP(S)_PROXY (a
      // sibling name, which the embedded resolver answers) to set up redsocks +
      // [dns]; and writes one [registry] mirror block per TALE_BUILDKITD_MIRRORS
      // `registry=ref` pair.
      '--env',
      `TALE_BUILDKITD_MIRRORS=${mirrors}`,
      '--env',
      `TALE_BUILDKITD_MAX_PARALLELISM=${parallelism}`,
      // The GC policy's cache cap and pressure floor, in bytes.
      '--env',
      `TALE_BUILDKITD_MAX_USED=${budget.maxUsedBytes}`,
      '--env',
      `TALE_BUILDKITD_RESERVED=${budget.reservedBytes}`,
      '--env',
      `HTTPS_PROXY=${cfg.egressProxy}`,
      '--env',
      `HTTP_PROXY=${cfg.egressProxy}`,
      cfg.buildkitdImage,
    ],
    // A first-use image pull can take a while; bounded so a wedged daemon
    // can't pin the session create (or boot) forever.
    { timeoutMs: 120_000 },
  );
  if (run.exitCode !== 0) {
    // Racy across spawner replicas / restarts: a peer may have created it
    // between our inspect and our run. Adopt only a running, owned peer.
    if (/already in use|already exists/i.test(run.stderr)) {
      if (
        (await inspectBuildkitContainer(
          name,
          organizationId,
          cfg.egressNetwork,
        )) === 'running'
      )
        return { reused: null, mapping: mirrors };
    }
    throw new Error(
      `buildkitd: failed to launch ${name}: ${run.stderr.trim() || run.stdout.trim()}`,
    );
  }
  return { reused: null, mapping: mirrors };
}
