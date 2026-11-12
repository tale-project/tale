import type { z } from 'zod';

import type { DeploymentColor } from '../../../compose/types';
import type { SandboxRuntimeImage } from '../../../deployment/runtime-sandbox';
import type { ImageFacts } from '../../../oci/image-facts';
import type { incusDeclarationSchema } from '../../../project/runtime-declaration';
import { addressPlan, type AddressPlan, type SlotRole } from './address-plan';
import type { InterpolationPath } from './interpolate';
import {
  INFRASTRUCTURE_FORMATS,
  placementOf,
  PROFILE_LIMITS,
  type PlacementRow,
} from './placement';
import { RefusalError, refusal, refusalsError, type Refusal } from './refusals';
import {
  DNS_NAME,
  imageAlias,
  nicDevice,
  ociEntrypoint,
  PATCHED_INIT,
  signalNumber,
  sortKeys,
  SWITCHED_ROLES,
  taleLabels,
  translateService,
  type FileSpec,
  type InstanceSpec,
  type RuntimeVolume,
  type ServiceContext,
  type TranslatedService,
} from './translate';

/**
 * The Incus stack target: everything the stack is on Incus, compiled from the
 * compose documents Docker Compose would run (design D-07, D-08). The
 * compiler is pure; the planner (`plan/`) diffs this target against what the
 * server holds, and the applier converges it.
 *
 * Inputs, per path:
 * - workspace: the stateful document and one per live colour, from the
 *   generators' `build*Compose()`;
 * - managed: the bundle's `runtime/compose.yml`, parsed.
 */

export type IncusDeclaration = z.infer<typeof incusDeclarationSchema>;

export interface CompileInput {
  path: InterpolationPath;
  /** `user.tale.stack`: the workspace project id or the managed project. */
  stack: string;
  documents: readonly { compose: unknown; colour?: DeploymentColor }[];
  /** The interpolation source of the path (`interpolationSource`). */
  variables: Readonly<Record<string, string>>;
  /** The env files services read, by path: `.env` and its text. */
  envFiles: Readonly<Record<string, string>>;
  declaration: IncusDeclaration;
  /** Image facts by the image reference a compose service names. */
  images: Readonly<Record<string, ImageFacts>>;
  /** The sessions' image, which the spawner names by alias and source. */
  sandboxRuntime?: SandboxRuntimeImage;
  /** The declared egress proxy of the sessions (a managed deployment's
   * `sandbox.egressProxy`); absent, the stack's own egress. */
  egressProxy?: string;
  /** The server's architecture, as an image platform names it. */
  architecture: string;
  /** Replicas per colour role; a managed deployment runs one of each. */
  replicas?: Readonly<Record<SlotRole, number>>;
}

export interface StackImage {
  alias: string;
  /** `registry/repository@sha256:…`: what Incus pulls. */
  reference: string;
  digest: string;
  services: string[];
}

export interface StackVolume {
  name: string;
  /** `data` is snapshotted and restored; `runtime` is rendered again by the
   * CLI and never snapshotted (design D-28a). */
  kind: 'data' | 'runtime';
  pool: string;
  size?: string;
  config: Record<string, string>;
}

export interface StackTarget {
  schemaVersion: 1;
  path: InterpolationPath;
  stack: string;
  project: string;
  pool: string;
  network: { name: string; subnet: string; gateway: string; block: string };
  images: StackImage[];
  volumes: StackVolume[];
  files: FileSpec[];
  instances: InstanceSpec[];
  /** The two resolver views: name → addresses. */
  names: {
    stack: Record<string, string[]>;
    sessions: Record<string, string[]>;
  };
  /** Every slot of each switched role, in every colour the block holds
   * (r3: R3-02). Written once, when the switch is made. */
  switch: Record<keyof typeof SWITCHED_ROLES, string[]>;
  ingress: {
    mode: 'routed' | 'proxy-device';
    listen?: string;
    proxy: string;
    ports: { host: number; container: number }[];
  };
  /** Compose keys dropped under a rule, per service. */
  ignored: { service: string; key: string; reason: string }[];
  /** Services the target leaves out, with the reason. */
  omitted: { service: string; reason: string }[];
}

