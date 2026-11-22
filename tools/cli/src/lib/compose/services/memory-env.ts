import { MEMORY_BUDGET_SHARES_MIB } from '@tale/shared/memory-budget';

import {
  type AppTier,
  type AppTierShape,
  THREE_WAY,
  tierReplicaCounts,
} from '../app-tier';
import type { ComposeService, RotatableService, ServiceConfig } from '../types';

const MIB = 1024 ** 2;

/**
 * A memory size from the environment, in whole MiB, or undefined when the
 * variable is unset or blank. Read from `process.env`, where `loadEnv` has
 * folded the project's `.env`. The shipped compose.yml hands the same
 * variables to compose as they are, so this takes only spellings compose takes
 * too: not the Kubernetes 4Gi that the spawner's own sizes (sizeEnv in
 * services/sandbox/src/config.ts) also read. A value below `minMib` fails the
 * compose generation, before any container is recreated.
 */
export function memorySizeEnvMib(
  name: string,
  minMib: number,
): number | undefined {
  const value = process.env[name]?.trim();
  if (value === undefined || value === '') return undefined;
  const m = /^(\d+)([kmg]?)b?$/i.exec(value);
  const unit = { '': 1, k: 1024, m: MIB, g: 1024 * MIB }[
    (m?.[2] ?? '').toLowerCase()
  ];
  const bytes = Number(m?.[1]) * (unit ?? 1);
  // NaN when it is no size; past 2^53 bytes the size would print in exponent
  // notation, which compose refuses.
  if (!Number.isSafeInteger(bytes)) {
    throw new Error(
      `Env var ${name} is not a size such as 4g or 4096m: ${JSON.stringify(value)}`,
    );
  }
  if (bytes < minMib * MIB) {
    throw new Error(
      `Env var ${name} must be at least ${minMib}m; got: ${JSON.stringify(value)}`,
    );
  }
  return Math.floor(bytes / MIB);
}

/**
 * The memory budget of one host (tale-project/tale#4942): 500 MB, 476.8 MiB,
 * for everything `tale deploy` starts there by default, the sandbox sessions
 * aside. It is shared out between the parts of the stack in MiB
 * (@tale/shared/memory-budget, the figures the memory benchmark reads against
 * too), and a service's share is also its memory reservation: the floor its
 * cgroup v2 `memory.low` protects from the reclaim that session memory
 * pressure causes, and part of what the spawner's admission leaves free
 * (reservedMemoryMib).
 *
 * These are the services outside the application tier, as measured:
 *
 * - db: Postgres on its small profile with statements unprepared, the
 *   deployment's defaults (create-db-service.ts, ONE_PROCESS_POOLS),
 *   peaked at 120 under the load tool's smoke run.
 * - object-store: versitygw, about 36 resident at rest.
 * - proxy: the Traefik edge, 20 to 23 at rest. Under load its heap grows,
 *   which GOMEMLIMIT holds near the share (goMemory).
 * - sandbox, sandbox-egress: the spawner and its egress proxy share 30.
 */
const STACK_RESERVATION_MIB = {
  db: MEMORY_BUDGET_SHARES_MIB.postgres,
  'object-store': MEMORY_BUDGET_SHARES_MIB['object-store'],
  proxy: MEMORY_BUDGET_SHARES_MIB.edge,
  // The CLI's own division of the share the two have together
  // (`spawner-egress`); memory-env.test.ts fails where the two no longer
  // add up to it.
  sandbox: 20,
  'sandbox-egress': 10,
} as const;

type StackReservedService = keyof typeof STACK_RESERVATION_MIB;

/** The services outside the application tier that every stack runs. */
const STACK_RESERVED_SERVICES = Object.keys(
  STACK_RESERVATION_MIB,
) as StackReservedService[];

/**
 * The application tier's share of the budget, the model relay inside it and
 * one file read at a time in its heavy slot included
 * (ONE_PROCESS_HEAVY_SLOT_MEMORY_MB): the one process of the whole
 * application peaked at 162 to 176 under the smoke run. The share is the same
 * in every shape: each divides it between the services it runs, and the one
 * that answers the API takes the largest part.
 */
