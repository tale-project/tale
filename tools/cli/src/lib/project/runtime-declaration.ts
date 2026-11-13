import { z } from 'zod';

import { CliError, preconditionError } from '../../utils/fail';
import { isUnicastIpv4 } from '../deployment/runtime-sandbox';
import { RUNTIME_ENGINES, type RuntimeEngine } from '../runtime/types';

/**
 * The container runtime a deployment declares: `tale.json`'s `runtime` for a
 * workspace, and `runtime.engine`/`runtime.incus` of a managed deployment
 * specification. One schema serves both, so the two places cannot drift: a
 * workspace and a managed deployment name the runtime with the same fields
 * and the same rules. The runtime is a reviewed declaration, never a
 * per-command flag: a deploy on the wrong runtime would build a second stack
 * beside the first.
 */

/** The variable that can only guard the declared engine, never select one. */
const RUNTIME_GUARD_VARIABLE = 'TALE_RUNTIME';

/** An Incus project, storage pool or volume name: lowercase, at most 63. */
const incusName = z
  .string()
  .regex(
    /^[a-z0-9][a-z0-9-]{0,62}$/,
    'Use 1 to 63 lowercase letters, digits and hyphens, starting with a letter or digit.',
  );
/** A bridge is a network interface on the host, so its name is at most 15. */
const bridgeName = z
  .string()
  .regex(
    /^[a-z0-9][a-z0-9-]{0,14}$/,
    'Use 1 to 15 lowercase letters, digits and hyphens, starting with a letter or digit.',
  );
const ipv4 = z
  .string()
  .refine(isUnicastIpv4, 'Must be a unicast IPv4 address in dotted form.');
const cidr = z
  .cidrv4('Must be an IPv4 network in CIDR form, such as 10.30.0.0/24.')
  .refine(
    (value) => parseCidr(value).canonical,
    'Must name the network address itself: the bits after the prefix are zero.',
  );
/** An Incus size, as the API takes it: `10GiB`, `512MiB`. */
const size = z
  .string()
  .regex(
    /^[1-9][0-9]{0,6}(KiB|MiB|GiB|TiB|kB|MB|GB|TB)$/,
    'Must be a size such as 10GiB or 512MiB.',
  );
/** The Incus API endpoint: `https://<host>:<port>`, nothing else. */
const endpoint = z
  .string()
  .max(256)
  .refine((value) => {
    if (!URL.canParse(value)) return false;
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      url.origin === value &&
      !url.username &&
      !url.password
    );
  }, 'Must be the Incus API as https://<host>:<port>, without a path.');
/** A registry host exactly as the remote URL carries it (Incus matches
 * `restricted.images.servers` against it character for character). */
const registryHost = z
  .string()
  .max(253)
  .regex(
    /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:[1-9][0-9]{0,4})?$/,
    'Must be a registry host, with an optional port, such as mirror.gcr.io:443.',
  );
/** Only snapshot and ZFS settings of a volume are the declaration's to set;
 * everything else about a volume belongs to the CLI. */
const volumeConfigKey = z
  .string()
  .regex(
    /^(snapshots|zfs)\.[a-z0-9][a-z0-9._-]{0,62}$/,
    'Only snapshots.* and zfs.* volume settings may be declared.',
  );
const port = z.number().int().min(1).max(65535);

export const INGRESS_MODES = ['routed', 'proxy-device'] as const;
export type IngressMode = (typeof INGRESS_MODES)[number];

