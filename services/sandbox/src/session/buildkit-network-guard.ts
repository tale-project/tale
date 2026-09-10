import {
  assertBuildSubnet,
  dockerIpv4Subnets,
} from '../buildkit-network-pool.ts';
import { readDockerMetadata } from '../buildkit-resources.ts';
import { buildkitdNetworkName } from '../buildkitd.ts';
import { runDocker } from '../spawn-util.ts';
import type { SpawnerConfig } from '../types.ts';

const FORWARD_GUARD =
  /^-A FORWARD -i eth\+ -m conntrack ! --ctstate (?:ESTABLISHED,RELATED|RELATED,ESTABLISHED) -j DROP$/;

// Reading conf/all is not proof of per-interface state. Defaults cover future
// Docker network attachments; every current interface must also be disabled.
const IPV6_DISABLED = `
set -e
[ -d /proc/sys/net/ipv6 ] || exit 0
for setting in /proc/sys/net/ipv6/conf/default/disable_ipv6 /proc/sys/net/ipv6/conf/*/disable_ipv6; do
  [ "$(cat "$setting" 2>/dev/null)" = "1" ] || exit 1
done
`;

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('buildkitd: invalid session network metadata');
  }
  return Object.fromEntries(Object.entries(value));
}

async function inspectSessionNetworks(
  containerName: string,
  organizationId: string,
  expected: string[],
): Promise<void> {
  const result = await readDockerMetadata([
    'inspect',
    '--format',
    '{"labels":{{json .Config.Labels}},"networks":{{json .NetworkSettings.Networks}},"running":{{json .State.Running}}}',
    containerName,
  ]);
  if (result.exitCode !== 0) {
    throw new Error(
      'buildkitd: cannot inspect session before network attachment',
    );
  }
  const session = object(JSON.parse(result.stdout));
  const labels = object(session.labels);
  const networks = Object.keys(object(session.networks));
  if (
    labels['tale.sandbox-session'] !== '1' ||
    labels['tale.org'] !== organizationId ||
    session.running !== true ||
    networks.length !== expected.length ||
    !expected.every((name) => networks.includes(name))
  ) {
    throw new Error(
      'buildkitd: refusing foreign or unexpected session networks',
    );
  }
}

export interface BuildkitNetworkPlan {
  id: string;
  subnets: string[];
}

export async function readBuildkitNetworkPlan(
  organizationId: string,
): Promise<BuildkitNetworkPlan> {
  const networkName = buildkitdNetworkName(organizationId);
  const result = await readDockerMetadata([
    'network',
    'inspect',
    '--format',
    '{{json .}}',
    networkName,
  ]);
  if (result.exitCode !== 0) {
    throw new Error('buildkitd: cannot inspect session build network');
  }
  const network = object(JSON.parse(result.stdout));
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

async function guardFamily(
  containerName: string,
  family: 'iptables' | 'ip6tables',
  install: boolean,
): Promise<void> {
  // Runtime PATH omits /usr/sbin and runnerd runs as an unprivileged uid.
  // Inspect real kernel rules as root; an image label or stale file is no proof.
  const exec = ['exec', '--user', '0:0', containerName];
  const command = `/usr/sbin/${family}`;
  const list = [...exec, command, '-w', '5', '-S', 'FORWARD'];
  let rules = await readDockerMetadata(list);
  if (rules.exitCode !== 0 && family === 'ip6tables') {
    const disabled = await readDockerMetadata([
      ...exec,
      '/bin/sh',
      '-c',
      IPV6_DISABLED,
    ]);
    if (disabled.exitCode === 0) return;
    throw new Error(
      'buildkitd: session IPv6 is enabled without a forwarding guard',
    );
  }
  if (rules.exitCode !== 0) {
    throw new Error('buildkitd: cannot inspect session forwarding guard');
  }
  const guarded = (stdout: string) =>
    FORWARD_GUARD.test(
      stdout.split('\n').find((line) => line.startsWith('-A ')) ?? '',
    );
  if (guarded(rules.stdout)) return;
  if (install) {
    const blocked = await runDocker(
      [
        ...exec,
        command,
        '-w',
        '5',
        '-I',
        'FORWARD',
        '1',
        '-i',
        'eth+',
        '-m',
        'conntrack',
        '!',
        '--ctstate',
        'ESTABLISHED,RELATED',
        '-j',
        'DROP',
      ],
      { timeoutMs: 15_000 },
    );
    if (blocked.exitCode !== 0) {
      throw new Error('buildkitd: cannot install session forwarding guard');
    }
    rules = await readDockerMetadata(list);
    if (rules.exitCode === 0 && guarded(rules.stdout)) return;
  }
  throw new Error('buildkitd: session forwarding guard is not the first rule');
}

/** Call only after runnerd readiness, when the inner dockerd has finished
 * installing its chains. Boot stays on the control network until both address
 * families are protected; old runtime images receive the same actual guard. */
export async function attachBuildkitNetwork(
  cfg: Pick<SpawnerConfig, 'egressNetwork'>,
  containerName: string,
  organizationId: string,
  planned: BuildkitNetworkPlan,
): Promise<void> {
  const network = buildkitdNetworkName(organizationId);
  await inspectSessionNetworks(containerName, organizationId, [
    cfg.egressNetwork,
  ]);
  const observed = await readBuildkitNetworkPlan(organizationId);
  if (
    observed.id !== planned.id ||
    JSON.stringify(observed.subnets) !== JSON.stringify(planned.subnets)
  ) {
    throw new Error(
      'buildkitd: private network changed during session startup',
    );
  }
  await guardFamily(containerName, 'iptables', true);
  await guardFamily(containerName, 'ip6tables', true);
  const connected = await runDocker(
    ['network', 'connect', planned.id, containerName],
    { timeoutMs: 15_000 },
  );
  if (connected.exitCode !== 0) {
    throw new Error(
      'buildkitd: cannot attach session to its private build network',
    );
  }
  // A new interface must inherit the IPv6 default, and connecting must not
  // displace the first firewall rule. Any failure is fatal to session creation;
  // the backend tears down its container while preserving a resumed workspace.
  await guardFamily(containerName, 'iptables', false);
  await guardFamily(containerName, 'ip6tables', false);
  await inspectSessionNetworks(containerName, organizationId, [
    cfg.egressNetwork,
    network,
  ]);
}