export const APP_TIER_SHARE_MIB = MEMORY_BUDGET_SHARES_MIB['app-tier'];

/** Each shape's division of {@link APP_TIER_SHARE_MIB}, per replica. */
const APP_TIER_RESERVATION_MIB: Readonly<
  Record<AppTierShape, Readonly<Partial<Record<RotatableService, number>>>>
> = {
  unified: { platform: APP_TIER_SHARE_MIB },
  split: { platform: 192, 'backend-worker': 64 },
  'three-way': { platform: 64, 'backend-api': 128, 'backend-worker': 64 },
};

/** The variable that overrides each service's reservation. */
const MEMORY_RESERVATION_ENV = {
  db: 'DB_MEMORY_RESERVATION',
  platform: 'PLATFORM_MEMORY_RESERVATION',
  'backend-api': 'BACKEND_API_MEMORY_RESERVATION',
  'backend-worker': 'BACKEND_WORKER_MEMORY_RESERVATION',
  'object-store': 'OBJECT_STORE_MEMORY_RESERVATION',
  proxy: 'PROXY_MEMORY_RESERVATION',
  sandbox: 'SANDBOX_MEMORY_RESERVATION',
  'sandbox-egress': 'SANDBOX_EGRESS_MEMORY_RESERVATION',
} as const;

export type ReservedService = keyof typeof MEMORY_RESERVATION_ENV;

const RESERVED_SERVICES = Object.keys(
  MEMORY_RESERVATION_ENV,
) as ReservedService[];

function isStackReserved(
  service: ReservedService,
): service is StackReservedService {
  return Object.hasOwn(STACK_RESERVATION_MIB, service);
}

/**
 * A service's reservation when its variable is unset, in a colour of this
 * shape. A service of the application tier that the shape does not run (read
 * only to check its variable) has its figure from the shape of three
 * services, the one shape that runs every service of the tier.
 */
function defaultReservationMib(
  service: ReservedService,
  tier: AppTier,
): number {
  if (isStackReserved(service)) return STACK_RESERVATION_MIB[service];
  return (
    APP_TIER_RESERVATION_MIB[tier.shape][service] ??
    APP_TIER_RESERVATION_MIB['three-way'][service] ??
    0
  );
}

/**
 * Each backend role's hard memory limit, in GiB: the `mem_limit` of its
 * containers (create-backend-services.ts).
 */
export const BACKEND_MEMORY_LIMIT_GIB = 12;

/** The spawner's memory limit, in MiB: its container's `mem_limit`
 *  (create-sandbox-service.ts). */
export const SANDBOX_MEMORY_LIMIT_MIB = 1024;

/** The egress proxy's memory limit, in MiB: its container's `mem_limit`
 *  (create-sandbox-egress-service.ts). */
export const SANDBOX_EGRESS_MEMORY_LIMIT_MIB = 512;

/** A size in MiB as compose takes it: whole GiB as `g`, else `m`. */
export function composeSize(mib: number): string {
  return mib % 1024 === 0 ? `${mib / 1024}g` : `${mib}m`;
}

/**
 * The fixed memory limit a reserved service's generator emits, in MiB, or
 * undefined where it has none. `platform` has the backend's where it is a
 * backend process (the `api` and `all` roles, app-tier.ts), and none as the
 * web tier alone. The two Go services' limit follows their reservation
 * instead (goMemory), so it can never fall below it.
 */
function fixedMemoryLimitMib(
  service: ReservedService,
  tier: AppTier,
): number | undefined {
  switch (service) {
    case 'backend-api':
    case 'backend-worker':
      return BACKEND_MEMORY_LIMIT_GIB * 1024;
    case 'platform': {
      const role = tier.roles.platform;
      return role === 'api' || role === 'all'
        ? BACKEND_MEMORY_LIMIT_GIB * 1024
        : undefined;
    }
    case 'sandbox':
      return SANDBOX_MEMORY_LIMIT_MIB;
    case 'sandbox-egress':
      return SANDBOX_EGRESS_MEMORY_LIMIT_MIB;
    default:
      return undefined;
  }
}