export type CompileResult =
  | { target: StackTarget; refusals: [] }
  | { target: null; refusals: Refusal[] };

/** Names of the resolvers' session view, and who answers each. */
const SESSION_NAMES = {
  'backend-api': 'switch',
  'backend-relay': 'switch',
  'sandbox-llm-gateway': 'sandbox-llm-gateway',
  'llm-gateway': 'sandbox-llm-gateway',
} as const;
/** The name the gateway answers to, replacing `host-gateway` (D-20). */
const HOST_GATEWAY_NAME = 'host.docker.internal';
/** `localhost` stays the instance's own: /etc/hosts answers it first. */
const RESERVED_NAMES = new Set(['localhost']);

function servicesOf(compose: unknown): Record<string, Record<string, unknown>> {
  const services = (compose as { services?: unknown } | null)?.services;
  if (services === null || typeof services !== 'object') return {};
  return services as Record<string, Record<string, unknown>>;
}

/** Compile the stack. Returns every refusal, never only the first. */
export function compileStackTarget(input: CompileInput): CompileResult {
  const { declaration } = input;
  const replicas =
    input.path === 'managed'
      ? { platform: 1, 'backend-api': 1, 'backend-worker': 1 }
      : (input.replicas ?? {
          platform: 1,
          'backend-api': 1,
          'backend-worker': 1,
        });
  let plan: AddressPlan;
  try {
    plan = addressPlan(declaration.network, input.path, replicas);
  } catch (error) {
    if (error instanceof RefusalError)
      return { target: null, refusals: [error.refusal] };
    throw error;
  }
  const context: ServiceContext = {
    path: input.path,
    stack: input.stack,
    plan,
    pool: declaration.pool,
    bridge: declaration.network.name,
    architecture: input.architecture,
    variables: input.variables,
    envFiles: input.envFiles,
    images: input.images,
    replicas,
    sandboxRuntime: input.sandboxRuntime,
    egressProxy: input.egressProxy,
    endpoint:
      declaration.endpoint ?? `https://${declaration.network.gateway}:8443`,
    ingress: declaration.ingress,
  };

  const refusals: Refusal[] = [];
  const translated: TranslatedService[] = [];
  const declaredServices = new Set<string>();
  for (const document of input.documents)
    for (const name of Object.keys(servicesOf(document.compose)))
      declaredServices.add(name);
  for (const document of input.documents) {
    const colour =
      input.path === 'workspace' ? (document.colour ?? null) : null;
    for (const [name, service] of Object.entries(
      servicesOf(document.compose),
    )) {
      const placed = placementOf(name);
      if (
        input.path === 'workspace' &&
        placed !== undefined &&
        'slot' in placed.address &&
        colour === null
      ) {
        refusals.push(
          refusal(
            'placement',
            `A workspace runs ${name} only in a colour document.`,
            name,
          ),
        );
        continue;
      }
      const result = translateService(name, service, colour, context);
      refusals.push(...result.refusals);
      if (result.result) translated.push(result.result);
    }
  }

  const present = new Set(
    translated.filter((item) => !item.omitted).map((item) => item.service),
  );
  const instances = translated.flatMap((item) => item.instances);
  for (const instance of instances)
    for (const dependency of instance.dependsOn)
      if (!declaredServices.has(dependency.service))
        refusals.push(
          refusal(
            'depends-on',
            `${dependency.service} is no service of the stack.`,
            instance.service,
            'depends_on',
          ),
        );
  const cycle = dependencyCycle(instances);
  if (cycle)
    refusals.push(
      refusal(
        'depends-on',
        `The services ${cycle.join(' -> ')} wait on each other.`,
        cycle[0] ?? null,
        'depends_on',
      ),
    );

  // The runtime's own instances, from the release's proxy and egress images.
  const proxy = translated.find((item) => item.service === 'proxy')?.image;
  const egress = translated.find(
    (item) => item.service === 'sandbox-egress',
  )?.image;
  const infrastructure: InstanceSpec[] = [];
  if (egress) {
    for (const name of ['names', 'names-sessions'] as const) {
      const unread = unreadFormat(name, egress.facts);
      if (unread) refusals.push(unread);
      else infrastructure.push(resolverInstance(name, egress.facts, context));
    }
  }
  if (proxy) {
    const unread = unreadFormat('switch', proxy.facts);
    const switchInstance = unread ?? switchInstanceOf(proxy.facts, context);
    if ('id' in switchInstance) refusals.push(switchInstance);
    else infrastructure.push(switchInstance);
  }

  // Names: the stack view and the session view.
  const stackNames: Record<string, Set<string>> = {};
  const addName = (name: string, address: string): void => {
    (stackNames[name] ??= new Set()).add(address);
  };
  addName(HOST_GATEWAY_NAME, plan.gateway);
  for (const role of Object.keys(SWITCHED_ROLES))
    addName(role, plan.singleton('switch'));
  for (const item of translated)
    for (const [name, addresses] of Object.entries(item.names)) {
      if (RESERVED_NAMES.has(name)) continue;
      if (!DNS_NAME.test(name)) {
        refusals.push(
          refusal(
            'network',
            `"${name}" is no DNS name the resolver can answer.`,
            item.service,
            'networks',
          ),
        );
        continue;
      }
      for (const address of addresses) addName(name, address);
    }
  const sessionNames: Record<string, string[]> = {};
  for (const [name, holder] of Object.entries(SESSION_NAMES))
    if (holder === 'switch' || present.has(holder))
      sessionNames[name] = [
        plan.singleton(holder === 'switch' ? 'switch' : 'sandbox-llm-gateway'),
      ];

  if (refusals.length > 0) return { target: null, refusals };

  // Images, volumes and files.
  const images = new Map<string, StackImage>();
  for (const item of translated) {
    if (!item.image) continue;
    const prior = images.get(item.image.alias);
    if (prior) prior.services.push(item.service);
    else
      images.set(item.image.alias, {
        alias: item.image.alias,
        reference: item.image.facts.reference,
        digest: item.image.facts.digest,
        services: [item.service],
      });
  }
  for (const instance of infrastructure) {
    const image = images.get(instance.image);
    if (image && !image.services.includes(instance.service))
      image.services.push(instance.service);
  }
  for (const image of images.values()) image.services.sort();
  const volumeDeclaration = declaration.volumes ?? {};
  const volume = (name: string, kind: StackVolume['kind']): StackVolume => ({
    name,
    kind,
    pool: declaration.pool,
    ...(volumeDeclaration[name]?.size === undefined
      ? {}
      : { size: volumeDeclaration[name]?.size }),
    config: sortKeys(volumeDeclaration[name]?.config ?? {}),
  });
  const dataVolumes = [
    ...new Set(translated.flatMap((item) => item.dataVolumes)),
  ].sort();
  const runtimeVolumes = new Set<RuntimeVolume>(
    translated.flatMap((item) => item.runtimeVolumes),
  );
  if (egress) runtimeVolumes.add('names-config');
  if (proxy) runtimeVolumes.add('switch-config');
  const files = translated
    .flatMap((item) => item.files)
    .filter(
      (file, index, all) =>
        all.findIndex(
          (other) => other.volume === file.volume && other.path === file.path,
        ) === index,
    );

  const target: StackTarget = {
    schemaVersion: 1,
    path: input.path,
    stack: input.stack,
    project: declaration.project,
    pool: declaration.pool,
    network: {
      name: declaration.network.name,
      subnet: declaration.network.subnet,
      gateway: declaration.network.gateway,
      block: declaration.network.block,
    },
    images: [...images.values()].sort((left, right) =>
      left.alias.localeCompare(right.alias),
    ),
    volumes: [
      ...dataVolumes.map((name) => volume(name, 'data')),
      ...[...runtimeVolumes].sort().map((name) => volume(name, 'runtime')),
    ],
    files,
    instances: [...infrastructure, ...instances].sort((left, right) =>
      left.name.localeCompare(right.name),
    ),
    names: {
      stack: sortKeys(
        Object.fromEntries(
          Object.entries(stackNames).map(([name, addresses]) => [
            name,
            [...addresses].sort(compareAddresses),
          ]),
        ),
      ),
      sessions: sortKeys(sessionNames),
    },
    switch: {
      platform: plan
        .slots('platform')
        .map((address) => `${address}:${SWITCHED_ROLES.platform}`),
      'backend-api': plan
        .slots('backend-api')
        .map((address) => `${address}:${SWITCHED_ROLES['backend-api']}`),
    },
    ingress: {
      mode: declaration.ingress.mode,
      ...(declaration.ingress.listen === undefined
        ? {}
        : { listen: declaration.ingress.listen }),
      proxy: plan.singleton('proxy'),
      ports: translated.flatMap((item) => item.ingressPorts),
    },
    ignored: translated.flatMap((item) =>
      item.ignored.map((entry) => ({ service: item.service, ...entry })),
    ),
    omitted: translated.flatMap((item) =>
      item.omitted ? [{ service: item.service, reason: item.omitted }] : [],
    ),
  };
  return { target, refusals: [] };
}

