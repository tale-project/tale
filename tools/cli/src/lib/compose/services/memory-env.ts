import { getReplicaCounts } from '../../../utils/load-env';
import type { ComposeService, ServiceConfig } from '../types';

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
 * What each service the sandbox sessions share the host with keeps resident
 * once it runs, in MiB: the floor its reservation (cgroup v2 `memory.low`)
 * protects from the reclaim that session memory pressure causes. Kept at or
 * under the service's steady-state working set, so a reservation never holds
 * memory the service does not use:
 *
 * - db: Postgres' `shared_buffers` (256MB, services/db/postgresql.conf), its
 *   connection backends and autovacuum.
 * - platform: the web role's `bun server.ts`.
 * - backend-api, backend-worker: the node backend each role runs.
 */
const MEMORY_RESERVATION_MIB = {
  db: 512,
  platform: 128,
  'backend-api': 256,
  'backend-worker': 256,
} as const;

/** The variable that overrides each service's reservation. */
const MEMORY_RESERVATION_ENV = {
  db: 'DB_MEMORY_RESERVATION',
  platform: 'PLATFORM_MEMORY_RESERVATION',
  'backend-api': 'BACKEND_API_MEMORY_RESERVATION',
  'backend-worker': 'BACKEND_WORKER_MEMORY_RESERVATION',
} as const;

export type ReservedService = keyof typeof MEMORY_RESERVATION_MIB;

/**
 * Each backend role's hard memory limit, in GiB: the `mem_limit` of its
 * containers (create-backend-services.ts).
 */
export const BACKEND_MEMORY_LIMIT_GIB = 12;

/** The memory limit of each reserved service that has one, in MiB. */
const MEMORY_LIMIT_MIB: Partial<Record<ReservedService, number>> = {
  'backend-api': BACKEND_MEMORY_LIMIT_GIB * 1024,
  'backend-worker': BACKEND_MEMORY_LIMIT_GIB * 1024,
};

/** The smallest reservation Docker creates a container with (moby's
 * linuxMinMemory, 6 MiB). */
const DOCKER_MIN_RESERVATION_MIB = 6;

/**
 * A service's memory reservation in whole MiB: its variable when set (`0`
 * reserves nothing), else its default. A reservation Docker would refuse at
 * `compose up` (under 6 MiB, or above the service's memory limit) fails the
 * compose generation instead, before any container is recreated.
 */
export function memoryReservationMib(service: ReservedService): number {
  const name = MEMORY_RESERVATION_ENV[service];
  const mib = memorySizeEnvMib(name, 0) ?? MEMORY_RESERVATION_MIB[service];
  const got = JSON.stringify(process.env[name]?.trim());
  if (mib > 0 && mib < DOCKER_MIN_RESERVATION_MIB) {
    throw new Error(
      `Env var ${name} must be 0 or at least ${DOCKER_MIN_RESERVATION_MIB}m; got: ${got}`,
    );
  }
  const limitMib = MEMORY_LIMIT_MIB[service];
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
  config: Pick<ServiceConfig, 'cgroupVersion'>,
): Pick<ComposeService, 'mem_reservation'> {
  const mib = memoryReservationMib(service);
  return mib === 0 || config.cgroupVersion !== 2
    ? {}
    : { mem_reservation: `${mib}m` };
}

/**
 * The one line a command that generates the stack warns when memoryReservation
 * leaves reservations out, or null: on cgroup v2, and where every
 * reservation is 0, nothing is left out. It reads every size on every engine
 * first, so a size Docker would refuse fails the command where it asks,
 * before it pulls, retags or snapshots anything.
 */
export function memoryReservationNotice(
  config: Pick<ServiceConfig, 'cgroupVersion'>,
): string | null {
  const services = Object.keys(MEMORY_RESERVATION_MIB) as ReservedService[];
  const sizes = services.map((service) => memoryReservationMib(service));
  if (config.cgroupVersion === 2 || sizes.every((mib) => mib === 0)) {
    return null;
  }
  const engine =
    config.cgroupVersion === 1
      ? 'Docker runs cgroup v1, where a memory reservation is a soft limit that reclaim takes from first'
      : 'Docker did not report its cgroup version';
  return `${engine}: the database and the application tier run without memory reservations, which only cgroup v2 holds.`;
}

/**
 * What the stack reserves on its host in all, in MiB: the one database and
 * every replica of the live colour's roles. The spawner's admission leaves at
 * least this much free unless SANDBOX_MIN_FREE_MEMORY says otherwise
 * (memoryReserveBytes, services/sandbox/src/host-memory.ts), so admission and
 * reclaim agree on what the sessions may take. The sum on every engine: what
 * admission leaves free does not depend on the cgroup version.
 */
export function reservedMemoryMib(): number {
  const replicas = getReplicaCounts();
  return (
    memoryReservationMib('db') +
    memoryReservationMib('platform') * replicas.platform +
    memoryReservationMib('backend-api') * replicas['backend-api'] +
    memoryReservationMib('backend-worker') * replicas['backend-worker']
  );
}
