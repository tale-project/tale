import {
  buildkitNetworkPlan,
  readDockerMetadata,
  type BuildkitNetworkPlan,
} from '../buildkit-resources.ts';
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

export type { BuildkitNetworkPlan };

/** The organization network as it is now, checked as the plan is. */
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
  return buildkitNetworkPlan(object(JSON.parse(result.stdout)), organizationId);
}

/** The FORWARD rules of both address families and whether IPv6 is off
 * everywhere, read in ONE root exec: every exec is a CLI process and a round
 * trip on the session create's path, and the guard is read before and after
 * the attachment. Each family's listing is preceded by a line with its exit
 * status, so a listing that failed is told apart from an empty one. */
const FORWARD_RULES = `
for family in iptables ip6tables; do
  if rules=$(/usr/sbin/$family -w 5 -S FORWARD 2>/dev/null); then
    printf '#tale-forward %s 0\\n%s\\n' "$family" "$rules"
  else
    printf '#tale-forward %s 1\\n' "$family"
  fi
done
if (${IPV6_DISABLED}); then
  printf '#tale-forward ipv6-disabled 0\\n'
else
  printf '#tale-forward ipv6-disabled 1\\n'
fi
`;

interface ForwardRules {
  /** A family's FORWARD listing; null when it could not be read. */
  iptables: string | null;
  ip6tables: string | null;
  ipv6Disabled: boolean;
}

/** Parse {@link FORWARD_RULES} output. Missing sections are refused rather
 * than read as an empty listing. */
export function parseForwardRules(stdout: string): ForwardRules {
  const listings = new Map<string, string[] | null>();
  let ipv6Disabled: boolean | undefined;
  let current: string[] | null = null;
  for (const line of stdout.split('\n')) {
    const marker =
      /^#tale-forward (iptables|ip6tables|ipv6-disabled) ([01])$/.exec(line);
    if (marker === null) {
      current?.push(line);
      continue;
    }
    const [, name, status] = marker;
    if (name === 'ipv6-disabled') {
      ipv6Disabled = status === '0';
      current = null;
    } else if (name !== undefined) {
      current = status === '0' ? [] : null;
      listings.set(name, current);
    }
  }
  if (
    !listings.has('iptables') ||
    !listings.has('ip6tables') ||
    ipv6Disabled === undefined
  ) {
    throw new Error('buildkitd: incomplete session forwarding guard listing');
  }
  const listing = (family: string) => listings.get(family)?.join('\n') ?? null;
  return {
    iptables: listing('iptables'),
    ip6tables: listing('ip6tables'),
    ipv6Disabled,
  };
}

function guarded(listing: string): boolean {
  return FORWARD_GUARD.test(
    listing.split('\n').find((line) => line.startsWith('-A ')) ?? '',
  );
}

async function readForwardRules(containerName: string): Promise<ForwardRules> {
  // Runtime PATH omits /usr/sbin and runnerd runs as an unprivileged uid.
  // Inspect real kernel rules as root; an image label or stale file is no proof.
  const rules = await readDockerMetadata([
    'exec',
    '--user',
    '0:0',
    containerName,
    '/bin/sh',
    '-c',
    FORWARD_RULES,
  ]);
  if (rules.exitCode !== 0) {
    throw new Error('buildkitd: cannot inspect session forwarding guard');
  }
  return parseForwardRules(rules.stdout);
}

/** The families whose first FORWARD rule is not the guard. IPv4 must be
 * readable; IPv6 without netfilter is acceptable only while it is disabled
 * on every interface and for future ones. */
function unguardedFamilies(
  rules: ForwardRules,
): Array<'iptables' | 'ip6tables'> {
  if (rules.iptables === null) {
    throw new Error('buildkitd: cannot inspect session forwarding guard');
  }
  if (rules.ip6tables === null && !rules.ipv6Disabled) {
    throw new Error(
      'buildkitd: session IPv6 is enabled without a forwarding guard',
    );
  }
  const families: Array<'iptables' | 'ip6tables'> = [];
  if (!guarded(rules.iptables)) families.push('iptables');
  if (rules.ip6tables !== null && !guarded(rules.ip6tables))
    families.push('ip6tables');
  return families;
}

async function verifyForwardGuards(
  containerName: string,
  install: boolean,
): Promise<void> {
  const missing = unguardedFamilies(await readForwardRules(containerName));
  if (missing.length === 0) return;
  if (install) {
    for (const family of missing) {
      const blocked = await runDocker(
        [
          'exec',
          '--user',
          '0:0',
          containerName,
          `/usr/sbin/${family}`,
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
    }
    if (unguardedFamilies(await readForwardRules(containerName)).length === 0)
      return;
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
  const [, observed] = await Promise.all([
    inspectSessionNetworks(containerName, organizationId, [cfg.egressNetwork]),
    readBuildkitNetworkPlan(organizationId),
  ]);
  if (
    observed.id !== planned.id ||
    JSON.stringify(observed.subnets) !== JSON.stringify(planned.subnets)
  ) {
    throw new Error(
      'buildkitd: private network changed during session startup',
    );
  }
  await verifyForwardGuards(containerName, true);
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
  // Both checks only read, so they run together; the firewall's verdict is
  // reported first.
  const [firewall, membership] = await Promise.allSettled([
    verifyForwardGuards(containerName, false),
    inspectSessionNetworks(containerName, organizationId, [
      cfg.egressNetwork,
      network,
    ]),
  ]);
  if (firewall.status === 'rejected') throw firewall.reason;
  if (membership.status === 'rejected') throw membership.reason;
}
