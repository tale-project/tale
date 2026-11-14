import { INFRASTRUCTURE_FORMATS } from '../compile/placement';
import type { StackTarget } from '../compile/stack-target';
import { DNS_NAME } from '../compile/translate';
import type { RenderedFile } from '../plan/plan';

/**
 * The stack's names (design D-16, D-18, D-20, 5.4): what the two CLI-owned
 * dnsmasq resolvers answer, rendered as the files they read from the
 * read-only `names-config` volume.
 *
 * - `names` (the stack view, `.2`) answers every name of the stack and
 *   forwards anything else to the bridge gateway.
 * - `names-sessions` (the session view, `.3`) answers only the names a
 *   session may reach, and nothing else (`no-resolv`, no server).
 *
 * Each view has a directory of its own: `<view>/dnsmasq.conf`, and the
 * records in `<view>/hosts/`, the resolver's `--hostsdir`. The compiler
 * makes the resolver instances themselves (`compile/stack-target.ts`):
 * the release's `tale-sandbox-egress` image, `/init` running dnsmasq, and
 * the gateway as their own nameserver (R3-09).
 *
 * Records are static for a plan: a colour's names list the replicas the
 * plan places, so a flip that keeps the colours keeps the records. When the
 * plan does change them, each view's one records file is written again in
 * place (`<view>/hosts/hosts`), and nothing recreates a resolver for it
 * (R-02). dnsmasq reads a file of its hosts directory again once its writer
 * closes it, dropping the file's old records and taking its new ones in one
 * step: on Incus 7.6 with dnsmasq 2.90, 40 changes under four query loops
 * lost none of 1,420,344 answers for a name every version held. A new file
 * per change (R3-15, R3-29) cannot do that with dnsmasq: a record two files
 * hold is kept once, under the file read first, so deleting the older file
 * drops it although the newer one holds it (36% of the same queries
 * answered NXDOMAIN), and truncating the older file first drops it as well.
 * A write that fails part-way fails the deploy, and the next one writes the
 * file again, since its digest differs from the plan's.
 *
 * Every name gets a `local=/<name>/` line, so dnsmasq answers a query for
 * it from its records alone: an AAAA query is answered empty (NOERROR, no
 * answer) instead of being forwarded, which a musl client needs to accept
 * the A answer. dnsmasq reads its configuration only when it starts, while
 * a records change adds names to a running resolver (a colour's names, on
 * every flip), so `local=//` covers every single-label name as well: a name
 * the records gain later answers AAAA empty at once, and a single-label
 * name the records do not hold is answered NXDOMAIN instead of being sent
 * on (measured: without it, the AAAA query for a colour name a flip added
 * was forwarded and timed out). `local-ttl=1` keeps a client cache from
 * holding a record past a change by more than a second.
 */

/** The volume both resolvers read, mounted read-only at `/names`. */
export const NAMES_VOLUME = 'names-config';

/** The view each resolver answers, and so its directory on the volume. */
export const RESOLVER_VIEWS = {
  names: 'stack',
  'names-sessions': 'sessions',
} as const;
export type ResolverView = (typeof RESOLVER_VIEWS)[keyof typeof RESOLVER_VIEWS];

/** The file each view's records are written to, in its hosts directory. */
export const HOSTS_FILE = 'hosts';

const IPV4 =
  /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/;
const FORMAT = INFRASTRUCTURE_FORMATS.names ?? '';

/** Every name of a view, checked: each line the resolver reads is built
 * from these, so a name that is no DNS name never reaches a file. */
function checkedNames(
  names: Readonly<Record<string, readonly string[]>>,
): [string, string[]][] {
  return Object.entries(names)
    .map(([name, addresses]): [string, string[]] => {
      if (!DNS_NAME.test(name))
        throw new Error(`"${name}" is no DNS name the resolver can answer.`);
      if (addresses.length === 0)
        throw new Error(`The resolver has no address for ${name}.`);
      for (const address of addresses)
        if (!IPV4.test(address))
          throw new Error(`${address} is no IPv4 address (the name ${name}).`);
      return [name, [...addresses]];
    })
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
}

/** One resolver's `dnsmasq.conf`. */
export function renderResolverConfig(
  view: ResolverView,
  names: Readonly<Record<string, readonly string[]>>,
  gateway: string,
): string {
  if (!IPV4.test(gateway))
    throw new Error(`${gateway} is no IPv4 address (the bridge gateway).`);
  const lines = [
    `# The ${view} view of the stack's names, written by the Tale CLI (${FORMAT}).`,
    `# Records: the files in hosts/. Change them through the CLI, never here.`,
    'local-ttl=1',
    // The stack view asks the bridge gateway for any other name; the session
    // view answers its own names and refuses the rest.
    view === 'stack' ? `server=${gateway}` : 'no-resolv',
    // Every single-label name, including those a records change adds while
    // the resolver runs, is answered from the records alone.
    'local=//',
    ...checkedNames(names).map(([name]) => `local=/${name}/`),
  ];
  return `${lines.join('\n')}\n`;
}

/** One view's records, as dnsmasq reads a hosts file: one line per address,
 * so a colour's name answers every slot of the colour. */
export function renderHostRecords(
  names: Readonly<Record<string, readonly string[]>>,
): string {
  const lines = [`# ${FORMAT}`];
  for (const [name, addresses] of checkedNames(names))
    for (const address of addresses) lines.push(`${address} ${name}`);
  return `${lines.join('\n')}\n`;
}

const text = (value: string) => new TextEncoder().encode(value);

/** The files of both resolvers for `target`: each view's configuration
 * and its records, both written in place. None when the target has no
 * resolvers. */
export function resolverFiles(target: StackTarget): RenderedFile[] {
  if (!target.volumes.some((volume) => volume.name === NAMES_VOLUME)) return [];
  const owner = { mode: 0o644, uid: 0, gid: 0 } as const;
  return Object.values(RESOLVER_VIEWS).flatMap((view): RenderedFile[] => [
    {
      volume: NAMES_VOLUME,
      path: `${view}/dnsmasq.conf`,
      ...owner,
      content: text(
        renderResolverConfig(view, target.names[view], target.network.gateway),
      ),
      write: 'overwrite',
    },
    {
      volume: NAMES_VOLUME,
      path: `${view}/hosts/${HOSTS_FILE}`,
      ...owner,
      content: text(renderHostRecords(target.names[view])),
      // In place, never by generation: see the header.
      write: 'overwrite',
    },
  ]);
}
