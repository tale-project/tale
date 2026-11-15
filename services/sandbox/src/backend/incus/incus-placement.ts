// Where a new session goes when the spawner drives several Incus hosts: the
// host with the most headroom left once the session is on it, among the ones
// that may take it. Headroom is the smallest share left of what each host
// bounds: its session cap (SANDBOX_INCUS_ENDPOINTS `maxSessions`), and the
// memory and disk its project may still use. A restricted certificate sees no
// node resources, so memory and disk are the project's own limits
// (`limits.memory`, `limits.disk`, `limits.disk.pool.<pool>`) and the storage
// pool's free space where the certificate may read it; a bound the host does
// not state is left out of the comparison, never guessed.
//
// `chooseEndpoint` is pure; `readProjectRoom` reads one host.

import type { IncusClient } from '@tale/incus/client';
import { getProjectState } from '@tale/incus/state';
import { getStoragePoolResources } from '@tale/incus/volumes';

/** What is left of one bound, in bytes. */
export interface Room {
  free: number;
  limit: number;
}

/** What one host has room for, as read just now. */
export interface EndpointRoom {
  /** Sessions it holds (not ended), with the creates under way on it. */
  sessions: number;
  /** Its session cap. */
  maxSessions: number;
  /** Absent when the project sets no memory limit. */
  memory?: Room;
  /** Absent when neither the project's disk limits nor the pool can be read. */
  disk?: Room;
}

/** One host as the placement sees it. */
export interface EndpointCandidate {
  name: string;
  /** Declared drained: it takes no new session. */
  drained: boolean;
  /** Why the host cannot be asked now (unreachable, not past its boot
   * checks, its runtime image missing); absent when it can. */
  unavailable?: string;
  /** What it has room for; absent when `unavailable` says why. */
  room?: EndpointRoom;
}

/** What the session about to be placed takes. */
export interface PlacementNeed {
  memoryBytes: number;
  diskBytes: number;
}

export interface Placement {
  /** The chosen host; absent when none may take the session. */
  chosen?: string;
  /** Its headroom once the session is on it, a share from 0 to 1. */
  headroom?: number;
  /** Each host passed over, and why. */
  skipped: Array<{ name: string; reason: string; full: boolean }>;
}

const GIB = 1024 ** 3;

/** The pools whose space a host would not show, said once each. */
const unreadablePools = new Set<string>();

function gib(bytes: number): string {
  return `${(bytes / GIB).toFixed(1)} GiB`;
}

/** Why the host cannot take the session, or its headroom once it does. */
export function judgeRoom(
  room: EndpointRoom,
  need: PlacementNeed,
): { reason: string } | { headroom: number } {
  if (room.sessions >= room.maxSessions) {
    return {
      reason: `its session cap is reached (${room.sessions}/${room.maxSessions})`,
    };
  }
  if (room.memory !== undefined && room.memory.free < need.memoryBytes) {
    return {
      reason: `its project has ${gib(room.memory.free)} of memory left and a session takes ${gib(need.memoryBytes)}`,
    };
  }
  if (room.disk !== undefined && room.disk.free < need.diskBytes) {
    return {
      reason: `it has ${gib(room.disk.free)} of disk left and a workspace takes ${gib(need.diskBytes)}`,
    };
  }
  const shares = [(room.maxSessions - room.sessions - 1) / room.maxSessions];
  if (room.memory !== undefined && room.memory.limit > 0) {
    shares.push((room.memory.free - need.memoryBytes) / room.memory.limit);
  }
  if (room.disk !== undefined && room.disk.limit > 0) {
    shares.push((room.disk.free - need.diskBytes) / room.disk.limit);
  }
  return { headroom: Math.min(...shares) };
}

/**
 * The host with the most headroom among those that are not drained, can be
 * asked, and have room for the session; the first declared wins a tie, so a
 * placement is the same for the same readings.
 */
export function chooseEndpoint(
  candidates: readonly EndpointCandidate[],
  need: PlacementNeed,
): Placement {
  const skipped: Placement['skipped'] = [];
  let best: { name: string; headroom: number } | undefined;
  for (const candidate of candidates) {
    if (candidate.drained) {
      skipped.push({ name: candidate.name, reason: 'drained', full: false });
      continue;
    }
    if (candidate.unavailable !== undefined || candidate.room === undefined) {
      skipped.push({
        name: candidate.name,
        reason: candidate.unavailable ?? 'its room is unknown',
        full: false,
      });
      continue;
    }
    const judged = judgeRoom(candidate.room, need);
    if ('reason' in judged) {
      skipped.push({ name: candidate.name, reason: judged.reason, full: true });
      continue;
    }
    if (best === undefined || judged.headroom > best.headroom) {
      best = { name: candidate.name, headroom: judged.headroom };
    }
  }
  return best === undefined
    ? { skipped }
    : { chosen: best.name, headroom: best.headroom, skipped };
}

/** The tighter of two rooms: the one with less left. */
function tighter(a: Room | undefined, b: Room | undefined): Room | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return b.free < a.free ? b : a;
}

/**
 * The memory and disk the host's project may still use, from its state
 * (`GET /1.0/projects/<project>/state`), and the free space of the workspace
 * pool where the certificate may read it. THROWS when the project state
 * cannot be read (the host is not answering); a pool the certificate may not
 * read leaves the pool out.
 */
export async function readProjectRoom(
  client: IncusClient,
  storagePool: string,
  /** The host, for the log. */
  where: string,
): Promise<{ memory?: Room; disk?: Room }> {
  const [state, pool] = await Promise.all([
    getProjectState(client),
    getStoragePoolResources(client, storagePool).then(
      (resources): Room | undefined => ({
        free: Math.max(0, resources.space.total - resources.space.used),
        limit: resources.space.total,
      }),
      (error: unknown): undefined => {
        // A restricted certificate may not be shown the pool's space; the
        // project's quotas still bound the disk. Said once per host and pool.
        const key = `${where} ${storagePool}`;
        if (!unreadablePools.has(key)) {
          unreadablePools.add(key);
          console.warn(
            `[sandbox.incus] the free space of pool ${storagePool} on ${where} is not readable, so placement bounds its disk by the project's limits alone:`,
            error instanceof Error ? error.message : error,
          );
        }
        return undefined;
      },
    ),
  ]);
  const limited = (key: string): Room | undefined => {
    const resource = state.resources[key];
    if (resource === undefined || resource.limit < 0) return undefined;
    return {
      free: Math.max(0, resource.limit - resource.usage),
      limit: resource.limit,
    };
  };
  const memory = limited('memory');
  const disk = tighter(
    tighter(limited('disk'), limited(`disk.${storagePool}`)),
    pool,
  );
  return {
    ...(memory === undefined ? {} : { memory }),
    ...(disk === undefined ? {} : { disk }),
  };
}