function compareAddresses(left: string, right: string): number {
  const value = (address: string): number =>
    address.split('.').reduce((total, octet) => total * 256 + Number(octet), 0);
  return value(left) - value(right);
}

/** A cycle of `depends_on` among the services, or null. */
function dependencyCycle(instances: readonly InstanceSpec[]): string[] | null {
  const edges = new Map<string, Set<string>>();
  for (const instance of instances) {
    const set = edges.get(instance.service) ?? new Set<string>();
    for (const dependency of instance.dependsOn) set.add(dependency.service);
    edges.set(instance.service, set);
  }
  const state = new Map<string, 'visiting' | 'done'>();
  const trail: string[] = [];
  const visit = (service: string): string[] | null => {
    if (state.get(service) === 'done') return null;
    if (state.get(service) === 'visiting')
      return [...trail.slice(trail.indexOf(service)), service];
    state.set(service, 'visiting');
    trail.push(service);
    for (const next of edges.get(service) ?? []) {
      const found = visit(next);
      if (found) return found;
    }
    trail.pop();
    state.set(service, 'done');
    return null;
  };
  for (const service of [...edges.keys()].sort()) {
    const found = visit(service);
    if (found) return found;
  }
  return null;
}

function limitsOf(row: PlacementRow): Record<string, string> {
  return {
    'limits.memory': row.limits?.memory ?? PROFILE_LIMITS.memory,
    'limits.processes': String(
      row.limits?.processes ?? PROFILE_LIMITS.processes,
    ),
  };
}