/** The smallest reservation Docker creates a container with (moby's
 * linuxMinMemory, 6 MiB). */
const DOCKER_MIN_RESERVATION_MIB = 6;

/**
 * A service's memory reservation in whole MiB: its variable when set (`0`
 * reserves nothing), else its default for the colour's shape. A reservation
 * Docker would refuse at `compose up` (under 6 MiB, or above the service's
 * memory limit) fails the compose generation instead, before any container is
 * recreated.
 */
function memoryReservationMib(
  service: ReservedService,
  tier: AppTier = THREE_WAY,
): number {
  const name = MEMORY_RESERVATION_ENV[service];
  const mib = memorySizeEnvMib(name, 0) ?? defaultReservationMib(service, tier);
  const got = JSON.stringify(process.env[name]?.trim());
  if (mib > 0 && mib < DOCKER_MIN_RESERVATION_MIB) {
    throw new Error(
      `Env var ${name} must be 0 or at least ${DOCKER_MIN_RESERVATION_MIB}m; got: ${got}`,
    );
  }
  const limitMib = fixedMemoryLimitMib(service, tier);
  if (limitMib !== undefined && mib > limitMib) {
    throw new Error(
      `Env var ${name} must be at most ${limitMib}m, the memory limit of ${service}; got: ${got}`,
    );
  }
  return mib;
}

/**
 * The `mem_reservation` a service's generator spreads in: none when it
 * reserves nothing, and none unless the engine reports cgroup v2. There Docker
 * writes it to `memory.low`, which protects only where the engine's parent
 * cgroup grants it too (cgroup v2 bounds `memory.low` by every ancestor's), as
 * the self-hosting docs describe. On cgroup v1 Docker writes it to
 * `memory.soft_limit_in_bytes` instead, and global reclaim takes from a
 * service above its soft limit first: the opposite of the point. An engine
 * that reports no version gets none either. The size is checked on every
 * engine, so a value Docker would refuse fails everywhere alike.
 */
export function memoryReservation(
  service: ReservedService,
  config: Pick<ServiceConfig, 'cgroupVersion' | 'appTier'>,
): Pick<ComposeService, 'mem_reservation'> {
  const mib = memoryReservationMib(service, config.appTier);
  return mib === 0 || config.cgroupVersion !== 2
    ? {}
    : { mem_reservation: `${mib}m` };
}

/** The services written in Go, whose runtime takes a soft limit on the
 *  memory it manages (GOMEMLIMIT): versitygw and the Traefik edge. */
export type GoService = 'object-store' | 'proxy';

/** GOMEMLIMIT's share of the reservation: 80 %, as a fraction of integers so
 *  whole MiB come out exact. */
const GO_HEAP_SHARE = { numerator: 4, denominator: 5 } as const;

/** The memory limit of a Go service, as a multiple of its reservation. */
const GO_MEMORY_LIMIT_FACTOR = 4;

/** What a Go service's generator spreads in: its memory limit, and
 *  GOMEMLIMIT for its environment. Both empty where it reserves nothing. */
export interface GoMemory {
  limit: Pick<ComposeService, 'mem_limit'>;
  environment: { GOMEMLIMIT?: string };
}

/**
 * The memory bounds of a Go service, both derived from its reservation: the
 * variable's value, else its default, on every cgroup version (neither needs
 * `memory.low`).
 *
 * - GOMEMLIMIT is 80 % of the reservation, in whole MiB (`28MiB` for 35). The
 *   runtime collects harder as its memory nears the limit, which keeps a
 *   heap that grows with the garbage of a burst near the service's share:
 *   the edge reached 41 to 43 MiB under load without it, and stayed under 38
 *   through the smoke run with its heap held to 28 MiB.
 * - The memory limit is four times the reservation (`140m` for 35): a
 *   backstop against a runaway, not the budget. GOMEMLIMIT bounds garbage,
 *   not memory a request legitimately holds. The Go GC guide defines the
 *   limit as soft: a live heap that needs more grows past it, while the
 *   collector takes at most about half the CPU instead of stalling the
 *   service, and the guide advises against a limit close to the
 *   environment's own. So the hard limit leaves room well above GOMEMLIMIT,
 *   where a legitimate peak is slowed by the collector rather than killed.
 *
 * Neither is set where the reservation is 0: there is no share to derive
 * them from.
 */
