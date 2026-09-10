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

let legacyRetirementInFlight:
  | Promise<{ stopped: number; deferred: boolean }>
  | undefined;

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

async function readDockerMetadata(args: string[]): Promise<RunDockerResult> {
  const result = await runDocker(args, {
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
  const ranges = object(network.IPAM).Config;
  if (!Array.isArray(ranges) || ranges.length === 0) {
    throw new Error('buildkitd: private network has no IPv4 subnet');
  }
  for (const range of ranges) {
    const subnet = object(range).Subnet;
    if (typeof subnet !== 'string') {
      throw new Error('buildkitd: invalid private network subnet');
    }
    const [ip = '', prefixText = ''] = subnet.split('/');
    const bytes = ip.split('.').map(Number);
    const prefix = Number(prefixText);
    if (
      bytes.length !== 4 ||
      bytes.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255) ||
      prefixText === '' ||
      !Number.isInteger(prefix) ||
      prefix < 0 ||
      prefix > 32
    ) {
      throw new Error('buildkitd: invalid private network IPv4 range');
    }
    const [firstByte = -1, secondByte = -1] = bytes;
    const isPrivate =
      (firstByte === 10 && prefix >= 8) ||
      (firstByte === 172 &&
        secondByte >= 16 &&
        secondByte <= 31 &&
        prefix >= 12) ||
      (firstByte === 192 && secondByte === 168 && prefix >= 16);
    // Both tinyproxy's client ACL and the egress OUTPUT destination fence
    // cover RFC1918. A broader/public subnet would either fail proxy access
    // or let the proxy reach another organization's builder as a public host.
    if (!isPrivate) {
      throw new Error(
        'buildkitd: private network must use an RFC1918 IPv4 subnet; using local builds',
      );
    }
    // The runtime reserves 172.31.0.0/16 for inner docker0/Compose bridges.
    // Docker's host allocator does not know about these nested networks.
    const address = bytes.reduce((total, byte) => total * 256 + byte, 0);
    const mask = prefix === 0 ? 0 : 0xffffffff << (32 - Math.min(prefix, 16));
    if ((address & mask) === (0xac1f0000 & mask)) {
      throw new Error(
        'buildkitd: private network overlaps the inner Docker 172.31.0.0/16 pool; using local builds',
      );
    }
  }
}

/** Create a private IPv4 bridge for one organization's build resources and
 * attach only its egress proxy. Sessions join it explicitly at creation. */
export async function ensureBuildkitNetwork(
  cfg: SpawnerConfig,
  organizationId: string,
  name: string,
): Promise<{ network: string; proxy: string }> {
  const args = ['network', 'inspect', '--format', '{{json .}}', name];
  let raw = await inspect(args);
  if (raw === null) {
    const created = await runDocker([
      'network',
      'create',
      '--driver',
      'bridge',
      '--internal',
      '--ipv6=false',
      '--label',
      'tale.buildkitd=1',
      '--label',
      `tale.org=${organizationId}`,
      name,
    ]);
    if (created.exitCode !== 0 && !/already exists/i.test(created.stderr)) {
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
  assertPrivateBuildSubnets(network);

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
export function retireLegacyBuildkitd(): Promise<{
  stopped: number;
  deferred: boolean;
}> {
  legacyRetirementInFlight ??= retireLegacyBuildkitdUnlocked().finally(() => {
    legacyRetirementInFlight = undefined;
  });
  return legacyRetirementInFlight;
}

async function retireLegacyBuildkitdUnlocked(): Promise<{
  stopped: number;
  deferred: boolean;
}> {
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
  let deferred = false;
  for (const name of LEGACY_HELPERS) {
    const raw = await inspect([
      'inspect',
      '--format',
      '{"labels":{{json .Config.Labels}},"running":{{json .State.Running}}}',
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
    if (data.running === false) continue;
    if (data.running !== true) {
      throw new Error(`buildkitd: invalid legacy container state for ${name}`);
    }
    const result = await runDocker(['stop', '--time', '30', name], {
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
