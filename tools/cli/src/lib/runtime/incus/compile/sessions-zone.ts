import type { IncusDeclaration } from './stack-target';

/**
 * The sandbox zone of a stack (`services/sandbox/docs/incus.md`): the
 * project, bridge and profile the spawner creates sessions in, and the pool
 * their disks come from. `tale incus bootstrap` makes the zone under these
 * names unless told others, and the compiler hands a workspace's spawner the
 * same names where its `.env` names none, so the two cannot disagree.
 */

/** Where the zone lives: names bootstrap gives the sandbox zone's objects. */
export interface SessionsZone {
  project: string;
  network: string;
  profile: string;
}

/** The zone's default names for a stack project and bridge. */
export function defaultSessionsZone(
  declaration: IncusDeclaration,
): SessionsZone {
  return {
    project: `${declaration.project}-sessions`.slice(0, 63),
    network: `${declaration.network.name.slice(0, 13)}-s`,
    profile: 'sandbox',
  };
}

/** The spawner's zone variables for the default zone of `declaration`. */
export function sessionsZoneVariables(
  declaration: IncusDeclaration,
): Record<string, string> {
  const zone = defaultSessionsZone(declaration);
  return {
    SANDBOX_INCUS_PROJECT: zone.project,
    SANDBOX_INCUS_NETWORK: zone.network,
    SANDBOX_INCUS_PROFILE: zone.profile,
    SANDBOX_INCUS_STORAGE_POOL: declaration.pool,
  };
}