export function goMemory(service: GoService): GoMemory {
  const mib = memoryReservationMib(service);
  if (mib === 0) return { limit: {}, environment: {} };
  const heapMib = Math.floor(
    (mib * GO_HEAP_SHARE.numerator) / GO_HEAP_SHARE.denominator,
  );
  return {
    limit: { mem_limit: composeSize(mib * GO_MEMORY_LIMIT_FACTOR) },
    environment: { GOMEMLIMIT: `${heapMib}MiB` },
  };
}

/** The reserved services a stack of this shape runs: the services outside
 *  the application tier, then the tier's. */
function stackReservedServices(tier: AppTier): ReservedService[] {
  return [...STACK_RESERVED_SERVICES, ...tier.services];
}

/**
 * The one line a command that generates the stack warns when memoryReservation
 * leaves reservations out, or null: on cgroup v2, and where every
 * reservation the stack would make is 0, nothing is left out. It reads every
 * size on every engine first, so a size Docker would refuse fails the command
 * where it asks, before it pulls, retags or snapshots anything.
 */
export function memoryReservationNotice(
  config: Pick<ServiceConfig, 'cgroupVersion' | 'appTier'>,
): string | null {
  const tier = config.appTier ?? THREE_WAY;
  const sizes = new Map(
    RESERVED_SERVICES.map((service) => [
      service,
      memoryReservationMib(service, tier),
    ]),
  );
  if (
    config.cgroupVersion === 2 ||
    stackReservedServices(tier).every((service) => sizes.get(service) === 0)
  ) {
    return null;
  }
  const engine =
    config.cgroupVersion === 1
      ? 'Docker runs cgroup v1, where a memory reservation is a soft limit that reclaim takes from first'
      : 'Docker did not report its cgroup version';
  return `${engine}: the stack's services run without memory reservations, which only cgroup v2 holds.`;
}

/**
 * The reservation variables that are set for a service a colour of this
 * shape does not run. A `platform` that is a backend process reads its own
 * variable, never the api's, so `BACKEND_API_MEMORY_RESERVATION` protects
 * nothing once there is no `backend-api`: a deploy names it, where silence
 * would leave the whole application on the default. Every service outside
 * the application tier runs in every shape.
 */
export function unusedMemoryReservations(tier: AppTier = THREE_WAY): string[] {
  return (['backend-api', 'backend-worker'] as const)
    .filter((service) => !tier.services.includes(service))
    .map((service) => MEMORY_RESERVATION_ENV[service])
    .filter((name) => (process.env[name] ?? '').trim() !== '');
}

/**
 * What the stack reserves on its host in all, in MiB: every service outside
 * the application tier (the database, the object store, the edge, the
 * spawner and its egress proxy), and every replica of the live colour's
 * services, whatever its shape has. The spawner's admission leaves at least
 * this much free unless SANDBOX_MIN_FREE_MEMORY says otherwise
 * (memoryReserveBytes, services/sandbox/src/host-memory.ts), so admission and
 * reclaim agree on what the sessions may take. The sum on every engine: what
 * admission leaves free does not depend on the cgroup version.
 */
export function reservedMemoryMib(tier: AppTier = THREE_WAY): number {
  // Quietly: the command that asks for the sum reads the counts itself, and
  // says once what it clamped.
  const replicas = tierReplicaCounts(tier, undefined, () => {});
  const application = tier.services.reduce(
    (sum, service) =>
      sum + memoryReservationMib(service, tier) * replicas[service],
    0,
  );
  return STACK_RESERVED_SERVICES.reduce(
    (sum, service) => sum + memoryReservationMib(service, tier),
    application,
  );
}
