import {
  assertBuildSubnet,
  daemonReservedSubnets,
  dockerIpv4Subnets,
  selectBuildSubnet,
} from './buildkit-network-pool.ts';
import {
  ipv4Subnet,
  isIpv4Address,
  parseDindInnerPool,
  subnetsOverlap,
} from './network-address.ts';
import {
  outsideOperationBudget,
  waitWithinOperation,
} from './operation-budget.ts';
import { dockerTarget, runDocker } from './spawn-util.ts';
import type { RunDockerResult } from './spawn-util.ts';
import type { SpawnerConfig } from './types.ts';
import { ORG_ID_ALPHABET_RE } from './wire.ts';

const EGRESS_ALIAS = 'tale-buildkit-egress';
const DOCKER_ID_RE = /^[a-f0-9]{12,64}$/;
const METADATA_STDOUT_MAX_BYTES = 1024 * 1024;
const LEGACY_BUILDKIT_ENDPOINT = 'tcp://tale-buildkitd:1234';
const LEGACY_HELPERS = [
  'tale-buildkitd',
  'tale-buildkitd-mirror',
  'tale-buildkitd-mirror-docker-io',
  'tale-buildkitd-mirror-ghcr-io',
  'tale-buildkitd-mirror-quay-io',
];
/** The cache volumes the global helpers used. */
const LEGACY_VOLUMES = [
  'tale-buildkitd-cache',
  'tale-buildkitd-mirror-cache-docker-io',
  'tale-buildkitd-mirror-cache-ghcr-io',
  'tale-buildkitd-mirror-cache-quay-io',
];

/** How long stopped build helpers keep their caches, unless
 * SANDBOX_BUILDKITD_CACHE_RETENTION says otherwise: an organization's, and
 * the legacy global ones. */
export const DEFAULT_CACHE_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function object(value: unknown): Record<string, unknown> {
  if (!isObject(value)) {
    throw new Error('buildkitd: invalid Docker resource metadata');
  }
  return value;
}

function parsedObject(text: string): Record<string, unknown> {
  return object(JSON.parse(text));
}

/** What a session's attachment to its organization's build network is
 * checked against: the network's immutable id and its IPv4 subnets. */
export interface BuildkitNetworkPlan {
  id: string;
  subnets: string[];
}

/** The plan of an organization network from its `docker network inspect`
 * JSON. Refuses one the organization does not own, one that is not an
 * internal IPv4-only bridge, and subnets outside the private ranges. */
export function buildkitNetworkPlan(
  network: Record<string, unknown>,
  organizationId: string,
): BuildkitNetworkPlan {
  const labels = object(network.Labels);
  if (
    labels['tale.buildkitd'] !== '1' ||
    labels['tale.org'] !== organizationId ||
    network.Driver !== 'bridge' ||
    network.Internal !== true ||
    network.EnableIPv6 !== false
  ) {
    throw new Error(
      'buildkitd: refusing foreign or non-private session build network',
    );
  }
  const subnets = dockerIpv4Subnets(object(network.IPAM).Config);
  if (subnets.length === 0) {
    throw new Error('buildkitd: session build network has no IPv4 subnet');
  }
  for (const subnet of subnets) assertBuildSubnet(subnet);
  if (typeof network.Id !== 'string' || !/^[a-f0-9]{64}$/.test(network.Id)) {
    throw new Error('buildkitd: invalid private network identity');
  }
  return { id: network.Id, subnets: subnets.map((subnet) => subnet.address) };
}

export async function readDockerMetadata(
  args: string[],
  options: Parameters<typeof runDocker>[1] = {},
): Promise<RunDockerResult> {
  const result = await runDocker(args, {
    ...options,
    stdoutMaxBytes: METADATA_STDOUT_MAX_BYTES,
  });
  // A valid retained prefix is not proof of complete ownership or dependency
  // information. In particular, the missing suffix may contain a live legacy
  // session: refuse the observation before any adoption or stop decision.
  if (result.stdoutTruncated) {
    throw new Error('buildkitd: Docker metadata stdout was truncated');
  }
  return result;
}

async function inspect(
  args: string[],
  options: Parameters<typeof runDocker>[1] = {},
): Promise<string | null> {
  const result = await readDockerMetadata(args, options);
  if (result.exitCode === 0) return result.stdout.trim();
  if (
    /no such (?:network|volume|object|container)|not found/i.test(result.stderr)
  ) {
    return null;
  }
  throw new Error(
    `buildkitd: resource inspection failed: ${result.stderr.trim()}`,
  );
}

function assertOwner(
  labels: unknown,
  organizationId: string,
  name: string,
): void {
  const values = object(labels);
  if (
    values['tale.buildkitd'] !== '1' ||
    values['tale.org'] !== organizationId
  ) {
    throw new Error(`buildkitd: refusing foreign or unowned resource ${name}`);
  }
}

/** Refuse a same-name resource with unknown ownership. In particular, legacy
 * global caches are never adopted or relabelled; only their retirement
 * removes them. */
export async function ensureBuildkitVolume(
  name: string,
  organizationId: string,
): Promise<void> {
  const args = ['volume', 'inspect', '--format', '{{json .Labels}}', name];
  let labels = await inspect(args);
  if (labels === null) {
    const created = await runDocker([
      'volume',
      'create',
      '--label',
      'tale.buildkitd=1',
      '--label',
      `tale.org=${organizationId}`,
      name,
    ]);
    if (created.exitCode !== 0) {
      throw new Error(
        `buildkitd: cache volume creation failed: ${created.stderr.trim()}`,
      );
    }
    labels = await inspect(args);
  }
  assertOwner(
    labels === null ? null : JSON.parse(labels),
    organizationId,
    name,
  );
}