/**
 * A stack resolver (design D-16, 5.4): dnsmasq from the release's egress
 * image, its configuration and records on the read-only `names-config`
 * volume, one directory per view. The resolvers themselves ask the bridge
 * gateway (r3: R3-09).
 */
function resolverInstance(
  name: 'names' | 'names-sessions',
  facts: ImageFacts,
  context: ServiceContext,
): InstanceSpec {
  const row = placementOf(name) as PlacementRow;
  const view = name === 'names' ? 'stack' : 'sessions';
  const address = context.plan.singleton(name);
  const signal = 15;
  const graceSeconds = 5;
  const entrypoint = ociEntrypoint(
    [
      'dnsmasq',
      '--keep-in-foreground',
      '--no-hosts',
      `--hostsdir=/names/${view}/hosts`,
      `--conf-file=/names/${view}/dnsmasq.conf`,
    ],
    signal,
    facts.init === PATCHED_INIT,
  );
  return {
    name,
    service: name,
    index: null,
    colour: null,
    image: imageAlias(facts),
    address,
    config: sortKeys({
      ...limitsOf(row),
      'oci.entrypoint': entrypoint ?? '',
      'oci.dns.nameservers': context.plan.gateway,
      'boot.autorestart': 'true',
      'boot.autostart.priority': String(row.start),
      'boot.stop.priority': String(row.stop),
      'security.idmap.isolated': 'true',
      'security.guestapi': 'false',
      ...taleLabels({
        stack: context.stack,
        service: name,
        role: name,
        index: null,
        colour: null,
        facts,
        graceSeconds,
        signal,
      }),
      ...infraFormats(facts),
    }),
    devices: {
      'names-config': {
        type: 'disk',
        pool: context.pool,
        source: 'names-config',
        path: '/names',
        readonly: 'true',
      },
      eth0: nicDevice(context, address),
    },
    healthcheck: {
      test: [
        'CMD',
        'nslookup',
        '-type=a',
        name === 'names' ? HOST_GATEWAY_NAME : 'backend-api',
        '127.0.0.1',
      ],
      intervalMs: 10_000,
      timeoutMs: 3_000,
      retries: 3,
      startPeriodMs: 5_000,
    },
    stop: { signal, graceSeconds },
    dependsOn: [],
  };
}