/** Where the stack runs on an Incus server, and how it is reached. */
const incusFields = z.strictObject({
  /** The Incus API the spawner and the CLI dial; absent, the bridge gateway
   * on port 8443. */
  endpoint: endpoint.optional(),
  /** The restricted project the stack's instances live in. */
  project: incusName,
  /** The storage pool its volumes and root disks come from. */
  pool: incusName,
  /** The managed bridge the stack's instances sit on. The CLI makes no
   * network: the operator prepares it on the host. */
  network: z.strictObject({
    name: bridgeName,
    subnet: cidr,
    gateway: ipv4,
    /** The addresses the CLI assigns: a /24 (a workspace, with two colours)
     * or a /25 (a managed deployment), inside `subnet`. */
    block: cidr,
  }),
  /** The sandbox zone's network, which sessions reach the stack from. */
  sessions: z.strictObject({ subnet: cidr }),
  /** How the public reaches the stack's proxy: `routed` (the operator's
   * forward reaches `proxy:80`) or `proxy-device` (Incus publishes 80 and
   * 443 on the host, on `listen` or every address). */
  ingress: z.strictObject({
    mode: z.enum(INGRESS_MODES),
    listen: ipv4.optional(),
  }),
  /** The registry host that stands in for docker.io. */
  registryMirror: registryHost.optional(),
  /** The root disk size of every instance (the profile's default). */
  rootSize: size.optional(),
  /** Per data volume: its size and its snapshots.* / zfs.* settings. */
  volumes: z
    .record(
      incusName,
      z.strictObject({
        size: size.optional(),
        config: z
          .record(volumeConfigKey, z.string().min(1).max(256))
          .optional(),
      }),
    )
    .refine((volumes) => Object.keys(volumes).length <= 32, {
      message: 'At most 32 volumes may be declared.',
    })
    .optional(),
  /** Destinations outside the stack its instances must reach, passed through
   * to the node contract's ACL (an inference router, an external S3). */
  operatorReach: z
    .array(
      z.strictObject({
        destination: z.union([ipv4, cidr]),
        protocol: z.enum(['tcp', 'udp']),
        ports: z.array(port).min(1).max(16),
      }),
    )
    .max(64)
    .optional(),
});

/** The Incus declaration and its address rules. */
export const incusDeclarationSchema = incusFields.superRefine(
  (incus, context) => {
    const subnet = parseCidr(incus.network.subnet);
    const block = parseCidr(incus.network.block);
    const sessions = parseCidr(incus.sessions.subnet);
    const gateway = parseAddress(incus.network.gateway);
    if (block.prefix !== 24 && block.prefix !== 25)
      context.addIssue({
        code: 'custom',
        message:
          'The address block is a /24 (a workspace) or a /25 (a managed deployment).',
        path: ['network', 'block'],
      });
    if (!contains(subnet, block))
      context.addIssue({
        code: 'custom',
        message: 'The address block lies inside the network subnet.',
        path: ['network', 'block'],
      });
    if (
      !inside(subnet, gateway) ||
      gateway === subnet.first ||
      gateway === subnet.last
    )
      context.addIssue({
        code: 'custom',
        message: 'The gateway is a host address of the network subnet.',
        path: ['network', 'gateway'],
      });
    // The plan assigns every address of the block from offset .2 on; the
    // gateway may only hold offset .1 or lie outside the block.
    if (inside(block, gateway) && gateway !== block.first + 1)
      context.addIssue({
        code: 'custom',
        message:
          'The gateway is the first host address of the block, or lies outside the block.',
        path: ['network', 'gateway'],
      });
    if (overlaps(sessions, subnet))
      context.addIssue({
        code: 'custom',
        message:
          'The sessions subnet is a network of its own, apart from the stack subnet.',
        path: ['sessions', 'subnet'],
      });
    if (
      incus.ingress.listen !== undefined &&
      incus.ingress.mode !== 'proxy-device'
    )
      context.addIssue({
        code: 'custom',
        message: 'Only the proxy-device ingress listens on a host address.',
        path: ['ingress', 'listen'],
      });
  },
);

const engineSchema = z.enum(RUNTIME_ENGINES);

/**
 * The engine and the Incus block go together: `incus` needs the block, and a
 * block beside any other engine would be read by nothing.
 */
export function checkEngineDeclaration(
  runtime: { engine?: RuntimeEngine; incus?: unknown },
  context: z.RefinementCtx,
  path: PropertyKey[] = [],
): void {
  if (runtime.engine === 'incus' && runtime.incus === undefined)
    context.addIssue({
      code: 'custom',
      message: 'runtime.engine "incus" needs the runtime.incus block.',
      path: [...path, 'incus'],
    });
  if (runtime.engine !== 'incus' && runtime.incus !== undefined)
    context.addIssue({
      code: 'custom',
      message: 'runtime.incus is read only with runtime.engine "incus".',
      path: [...path, 'incus'],
    });
}

/** `tale.json`'s `runtime`. Absent, the workspace runs on Docker. */
export const runtimeDeclarationSchema = z
  .strictObject({
    engine: engineSchema.optional(),
    incus: incusDeclarationSchema.optional(),
  })
  .superRefine((runtime, context) => {
    checkEngineDeclaration(runtime, context);
    // A workspace flips between two colours, which the /25 cannot hold.
    if (runtime.incus && parseCidr(runtime.incus.network.block).prefix !== 24)
      context.addIssue({
        code: 'custom',
        message:
          'A workspace needs a /24 address block: it holds two colours during a deploy.',
        path: ['incus', 'network', 'block'],
      });
  });