/** Remove one of an organization's cache volumes; a missing one is already
 * gone (false). A same-name volume the organization does not own is
 * refused, never removed. */
export async function removeBuildkitVolume(
  name: string,
  organizationId: string,
): Promise<boolean> {
  const labels = await inspect([
    'volume',
    'inspect',
    '--format',
    '{{json .Labels}}',
    name,
  ]);
  if (labels === null) return false;
  assertOwner(JSON.parse(labels), organizationId, name);
  const removed = await runDocker(['volume', 'rm', name], {
    timeoutMs: 30_000,
  });
  if (removed.exitCode === 0) return true;
  if (/no such volume/i.test(removed.stderr)) return false;
  throw new Error(
    `buildkitd: cannot remove volume ${name}: ${removed.stderr.trim()}`,
  );
}

/** Remove an organization's private network after detaching what is still
 * attached — the egress proxy joins every organization network, and nothing
 * else of another organization ever does. Ownership is checked first and the
 * network is removed by its inspected id. False when it was already gone. */
export async function removeBuildkitNetwork(
  name: string,
  organizationId: string,
): Promise<boolean> {
  const raw = await inspect([
    'network',
    'inspect',
    '--format',
    '{"id":{{json .Id}},"labels":{{json .Labels}},"containers":{{json .Containers}}}',
    name,
  ]);
  if (raw === null) return false;
  const data = parsedObject(raw);
  assertOwner(data.labels, organizationId, name);
  if (typeof data.id !== 'string' || !DOCKER_ID_RE.test(data.id)) {
    throw new Error(`buildkitd: invalid network identity for ${name}`);
  }
  const attached = data.containers === null ? {} : object(data.containers);
  for (const containerId of Object.keys(attached)) {
    if (!DOCKER_ID_RE.test(containerId)) {
      throw new Error(`buildkitd: invalid endpoint on network ${name}`);
    }
    const detached = await runDocker(
      ['network', 'disconnect', '--force', data.id, containerId],
      { timeoutMs: 30_000 },
    );
    if (
      detached.exitCode !== 0 &&
      !/is not connected|no such container|not found/i.test(detached.stderr)
    ) {
      throw new Error(
        `buildkitd: cannot detach ${containerId} from ${name}: ${detached.stderr.trim()}`,
      );
    }
  }
  const removed = await runDocker(['network', 'rm', data.id], {
    timeoutMs: 30_000,
  });
  if (removed.exitCode === 0) return true;
  if (/no such network|not found/i.test(removed.stderr)) return false;
  throw new Error(
    `buildkitd: cannot remove network ${name}: ${removed.stderr.trim()}`,
  );
}

/** The organizations owning any build helper, cache volume or private
 * network on this daemon. Legacy global resources carry no organization and
 * are not reported. THROWS when an inventory cannot be read. */
export async function listBuildkitOrganizations(): Promise<string[]> {
  const organizations = new Set<string>();
  for (const listing of [
    ['ps', '--all'],
    ['volume', 'ls'],
    ['network', 'ls'],
  ]) {
    const result = await readDockerMetadata([
      ...listing,
      '--filter',
      'label=tale.buildkitd=1',
      '--format',
      '{{.Label "tale.org"}}',
    ]);
    if (result.exitCode !== 0) {
      throw new Error(
        `buildkitd: cannot inventory organization resources: ${result.stderr.trim()}`,
      );
    }
    for (const line of result.stdout.split('\n')) {
      const organizationId = line.trim();
      if (ORG_ID_ALPHABET_RE.test(organizationId)) {
        organizations.add(organizationId);
      }
    }
  }
  return [...organizations];
}

/** A container's `State.FinishedAt` as a time, or undefined for one that
 * never stopped (Docker reports the zero time `0001-01-01T00:00:00Z`). */
function stoppedAtMs(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && ms > 0 ? ms : undefined;
}

/** A daemon/mirror may listen only on its own organization network, without
 * published ports. A name match alone is insufficient evidence of ownership. */
export async function inspectBuildkitContainer(
  name: string,
  organizationId: string,
  network: string,
  lane: DockerLane = 'priority',
): Promise<'running' | 'stopped' | null> {
  const helper = await inspectBuildkitHelper(
    name,
    organizationId,
    network,
    lane,
  );
  if (helper === null) return null;
  return helper.running ? 'running' : 'stopped';
}

/** A build helper as an inspect showed it. */
export interface BuildkitHelperObservation {
  /** Its immutable container id. */
  id: string;
  running: boolean;
  /** When it last started; changes with every start or restart. */
  startedAt: string;
  stamp: string | undefined;
  /** What a builder was launched with beyond its stamp (its
   * `tale.buildkitd-launch` label); absent on a mirror and on a builder from
   * before it. */
  launch: string | undefined;
  image: string | undefined;
  /** When it last stopped; undefined when it never has, or cannot tell. */
  finishedAtMs: number | undefined;
}

const HELPER_FORMAT =
  '{"id":{{json .Id}},"name":{{json .Name}},"labels":{{json .Config.Labels}},"networks":{{json .NetworkSettings.Networks}},"ports":{{json .HostConfig.PortBindings}},"running":{{json .State.Running}},"startedAt":{{json .State.StartedAt}},"image":{{json .Image}},"finishedAt":{{json .State.FinishedAt}}}';

/** Which pool of docker CLI slots an inspect takes: a create's must not wait
 * behind a burst of long calls (spawn-util's priority lane), while upkeep
 * that can wait a minute leaves those reserved slots to probes. */
export type DockerLane = 'priority' | 'shared';