/**
 * The traffic switch (design D-17, 5.3): the release's proxy image in its
 * `switch` role, its upstream lists on the read-only `switch-config` volume.
 */
function switchInstanceOf(
  facts: ImageFacts,
  context: ServiceContext,
): InstanceSpec | Refusal {
  const row = placementOf('switch') as PlacementRow;
  const address = context.plan.singleton('switch');
  const signal = signalNumber(facts.stopSignal ?? 'SIGTERM') ?? 15;
  const graceSeconds = 30;
  const entrypoint = ociEntrypoint(
    [...(facts.entrypoint ?? []), ...(facts.cmd ?? [])],
    signal,
    facts.init === PATCHED_INIT,
  );
  if (entrypoint === null)
    return refusal(
      'entrypoint-words',
      `The command of ${facts.reference} cannot be quoted.`,
      'switch',
    );
  return {
    name: 'switch',
    service: 'switch',
    index: null,
    colour: null,
    image: imageAlias(facts),
    address,
    config: sortKeys({
      ...limitsOf(row),
      'oci.entrypoint': entrypoint,
      'oci.dns.nameservers': context.plan.singleton('names'),
      'boot.autorestart': 'true',
      'boot.autostart.priority': String(row.start),
      'boot.stop.priority': String(row.stop),
      'security.idmap.isolated': 'true',
      'security.guestapi': 'false',
      'environment.TALE_PROXY_ROLE': 'switch',
      ...taleLabels({
        stack: context.stack,
        service: 'switch',
        role: 'switch',
        index: null,
        colour: null,
        facts,
        graceSeconds,
        signal,
      }),
      ...infraFormats(facts),
    }),
    devices: {
      'switch-config': {
        type: 'disk',
        pool: context.pool,
        source: 'switch-config',
        path: '/switch',
        readonly: 'true',
      },
      eth0: nicDevice(context, address),
    },
    healthcheck: {
      test: [
        'CMD',
        'wget',
        '--no-verbose',
        '--tries=1',
        '--spider',
        'http://127.0.0.1:2020/health',
      ],
      intervalMs: 30_000,
      timeoutMs: 10_000,
      retries: 3,
      startPeriodMs: 10_000,
    },
    stop: { signal, graceSeconds },
    dependsOn: [],
  };
}

/** A refusal when the image of an infrastructure instance does not name the
 * file format the CLI writes for it (design R3-23): release/0.6's proxy
 * image, nginx or Traefik, fails closed here instead of routing by an
 * upstream file it never reads. */
function unreadFormat(
  name: 'names' | 'names-sessions' | 'switch',
  facts: ImageFacts,
): Refusal | null {
  const format = INFRASTRUCTURE_FORMATS[name] ?? '';
  const formats = (facts.labels['dev.tale.infra-formats'] ?? '')
    .split(/[\s,]+/)
    .filter((item) => item !== '');
  if (formats.includes(format)) return null;
  return refusal(
    'infra-format',
    `${facts.reference} does not name ${format} in dev.tale.infra-formats${formats.length === 0 ? '' : ` (it names ${formats.join(', ')})`}, so it cannot run the ${name} instance.`,
    name,
  );
}

/** The file formats the infrastructure image reads (design D-17, R-02). */
function infraFormats(facts: ImageFacts): Record<string, string> {
  const formats = facts.labels['dev.tale.infra-formats'];
  return formats === undefined ? {} : { 'user.tale.infra-formats': formats };
}

/** The target of a compile, or one error naming every refusal. */
export function requireStackTarget(result: CompileResult): StackTarget {
  if (result.target === null) throw refusalsError(result.refusals);
  return result.target;
}