export type RuntimeDeclaration = z.infer<typeof runtimeDeclarationSchema>;

/** The managed specification's `runtime.engine` and `runtime.incus`. */
export const managedRuntimeFields = {
  engine: engineSchema.optional(),
  incus: incusDeclarationSchema.optional(),
};

/** Each issue as `<path>: <message>`, the path rooted at `root`. */
export function describeIssues(error: z.ZodError, root: string): string[] {
  return error.issues.map((issue) => {
    const path = [root, ...issue.path.map(String)].join('.');
    return `${path}: ${issue.message}`;
  });
}

/**
 * Read `tale.json`'s `runtime`. A declaration this CLI cannot read is refused
 * rather than read as Docker.
 */
export function parseRuntimeDeclaration(
  value: unknown,
  projectDir: string,
): RuntimeDeclaration | undefined {
  if (value === undefined) return undefined;
  const parsed = runtimeDeclarationSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw preconditionError(
    `tale.json in ${projectDir} declares a runtime this CLI cannot read: ${describeIssues(parsed.error, 'runtime').join('; ')}`,
    `Set runtime.engine to one of: ${RUNTIME_ENGINES.join(', ')}, and correct the fields named above.`,
  );
}

/** The engine a declaration names: absent, Docker Compose. */
export function engineOf(runtime: { engine?: RuntimeEngine }): RuntimeEngine {
  return runtime.engine ?? 'docker';
}

/**
 * `TALE_RUNTIME` only guards: set, it must name the engine the declaration
 * names, or the command stops before it touches a runtime.
 */
export function guardDeclaredEngine(
  declared: RuntimeEngine,
  environment: NodeJS.ProcessEnv = process.env,
): void {
  const guard = environment[RUNTIME_GUARD_VARIABLE];
  if (guard === undefined || guard === '') return;
  if (!engineSchema.safeParse(guard).success)
    throw preconditionError(
      `${RUNTIME_GUARD_VARIABLE}=${JSON.stringify(guard)} names a runtime engine this CLI does not know.`,
      `Set ${RUNTIME_GUARD_VARIABLE} to one of: ${RUNTIME_ENGINES.join(', ')}, or unset it.`,
    );
  if (guard !== declared)
    throw preconditionError(
      `${RUNTIME_GUARD_VARIABLE} expects the ${guard} runtime, but the deployment declares ${declared}.`,
      `${RUNTIME_GUARD_VARIABLE} guards the declared runtime and never selects one: change runtime.engine in the declaration, or unset ${RUNTIME_GUARD_VARIABLE}.`,
    );
}

/**
 * The refusal of a declared Incus runtime while this CLI cannot run it: the
 * workspace path. A managed deployment runs on Incus
 * (`deployment/runtime-incus-apply.ts`).
 */
export function incusNotAvailableYet(path: 'workspace'): CliError {
  return preconditionError(
    `The deployment declares runtime.engine "incus": running a ${path} on Incus is not available yet in this CLI.`,
    'Remove runtime.engine and runtime.incus from tale.json to deploy on Docker.',
  );
}

/** An IPv4 network as numbers: its first and last address and its prefix. */
interface Cidr {
  first: number;
  last: number;
  prefix: number;
  canonical: boolean;
}

function parseAddress(value: string): number {
  return value
    .split('.')
    .reduce((total, octet) => total * 256 + Number(octet), 0);
}

export function parseCidr(value: string): Cidr {
  const [address = '', bits = ''] = value.split('/');
  const prefix = Number(bits);
  const start = parseAddress(address);
  const span = 2 ** (32 - prefix);
  const first = Math.floor(start / span) * span;
  return { first, last: first + span - 1, prefix, canonical: first === start };
}

function inside(network: Cidr, address: number): boolean {
  return address >= network.first && address <= network.last;
}

function contains(outer: Cidr, inner: Cidr): boolean {
  return inner.first >= outer.first && inner.last <= outer.last;
}

function overlaps(left: Cidr, right: Cidr): boolean {
  return left.first <= right.last && right.first <= left.last;
}