/** Validate one helper's inspect data: owned by the organization, on its
 * private network alone and without published ports. */
function helperObservation(
  data: Record<string, unknown>,
  organizationId: string,
  network: string,
  name: string,
): BuildkitHelperObservation {
  assertOwner(data.labels, organizationId, name);
  const networks = Object.keys(object(data.networks));
  if (
    networks.length !== 1 ||
    networks[0] !== network ||
    (data.ports !== null &&
      data.ports !== undefined &&
      Object.keys(object(data.ports)).length !== 0)
  ) {
    throw new Error(`buildkitd: refusing non-private container ${name}`);
  }
  if (typeof data.running !== 'boolean') {
    throw new Error(`buildkitd: invalid container state for ${name}`);
  }
  const labels = object(data.labels);
  const stamp = labels['tale.helper-config'];
  const launch = labels['tale.buildkitd-launch'];
  return {
    id: typeof data.id === 'string' ? data.id : '',
    running: data.running,
    startedAt: typeof data.startedAt === 'string' ? data.startedAt : '',
    stamp: typeof stamp === 'string' ? stamp : undefined,
    launch: typeof launch === 'string' ? launch : undefined,
    image: typeof data.image === 'string' ? data.image : undefined,
    finishedAtMs: stoppedAtMs(data.finishedAt),
  };
}

/** {@link inspectBuildkitContainer}, with the stamp of how the helper was
 * launched (its `tale.helper-config` label; absent on one from before it),
 * the id of the image it runs and when it last started and stopped. */
export async function inspectBuildkitHelper(
  name: string,
  organizationId: string,
  network: string,
  lane: DockerLane = 'priority',
): Promise<BuildkitHelperObservation | null> {
  // A short call: a create must not lose its build cache to a burst of
  // creates holding every shared docker CLI slot.
  const raw = await inspect(['inspect', '--format', HELPER_FORMAT, name], {
    priority: lane === 'priority',
  });
  if (raw === null) return null;
  return helperObservation(parsedObject(raw), organizationId, network, name);
}

/** One helper's reading in {@link inspectBuildkitHelpers}: what it showed,
 * null when there is no such container, or why it was refused. */
export type BuildkitHelperReading =
  | { helper: BuildkitHelperObservation | null }
  | { refused: Error };

/** {@link inspectBuildkitHelper} for several helpers in ONE docker inspect.
 * A missing helper reads as null and a refused one carries its own error, so
 * one stranger under a mirror name does not fail the others. A Docker
 * failure other than missing objects throws. */
