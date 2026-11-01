import { getReplicaCounts } from '../../../utils/load-env';
import type { ComposeService } from '../types';

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

/** A service's memory reservation in whole MiB: its variable when set (`0`
 * reserves nothing), else its default. */
export function memoryReservationMib(service: ReservedService): number {
  return (
    memorySizeEnvMib(MEMORY_RESERVATION_ENV[service], 0) ??
    MEMORY_RESERVATION_MIB[service]
  );
}

/**
 * The `mem_reservation` a service's generator spreads in, none when it
 * reserves nothing. Protection only holds where the engine's parent cgroup
 * grants it too (cgroup v2 bounds `memory.low` by every ancestor's), which the
 * self-hosting docs describe.
 */
export function memoryReservation(
  service: ReservedService,
): Pick<ComposeService, 'mem_reservation'> {
  const mib = memoryReservationMib(service);
  return mib === 0 ? {} : { mem_reservation: `${mib}m` };
}

/**
 * What the stack reserves on its host in all, in MiB: the one database and
 * every replica of the live colour's roles. The spawner's admission leaves at
 * least this much free unless SANDBOX_MIN_FREE_MEMORY says otherwise
 * (memoryReserveBytes, services/sandbox/src/host-memory.ts), so admission and
 * reclaim agree on what the sessions may take.
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
