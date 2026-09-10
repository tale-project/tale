import {
  assertBuildSubnet,
  daemonReservedSubnets,
  dockerIpv4Subnets,
  selectBuildSubnet,
} from './buildkit-network-pool.ts';
import { runDocker } from './spawn-util.ts';
import type { RunDockerResult } from './spawn-util.ts';
import type { SpawnerConfig } from './types.ts';

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

async function inspect(args: string[]): Promise<string | null> {
  const result = await readDockerMetadata(args);
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
 * global caches are never adopted, relabelled, or removed during rollout. */
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

/** A daemon/mirror may listen only on its own organization network, without
 * published ports. A name match alone is insufficient evidence of ownership. */
export async function inspectBuildkitContainer(
  name: string,
  organizationId: string,
  network: string,
): Promise<'running' | 'stopped' | null> {
  const raw = await inspect([
    'inspect',
    '--format',
    '{"labels":{{json .Config.Labels}},"networks":{{json .NetworkSettings.Networks}},"ports":{{json .HostConfig.PortBindings}},"running":{{json .State.Running}}}',
    name,
  ]);
  if (raw === null) return null;
  const data = parsedObject(raw);
  assertOwner(data.labels, organizationId, name);
  const networks = Object.keys(object(data.networks));
  if (
    networks.length !== 1 ||
    networks[0] !== network ||
    (data.ports !== null && Object.keys(object(data.ports)).length !== 0)
  ) {
    throw new Error(`buildkitd: refusing non-private container ${name}`);
  }
  if (typeof data.running !== 'boolean') {
    throw new Error(`buildkitd: invalid container state for ${name}`);
  }
  return data.running ? 'running' : 'stopped';
}

async function egressContainer(
  cfg: SpawnerConfig,
  hostname: string,
): Promise<string> {
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
  // Compose service names are network aliases, not necessarily container
  // names. Inspect only identity/network fields; never read container env.
  const containers = await readDockerMetadata([
    'inspect',
    '--format',
    '{"id":{{json .Id}},"name":{{json .Name}},"networks":{{json .NetworkSettings.Networks}}}',
    ...ids,
  ]);
  if (containers.exitCode !== 0) {
    throw new Error(
      `buildkitd: cannot find egress container: ${containers.stderr.trim()}`,
    );
  }
  const matches: string[] = [];
  for (const line of containers.stdout.trim().split('\n')) {
    const container = parsedObject(line);
    const entry = object(object(container.networks)[cfg.egressNetwork]);
    const aliases = [entry.Aliases, entry.DNSNames].flatMap((value) =>
      Array.isArray(value) ? value : [],
    );
    if (
      entry.IPAddress === hostname ||
      aliases.includes(hostname) ||
      container.name === `/${hostname}`
    ) {
      if (
        typeof container.id !== 'string' ||
        !DOCKER_ID_RE.test(container.id)
      ) {
        throw new Error('buildkitd: invalid egress container identity');
      }
      matches.push(container.id);
    }
  }
  if (matches.length !== 1 || matches[0] === undefined) {
    throw new Error(
      'buildkitd: proxy must identify exactly one container on the egress network',
    );
  }
  return matches[0];
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

function assertPrivateBuildSubnets(network: Record<string, unknown>): void {
  const subnets = dockerIpv4Subnets(object(network.IPAM).Config);
  if (subnets.length === 0)
    throw new Error('buildkitd: private network has no IPv4 subnet');
  for (const subnet of subnets) assertBuildSubnet(subnet);
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
): Promise<void> {
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
): Promise<void> {
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
      assertPrivateBuildSubnets(network);
      const subnets = dockerIpv4Subnets(object(network.IPAM).Config);
      if (
        requested !== undefined &&
        (subnets.length !== 1 || subnets[0]?.address !== requested)
      ) {
        throw new Error(
          'buildkitd: Docker did not allocate the requested private subnet',
        );
      }
      return;
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

/** Create a private IPv4 bridge for one organization's build resources and
 * attach only its egress proxy. Sessions join it explicitly at creation. */
export async function ensureBuildkitNetwork(
  cfg: SpawnerConfig,
  organizationId: string,
  name: string,
): Promise<{ network: string; proxy: string }> {
  await ensurePrivateBuildNetwork(cfg, organizationId, name);

  const proxy = new URL(cfg.egressProxy);
  if (!['http:', 'https:'].includes(proxy.protocol)) {
    throw new Error('buildkitd: unsupported egress proxy protocol');
  }
  const containerId = await egressContainer(cfg, proxy.hostname);
  await preventEgressForwarding(containerId);
  const connected = await runDocker([
    'network',
    'connect',
    '--alias',
    EGRESS_ALIAS,
    name,
    containerId,
  ]);
  if (connected.exitCode !== 0 && !/already exists/i.test(connected.stderr)) {
    throw new Error(
      `buildkitd: egress attachment failed: ${connected.stderr.trim()}`,
    );
  }
  proxy.hostname = EGRESS_ALIAS;
  return { network: name, proxy: proxy.toString() };
}

/** Stop legacy global helpers after every old runtime that could still use
 * them has gone. Pinned/warm/paused sessions defer retirement. Volumes and
 * builder configuration are preserved; no resource is removed or relabelled. */
export function createLegacyBuildkitRetirer(): () => Promise<{
  stopped: number;
  deferred: boolean;
}> {
  let retired = false;
  let inFlight: Promise<{ stopped: number; deferred: boolean }> | undefined;
  return () => {
    if (retired) return Promise.resolve({ stopped: 0, deferred: false });
    inFlight ??= retireLegacyBuildkitdUnlocked()
      .then((result) => {
        retired = !result.deferred;
        return result;
      })
      .finally(() => {
        inFlight = undefined;
      });
    return inFlight;
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
export function retireLegacyBuildkitd(): Promise<{
  stopped: number;
  deferred: boolean;
}> {
  const target = JSON.stringify([
    process.env.DOCKER_BIN,
    process.env.DOCKER_HOST,
    process.env.DOCKER_CONTEXT,
    process.env.DOCKER_CONFIG,
  ]);
  let retire = legacyRetirers.get(target);
  if (!retire) {
    retire = createLegacyBuildkitRetirer();
    legacyRetirers.set(target, retire);
  }
  return retire();
}

async function retireLegacyBuildkitdUnlocked(): Promise<{
  stopped: number;
  deferred: boolean;
}> {
  const running: Array<{ name: string; id: string }> = [];
  let deferred = false;
  // Check the five known names before looking at any sessions. New deployments
  // never had these helpers, and drained ones never need an env scan again.
  for (const name of LEGACY_HELPERS) {
    const raw = await inspect([
      'inspect',
      '--format',
      '{"legacyId":{{json .Id}},"labels":{{json .Config.Labels}},"running":{{json .State.Running}}}',
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
    if (data.running) {
      if (
        typeof data.legacyId !== 'string' ||
        !/^[a-f0-9]{64}$/.test(data.legacyId)
      ) {
        throw new Error(
          `buildkitd: invalid legacy container identity for ${name}`,
        );
      }
      running.push({ name, id: data.legacyId });
    }
  }
  if (running.length === 0) return { stopped: 0, deferred };

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
  if (liveIds.length > 0) {
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
    if (
      endpoints.stdout
        .split('\n')
        .some(
          (line) =>
            line.trim() ===
            `TALE_BUILDKITD_ENDPOINT=${LEGACY_BUILDKIT_ENDPOINT}`,
        )
    ) {
      return { stopped: 0, deferred: true };
    }
  }

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
  return { stopped, deferred };
}