export async function inspectBuildkitHelpers(
  names: readonly string[],
  organizationId: string,
  network: string,
): Promise<Map<string, BuildkitHelperReading>> {
  const result = await readDockerMetadata(
    ['inspect', '--format', HELPER_FORMAT, ...names],
    { priority: true },
  );
  if (result.exitCode !== 0) {
    // `docker inspect` exits 1 when any name is missing and still prints the
    // others; anything else on stderr is a failure to observe.
    const unexplained = result.stderr
      .split('\n')
      .map((line) => line.trim())
      .filter(
        (line) => line !== '' && !/no such (?:object|container)/i.test(line),
      );
    if (unexplained.length > 0 || result.stderr.trim() === '') {
      throw new Error(
        `buildkitd: resource inspection failed: ${result.stderr.trim()}`,
      );
    }
  }
  const readings = new Map<string, BuildkitHelperReading>(
    names.map((name) => [name, { helper: null }]),
  );
  for (const line of result.stdout.split('\n').filter(Boolean)) {
    const data = parsedObject(line);
    const name =
      typeof data.name === 'string' ? data.name.replace(/^\//, '') : '';
    if (!readings.has(name)) {
      throw new Error('buildkitd: inspect answered for an unrequested helper');
    }
    try {
      readings.set(name, {
        helper: helperObservation(data, organizationId, network, name),
      });
    } catch (error) {
      readings.set(name, {
        refused: error instanceof Error ? error : new Error(String(error)),
      });
    }
  }
  return readings;
}

/** The egress proxy container as an inspect showed it: identity and
 * network fields only, never its environment. */
export interface EgressObservation {
  id: string;
  startedAt: string;
  /** Its endpoint on each network it is attached to. */
  networks: Record<string, { ipAddress: string; networkId: string }>;
}

const EGRESS_FORMAT =
  '{"id":{{json .Id}},"name":{{json .Name}},"running":{{json .State.Running}},"startedAt":{{json .State.StartedAt}},"networks":{{json .NetworkSettings.Networks}}}';

/** Is this inspected container the proxy `hostname` names on the egress
 * network? Compose service names are network aliases, not necessarily
 * container names, so aliases, DNS names, the address and the name count. */
function egressMatch(
  container: Record<string, unknown>,
  egressNetwork: string,
  hostname: string,
): EgressObservation | null {
  const networks = object(container.networks);
  const entry = networks[egressNetwork];
  if (!isObject(entry)) return null;
  const aliases = [entry.Aliases, entry.DNSNames].flatMap((value) =>
    Array.isArray(value) ? value : [],
  );
  if (
    entry.IPAddress !== hostname &&
    !aliases.includes(hostname) &&
    container.name !== `/${hostname}`
  ) {
    return null;
  }
  if (typeof container.id !== 'string' || !DOCKER_ID_RE.test(container.id)) {
    throw new Error('buildkitd: invalid egress container identity');
  }
  const endpoints: EgressObservation['networks'] = {};
  for (const [name, value] of Object.entries(networks)) {
    if (!isObject(value)) continue;
    endpoints[name] = {
      ipAddress: typeof value.IPAddress === 'string' ? value.IPAddress : '',
      networkId: typeof value.NetworkID === 'string' ? value.NetworkID : '',
    };
  }
  return {
    id: container.id,
    startedAt:
      typeof container.startedAt === 'string' ? container.startedAt : '',
    networks: endpoints,
  };
}

/** The egress container last identified, per Docker target, egress network
 * and proxy host. It is checked again with one inspect of that container
 * alone instead of an inspect of every session on the egress network; once
 * it no longer answers to the proxy's name (a stack restart recreated it),
 * the network is searched again. */
const knownEgress = new Map<string, string>();

/** Forget every remembered egress container (tests). */
export function forgetKnownEgress(): void {
  knownEgress.clear();
}

async function egressContainer(
  cfg: SpawnerConfig,
  hostname: string,
): Promise<EgressObservation> {
  const key = JSON.stringify([dockerTarget(), cfg.egressNetwork, hostname]);
  const known = knownEgress.get(key);
  if (known !== undefined) {
    const cached = await readDockerMetadata(
      ['inspect', '--format', EGRESS_FORMAT, known],
      { priority: true },
    );
    if (cached.exitCode === 0) {
      const container = parsedObject(cached.stdout.trim());
      const match =
        container.running === true
          ? egressMatch(container, cfg.egressNetwork, hostname)
          : null;
      if (match !== null && match.id === known) return match;
    } else if (!/no such (?:object|container)/i.test(cached.stderr)) {
      throw new Error(
        `buildkitd: cannot find egress container: ${cached.stderr.trim()}`,
      );
    }
    knownEgress.delete(key);
  }
  const network = await readDockerMetadata([
    'network',
    'inspect',
    '--format',
    '{{json .Containers}}',
    cfg.egressNetwork,
  ]);
  if (network.exitCode !== 0) {
    throw new Error(
      `buildkitd: cannot inspect egress network: ${network.stderr.trim()}`,
    );
  }
  const ids = Object.keys(parsedObject(network.stdout));
  if (ids.length === 0 || ids.some((id) => !DOCKER_ID_RE.test(id))) {
    throw new Error('buildkitd: egress network has no identifiable containers');
  }
  // Inspect only identity/network fields; never read container env.
  const containers = await readDockerMetadata([
    'inspect',
    '--format',
    EGRESS_FORMAT,
    ...ids,
  ]);
  if (containers.exitCode !== 0) {
    throw new Error(
      `buildkitd: cannot find egress container: ${containers.stderr.trim()}`,
    );
  }
  const matches: EgressObservation[] = [];
  for (const line of containers.stdout.trim().split('\n')) {
    const match = egressMatch(parsedObject(line), cfg.egressNetwork, hostname);
    if (match !== null) matches.push(match);
  }
  if (matches.length !== 1 || matches[0] === undefined) {
    throw new Error(
      'buildkitd: proxy must identify exactly one container on the egress network',
    );
  }
  knownEgress.set(key, matches[0].id);
  return matches[0];
}

/** Reads of the proxy's sandbox-network address under way, keyed as
 * {@link knownEgress}: concurrent session creates and the sweep share one
 * inspect. It runs outside any caller's budget, and each caller stops waiting
 * for it at its own deadline. */
const egressAddressReads = new Map<string, Promise<string>>();

/**
 * The address the egress proxy holds on the sandbox network now: the one a
 * session that boots now resolves the proxy's name to, and pins its
 * transparent egress to (the relay's target, its own DNS and its nested
 * containers' DNS) for the rest of its life. Null when the proxy URL names an
 * address instead of a name: a session pins that literal, so recreating the
 * session could not follow a move. One inspect of the remembered proxy
 * container; the network is searched again only once that container no
 * longer answers to the name. Throws when the proxy cannot be identified or
 * has no IPv4 address on the sandbox network.
 */
export async function egressProxyAddress(
  cfg: SpawnerConfig,
): Promise<string | null> {
  const hostname = new URL(cfg.egressProxy).hostname;
  if (hostname === '' || hostname.startsWith('[') || isIpv4Address(hostname))
    return null;
  const key = JSON.stringify([dockerTarget(), cfg.egressNetwork, hostname]);
  let read = egressAddressReads.get(key);
  if (read === undefined) {
    read = outsideOperationBudget(() => egressContainer(cfg, hostname))
      .then((egress) => {
        const address = egress.networks[cfg.egressNetwork]?.ipAddress;
        if (!isIpv4Address(address)) {
          throw new Error(
            'sandbox egress: the proxy has no IPv4 address on the sandbox network',
          );
        }
        return address;
      })
      .finally(() => {
        egressAddressReads.delete(key);
      });
    egressAddressReads.set(key, read);
  }
  return waitWithinOperation(read);
}

async function preventEgressForwarding(containerId: string): Promise<void> {
  // tinyproxy and dnsmasq serve local sockets: neither needs IP forwarding.
  // Apply the bootstrap invariant to already-running images before adding a
  // tenant bridge, otherwise this multi-homed container could route between
  // private networks. The bridges created below are IPv4-only.
  const rules = await readDockerMetadata([
    'exec',
    containerId,
    'iptables',
    '-S',
    'FORWARD',
  ]);
  if (rules.exitCode !== 0) {
    throw new Error('buildkitd: cannot verify egress forwarding firewall');
  }
  const first = rules.stdout.split('\n').find((line) => line.startsWith('-A '));
  if (first === '-A FORWARD -j DROP') return;
  const blocked = await runDocker([
    'exec',
    containerId,
    'iptables',
    '-I',
    'FORWARD',
    '1',
    '-j',
    'DROP',
  ]);
  if (blocked.exitCode !== 0) {
    throw new Error(
      'buildkitd: cannot block forwarding across organization networks',
    );
  }
}

function assertPrivateBuildSubnets(
  network: Record<string, unknown>,
  innerPool?: string,
): void {
  const subnets = dockerIpv4Subnets(object(network.IPAM).Config);
  if (subnets.length === 0)
    throw new Error('buildkitd: private network has no IPv4 subnet');
  const configured =
    innerPool === undefined
      ? undefined
      : ipv4Subnet(parseDindInnerPool(innerPool));
  for (const subnet of subnets) {
    assertBuildSubnet(subnet);
    if (configured && subnetsOverlap(subnet, configured))
      throw new Error(
        'buildkitd: private network overlaps the configured inner Docker pool',
      );
  }
}

async function occupiedDockerSubnets(): Promise<
  ReturnType<typeof dockerIpv4Subnets>
> {
  const listed = await readDockerMetadata([
    'network',
    'ls',
    '--no-trunc',
    '--format',
    '{{.ID}}',
  ]);
  if (listed.exitCode !== 0)
    throw new Error('buildkitd: cannot read Docker network inventory');
  const ids = listed.stdout.trim().split('\n').filter(Boolean);
  if (
    ids.some((id) => !DOCKER_ID_RE.test(id)) ||
    new Set(ids).size !== ids.length
  ) {
    throw new Error('buildkitd: invalid Docker network inventory');
  }
  const subnets: ReturnType<typeof dockerIpv4Subnets> = [];
  for (let offset = 0; offset < ids.length; offset += 64) {
    const batch = ids.slice(offset, offset + 64);
    const result = await readDockerMetadata([
      'network',
      'inspect',
      '--format',
      '{"id":{{json .Id}},"ranges":{{json .IPAM.Config}}}',
      ...batch,
    ]);
    if (result.exitCode !== 0)
      throw new Error('buildkitd: cannot inspect Docker network subnets');
    const unseen = new Set(batch);
    for (const line of result.stdout.trim().split('\n').filter(Boolean)) {
      const row = parsedObject(line);
      if (typeof row.id !== 'string' || !unseen.delete(row.id)) {
        throw new Error('buildkitd: invalid Docker network subnet inventory');
      }
      subnets.push(...dockerIpv4Subnets(row.ranges));
    }
    if (unseen.size > 0)
      throw new Error('buildkitd: incomplete Docker network subnet inventory');
  }
  return subnets;
}

async function daemonHostReservations(
  cfg: SpawnerConfig,
): Promise<ReturnType<typeof dockerIpv4Subnets>> {
  // This trusted, short-lived observer executes inside the DAEMON's host
  // network namespace, also for remote Docker. No mounts, capabilities or user
  // commands; Docker supplies the host-network container's resolver config.
  const name = `tale-buildkit-routes-${crypto.randomUUID()}`;
  const separator = '\n---tale-resolvers---\n';
  const result = await readDockerMetadata(
    [
      'run',
      '--rm',
      '--name',
      name,
      '--label',
      'tale.buildkit-probe=1',
      '--network',
      'host',
      '--read-only',
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges',
      '--user',
      '65534:65534',
      '--entrypoint',
      '/bin/sh',
      cfg.buildkitdImage,
      '-c',
      'ip -j -4 route show table all && printf "\\n---tale-resolvers---\\n" && cat /etc/resolv.conf',
    ],
    { timeoutMs: 120_000, killOnTimeoutContainer: name },
  );
  if (result.exitCode !== 0) {
    await runDocker(['rm', '--force', name], { timeoutMs: 15_000 });
    throw new Error(
      'buildkitd: cannot read daemon host routes and resolvers; using local builds',
    );
  }
  const parts = result.stdout.split(separator);
  if (parts.length !== 2 || parts[0] === undefined || parts[1] === undefined) {
    throw new Error(
      'buildkitd: incomplete daemon host route/resolver observation',
    );
  }
  return daemonReservedSubnets(JSON.parse(parts[0]), parts[1]);
}

// All org claims share Docker's default pools. One in-process allocator avoids
// unnecessary collisions between simultaneous organizations on this spawner.
let networkAllocation: Promise<void> = Promise.resolve();
function ensurePrivateBuildNetwork(
  cfg: SpawnerConfig,
  organizationId: string,
  name: string,
): Promise<Record<string, unknown>> {
  const pending = networkAllocation.then(() =>
    ensurePrivateBuildNetworkUnlocked(cfg, organizationId, name),
  );
  networkAllocation = pending.then(
    () => undefined,
    () => undefined,
  );
  return pending;
}

async function ensurePrivateBuildNetworkUnlocked(
  cfg: SpawnerConfig,
  organizationId: string,
  name: string,
): Promise<Record<string, unknown>> {
  const args = ['network', 'inspect', '--format', '{{json .}}', name];
  const attempted = new Set<string>();
  // A peer can win an allocation between inventory and create. Retry a bounded
  // number of claims; every successful claim is inspected again before use.
  for (let attempt = 0; attempt < 4; attempt++) {
    let raw = await inspect(args);
    let requested: string | undefined;
    if (raw === null) {
      const occupied = [
        ...(await occupiedDockerSubnets()),
        ...(await daemonHostReservations(cfg)),
        ...(cfg.dindInnerPool === undefined
          ? []
          : [ipv4Subnet(parseDindInnerPool(cfg.dindInnerPool))]),
      ];
      const info = await readDockerMetadata([
        'info',
        '--format',
        '{{json .DefaultAddressPools}}',
      ]);
      if (info.exitCode !== 0)
        throw new Error('buildkitd: cannot read Docker default address pools');
      requested = selectBuildSubnet(
        JSON.parse(info.stdout),
        occupied,
        attempted,
      );
      attempted.add(requested);
      const created = await runDocker([
        'network',
        'create',
        '--driver',
        'bridge',
        '--internal',
        '--ipv6=false',
        '--subnet',
        requested,
        '--label',
        'tale.buildkitd=1',
        '--label',
        `tale.org=${organizationId}`,
        name,
      ]);
      if (created.exitCode !== 0) {
        if (/already exists|pool overlaps/i.test(created.stderr)) continue;
        throw new Error(
          `buildkitd: private network creation failed: ${created.stderr.trim()}`,
        );
      }
      raw = await inspect(args);
    }
    const network = parsedObject(raw ?? 'null');
    assertOwner(network.Labels, organizationId, name);
    if (
      network.Driver !== 'bridge' ||
      network.Internal !== true ||
      network.EnableIPv6 !== false
    ) {
      throw new Error(`buildkitd: refusing non-private network ${name}`);
    }
    try {
      assertPrivateBuildSubnets(network, cfg.dindInnerPool);
      const subnets = dockerIpv4Subnets(object(network.IPAM).Config);
      if (
        requested !== undefined &&
        (subnets.length !== 1 || subnets[0]?.address !== requested)
      ) {
        throw new Error(
          'buildkitd: Docker did not allocate the requested private subnet',
        );
      }
      return network;
    } catch (error) {
      // Older spawners could leave an unused, owned bridge in 172.31/16 after
      // rejecting Docker's automatic allocation. Only remove an empty bridge
      // by its inspected ID; never disconnect endpoints or remove by a reused
      // name. Docker arbitrates a concurrent endpoint attachment as well.
      if (
        !isObject(network.Containers) ||
        Object.keys(network.Containers).length !== 0 ||
        typeof network.Id !== 'string' ||
        !DOCKER_ID_RE.test(network.Id)
      )
        throw error;
      const removed = await runDocker(['network', 'rm', network.Id]);
      if (removed.exitCode !== 0 && !/no such network/i.test(removed.stderr))
        throw error;
    }
  }
  throw new Error(
    'buildkitd: private network allocation could not converge; using local builds',
  );
}

/** An organization's private build network, ready for its helpers. */
export interface BuildkitNetworkReady {
  network: string;
  /** The proxy URL as the organization's helpers reach it. */
  proxy: string;
  /** What the sessions' attachment is checked against. */
  plan: BuildkitNetworkPlan;
  /** The egress proxy container, as inspected before any attachment. */
  egress: EgressObservation;
}

/** Create a private IPv4 bridge for one organization's build resources and
 * attach only its egress proxy. Sessions join it explicitly at creation. The
 * network's one inspect also answers whether the proxy is attached already
 * and what the sessions' plan is. */
export async function ensureBuildkitNetwork(
  cfg: SpawnerConfig,
  organizationId: string,
  name: string,
): Promise<BuildkitNetworkReady> {
  const network = await ensurePrivateBuildNetwork(cfg, organizationId, name);
  const plan = buildkitNetworkPlan(network, organizationId);

  const proxy = new URL(cfg.egressProxy);
  if (!['http:', 'https:'].includes(proxy.protocol)) {
    throw new Error('buildkitd: unsupported egress proxy protocol');
  }
  const egress = await egressContainer(cfg, proxy.hostname);
  await preventEgressForwarding(egress.id);
  const attached =
    isObject(network.Containers) &&
    Object.hasOwn(network.Containers, egress.id) &&
    egress.networks[name]?.networkId === plan.id;
  if (!attached) {
    const connected = await runDocker([
      'network',
      'connect',
      '--alias',
      EGRESS_ALIAS,
      name,
      egress.id,
    ]);
    if (connected.exitCode !== 0 && !/already exists/i.test(connected.stderr)) {
      throw new Error(
        `buildkitd: egress attachment failed: ${connected.stderr.trim()}`,
      );
    }
  }
  proxy.hostname = EGRESS_ALIAS;
  return { network: name, proxy: proxy.toString(), plan, egress };
}

/** How soon a legacy removal Docker refused is tried again. */
const LEGACY_REMOVAL_RETRY_MS = 60 * 60_000;

/** What one legacy retirement did. */
interface LegacyRetirement {
  stopped: number;
  deferred: boolean;
  /** Legacy containers and volumes removed. */
  removed?: number;
}

/** How a caller runs the legacy retirement. */
export interface LegacyRetirementOptions {
  /** Stop drained helpers, but leave their removal past the retention to the
   * upkeep sweep. A session create runs the retirement inside its
   * provisioning budget (5 s by default), which the removal of the old global
   * cache, a volume of tens of GB with 30 s for each `volume rm`, must not
   * share: cut short there, it would leave the volumes behind and the create
   * without its build cache. */
  stopOnly?: boolean;
}

/** One retirement pass: what it did, and what is left for later passes. */
interface LegacyPass extends LegacyRetirement {
  /** Nothing is inspected again before then (epoch ms). */
  pendingUntilMs?: number;
  /** Every helper has been stopped past the retention: only a pass that may
   * remove them has work. */
  removalDue?: boolean;
  /** The helpers are gone, but a legacy volume could not be removed. */
  volumesLeft?: boolean;
}

/** Stop legacy global helpers after every old runtime that could still use
 * them has gone. Pinned/warm/paused sessions defer retirement. Once they
 * have all been stopped longer than the cache retention, and still no
 * session may use them, a pass that may remove (not `stopOnly`) removes the
 * five helpers by the ids they were inspected under, then the four legacy
 * cache volumes, each only while it carries `tale.buildkitd=1` and no
 * `tale.org`. A volume that cannot go then is tried again an hour
 * later, although no helper is left to read a stop time from. Until the
 * retention could have passed, nothing is inspected again. */
export function createLegacyBuildkitRetirer(): (
  retentionMs?: number,
  options?: LegacyRetirementOptions,
) => Promise<LegacyRetirement> {
  let retired = false;
  let checkAgainAtMs = 0;
  // Only a pass that may remove has work: stop-only callers skip.
  let removalDue = false;
  // This process removed the helpers and some legacy volume is still there.
  let volumesLeft = false;
  let inFlight:
    | { work: Promise<LegacyRetirement>; stopOnly: boolean }
    | undefined;
  return (retentionMs = DEFAULT_CACHE_RETENTION_MS, options = {}) => {
    const stopOnly = options.stopOnly === true;
    const nothing = { stopped: 0, deferred: false };
    if (retired || Date.now() < checkAgainAtMs || (stopOnly && removalDue)) {
      return Promise.resolve(nothing);
    }
    if (inFlight !== undefined) {
      // A create never waits behind a removal pass: that pass stops whatever
      // still runs before it removes anything.
      return stopOnly && !inFlight.stopOnly
        ? Promise.resolve(nothing)
        : inFlight.work;
    }
    const work = retireLegacyBuildkitdUnlocked(retentionMs, {
      stopOnly,
      volumesLeft,
    })
      .then(
        ({
          pendingUntilMs,
          removalDue: due = false,
          volumesLeft: left = false,
          ...result
        }) => {
          volumesLeft = left;
          removalDue = due || left;
          retired =
            !result.deferred && pendingUntilMs === undefined && !removalDue;
          checkAgainAtMs = pendingUntilMs ?? 0;
          return result;
        },
      )
      .finally(() => {
        inFlight = undefined;
      });
    inFlight = { work, stopOnly };
    return work;
  };
}

const legacyRetirers = new Map<
  string,
  ReturnType<typeof createLegacyBuildkitRetirer>
>();

// Once retired, org ensures cannot recreate a global helper. Keep that proof
// scoped to the configured Docker endpoint, just like runDocker's target; a
// different daemon (including an isolated test CLI) needs its own observation.
// A process restart after deployment/rollback observes the daemon afresh.
export function retireLegacyBuildkitd(
  retentionMs?: number,
  options?: LegacyRetirementOptions,
): Promise<LegacyRetirement> {
  const target = dockerTarget();
  let retire = legacyRetirers.get(target);
  if (!retire) {
    retire = createLegacyBuildkitRetirer();
    legacyRetirers.set(target, retire);
  }
  return retire(retentionMs, options);
}

/** Does a session that may still run use the legacy global endpoint? */
async function legacyEndpointInUse(): Promise<boolean> {
  const sessions = await readDockerMetadata([
    'ps',
    '--all',
    '--filter',
    'label=tale.sandbox-session=1',
    '--format',
    '{{.ID}}\t{{.State}}',
  ]);
  if (sessions.exitCode !== 0) {
    throw new Error(
      'buildkitd: cannot establish whether legacy sessions have drained',
    );
  }
  const liveIds: string[] = [];
  for (const line of sessions.stdout.trim().split('\n').filter(Boolean)) {
    const [id, status] = line.split('\t');
    if (!id || !DOCKER_ID_RE.test(id) || !status) {
      throw new Error(
        'buildkitd: invalid session inventory during legacy retirement',
      );
    }
    if (status !== 'exited' && status !== 'dead') liveIds.push(id);
  }
  if (liveIds.length === 0) return false;
  // Emit only this non-secret endpoint, never the rest of container env.
  const endpoints = await readDockerMetadata([
    'inspect',
    '--format',
    '{{range .Config.Env}}{{if eq (index (split . "=") 0) "TALE_BUILDKITD_ENDPOINT"}}{{println .}}{{end}}{{end}}',
    ...liveIds,
  ]);
  if (endpoints.exitCode !== 0) {
    throw new Error('buildkitd: cannot inspect legacy session dependencies');
  }
  return endpoints.stdout
    .split('\n')
    .some(
      (line) =>
        line.trim() === `TALE_BUILDKITD_ENDPOINT=${LEGACY_BUILDKIT_ENDPOINT}`,
    );
}

/** Remove one legacy cache volume by its exact name, only while it carries
 * the legacy ownership: `tale.buildkitd=1` and no organization. `kept` when
 * it is gone or refused, `failed` when it could not be read or removed: a
 * later pass tries it again. */
async function removeLegacyVolume(
  name: string,
): Promise<'removed' | 'kept' | 'failed'> {
  try {
    const raw = await inspect([
      'volume',
      'inspect',
      '--format',
      '{{json .Labels}}',
      name,
    ]);
    if (raw === null) return 'kept';
    const labels: unknown = JSON.parse(raw);
    if (
      !isObject(labels) ||
      labels['tale.buildkitd'] !== '1' ||
      labels['tale.org'] !== undefined
    ) {
      console.warn(
        `[sandbox.buildkitd] leaving volume ${name}: it does not carry the legacy build-cache labels`,
      );
      return 'kept';
    }
    const removed = await runDocker(['volume', 'rm', name], {
      timeoutMs: 30_000,
    });
    if (removed.exitCode === 0) {
      console.log(
        `[sandbox.buildkitd] removed legacy build-cache volume ${name}`,
      );
      return 'removed';
    }
    if (/no such volume/i.test(removed.stderr)) return 'kept';
    throw new Error(removed.stderr.trim() || `exit ${removed.exitCode}`);
  } catch (error) {
    console.warn(
      `[sandbox.buildkitd] could not remove legacy build-cache volume ${name} (retried in an hour):`,
      error,
    );
    return 'failed';
  }
}

/** Remove the four legacy cache volumes, each on its own: one that cannot
 * go now leaves the others to go, and is left to a pass an hour later. */
async function removeLegacyVolumes(
  nowMs: number,
): Promise<Pick<LegacyPass, 'removed' | 'pendingUntilMs' | 'volumesLeft'>> {
  let removed = 0;
  let left = false;
  for (const volume of LEGACY_VOLUMES) {
    const outcome = await removeLegacyVolume(volume);
    if (outcome === 'removed') removed++;
    else if (outcome === 'failed') left = true;
  }
  return left
    ? {
        removed,
        volumesLeft: true,
        pendingUntilMs: nowMs + LEGACY_REMOVAL_RETRY_MS,
      }
    : { removed };
}

async function retireLegacyBuildkitdUnlocked(
  retentionMs: number,
  pass: { stopOnly: boolean; volumesLeft: boolean },
): Promise<LegacyPass> {
  const owned: Array<{
    name: string;
    id: string;
    running: boolean;
    finishedAtMs: number | undefined;
    createdAtMs: number | undefined;
  }> = [];
  let deferred = false;
  // Check the five known names before looking at any sessions. New deployments
  // never had these helpers, and drained ones never need an env scan again.
  for (const name of LEGACY_HELPERS) {
    const raw = await inspect([
      'inspect',
      '--format',
      '{"legacyId":{{json .Id}},"labels":{{json .Config.Labels}},"running":{{json .State.Running}},"finishedAt":{{json .State.FinishedAt}},"created":{{json .Created}}}',
      name,
    ]);
    if (raw === null) continue;
    const data = parsedObject(raw);
    if (
      !isObject(data.labels) ||
      data.labels['tale.buildkitd'] !== '1' ||
      data.labels['tale.org'] !== undefined
    ) {
      deferred = true;
      continue;
    }
    if (typeof data.running !== 'boolean')
      throw new Error(`buildkitd: invalid legacy container state for ${name}`);
    if (
      typeof data.legacyId !== 'string' ||
      !/^[a-f0-9]{64}$/.test(data.legacyId)
    ) {
      if (!data.running) continue;
      throw new Error(
        `buildkitd: invalid legacy container identity for ${name}`,
      );
    }
    owned.push({
      name,
      id: data.legacyId,
      running: data.running,
      finishedAtMs: stoppedAtMs(data.finishedAt),
      createdAtMs: stoppedAtMs(data.created),
    });
  }
  const running = owned.filter((helper) => helper.running);
  const nowMs = Date.now();
  if (running.length > 0) {
    if (await legacyEndpointInUse()) return { stopped: 0, deferred: true };
    let stopped = 0;
    for (const { name, id } of running) {
      // Session observation can outlive the inspected helper. Stop only that
      // immutable identity, never an unverified replacement using its old name.
      const result = await runDocker(['stop', '--time', '30', id], {
        timeoutMs: 35_000,
      });
      if (result.exitCode !== 0) {
        throw new Error(
          `buildkitd: failed to stop drained legacy helper ${name}`,
        );
      }
      stopped++;
    }
    return {
      stopped,
      deferred,
      ...(retentionMs > 0 ? { pendingUntilMs: nowMs + retentionMs } : {}),
    };
  }
  if (retentionMs <= 0) return { stopped: 0, deferred };
  if (owned.length === 0) {
    // The helpers this process removed are gone, so nothing can use the
    // volumes it could not remove; Docker refuses one in use regardless.
    if (!pass.volumesLeft) return { stopped: 0, deferred };
    if (pass.stopOnly) return { stopped: 0, deferred, volumesLeft: true };
    return { stopped: 0, deferred, ...(await removeLegacyVolumes(nowMs)) };
  }
  // The last of them to stop decides. One that never ran (Docker reports no
  // stop time for it) has been idle since its creation; one whose times
  // cannot be read counts as stopped now.
  const lastStopMs = Math.max(
    ...owned.map(
      (helper) => helper.finishedAtMs ?? helper.createdAtMs ?? nowMs,
    ),
  );
  if (nowMs - lastStopMs < retentionMs) {
    return { stopped: 0, deferred, pendingUntilMs: lastStopMs + retentionMs };
  }
  if (pass.stopOnly) return { stopped: 0, deferred, removalDue: true };
  if (await legacyEndpointInUse()) return { stopped: 0, deferred: true };
  let removed = 0;
  for (const { name, id } of owned) {
    // By the id inspected above: a same-name replacement is never removed,
    // and Docker refuses to remove one that is running again.
    const result = await runDocker(['rm', id], { timeoutMs: 35_000 });
    if (result.exitCode === 0) {
      removed++;
      console.log(
        `[sandbox.buildkitd] removed legacy build helper ${name} (${id.slice(0, 12)}), stopped longer than the build-cache retention`,
      );
    } else if (!/no such container/i.test(result.stderr)) {
      console.warn(
        `[sandbox.buildkitd] could not remove legacy build helper ${name} (retried in an hour): ${result.stderr.trim()}`,
      );
      return {
        stopped: 0,
        deferred,
        removed,
        pendingUntilMs: nowMs + LEGACY_REMOVAL_RETRY_MS,
      };
    }
  }
  const volumes = await removeLegacyVolumes(nowMs);
  return {
    stopped: 0,
    deferred,
    ...volumes,
    removed: removed + (volumes.removed ?? 0),
  };
}
