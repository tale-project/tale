import type { SandboxWorkspacesConfig } from '@tale/shared/schemas/governance';

import type { SandboxWorkspaceUsage } from '../../core/node_only/sandbox/helpers/session_client.ts';
import type { WorkspaceRetireOutcome } from './workspace-cleanup.ts';

/**
 * Sandbox workspace reclaim — deleting idle project-agent workspaces for the
 * room they take, as the last pass of the hourly workspace cleanup
 * (`runWorkspaceCleanup`):
 *
 *  - over an organization's size cap (`maxWorkspaceGiB` of its
 *    `sandbox_workspaces` policy): every idle workspace measured above it,
 *    whatever the disk holds;
 *  - while the sandbox host's workspace disk is below the floor of free
 *    space admission keeps (it then refuses every new session): the largest
 *    idle workspaces of every organization that allows it
 *    (`reclaimOnDiskPressure`), until the free space the deletions add up to
 *    is back at twice the floor.
 *
 * The disk is one for every organization on the host, and the spawner
 * measures it per organization asked. One target from one reading, and one
 * ranking of every organization's idle workspaces, largest first: the fewest
 * workspaces go for the room needed, the largest idle holders give it back
 * first whoever they are, and no organization's place in the walk decides who
 * pays — where a target per organization would have each reclaim the whole
 * deficit. Twice the floor, not the floor: the workspaces still working go on
 * growing until the next hourly sweep, and a disk left at its floor would
 * refuse the next start again within minutes.
 *
 * Nothing here deletes on a guess. A workspace is weighed only when its
 * organization's rows hold it (a live agent's, latest incarnation not
 * destroyed), it is idle by those rows, no legal hold keeps it, and the
 * spawner measured it after its last use; a size unknown, failed, cut off
 * or older than the workspace's last use counts as no size. The deletion
 * itself is `retireWorkspace`'s: decided again under the organization's
 * admission lock, refused by the spawner while any compute runs under the
 * workspace, settled and audited only once its bytes are gone.
 */

const GIB = 1024 ** 3;
const HOUR_MS = 60 * 60 * 1000;

/** Why a workspace is deleted for the room it takes. */
export type ReclaimReason = 'disk_pressure' | 'over_size';

/** The workspaces' disk as a usage answer reads it. */
export type ReclaimDisk = NonNullable<SandboxWorkspaceUsage['disk']>;

/** What the reclaim reads of a workspace's rows to call it idle. */
export interface IdleFacts {
  ownerType: string;
  /** project_agent: the agent still exists. */
  agentExists: boolean;
  /** project_agent: a departed member's workspace (the verdict takes it). */
  memberLeft: boolean;
  /** A row still holds compute (creating, active, degraded). */
  inUse: boolean;
  /** A live row is pinned ("always-on"). */
  pinned: boolean;
  /** A queued or running task run is about to work in it. */
  runQueued: boolean;
  /** The newest sign of use. */
  lastUsedAt: number;
}

/**
 * Whether a workspace is idle as the reclaim means it: a live project agent's
 * workspace — the owner's deletion and the departure of a member are the
 * verdict's — with no compute, not pinned, no run about to use it, and
 * unused for the organization's idle hours.
 */
export function idleForReclaim(
  facts: IdleFacts,
  policy: Pick<SandboxWorkspacesConfig, 'reclaimMinIdleHours'>,
  now: number,
): boolean {
  return (
    facts.ownerType === 'project_agent' &&
    facts.agentExists &&
    !facts.memberLeft &&
    !facts.inUse &&
    !facts.pinned &&
    !facts.runQueued &&
    facts.lastUsedAt <= now - policy.reclaimMinIdleHours * HOUR_MS
  );
}

/**
 * The bytes a measurement stands for, or null when it stands for nothing:
 * not measured, never measured, or measured before the workspace was last
 * used. Its age is read on the spawner's clock (the answer's time against
 * the measurement's) and the workspace's idle time on the platform's, so
 * the two clocks are never compared with each other.
 */
export function trustedBytes(
  measured: { bytes: number | null; measuredAtMs: number | null },
  answeredAtMs: number,
  idleForMs: number,
): number | null {
  if (measured.bytes === null || measured.measuredAtMs === null) return null;
  const age = Math.max(0, answeredAtMs - measured.measuredAtMs);
  return age < idleForMs ? measured.bytes : null;
}

/** Whether a disk reading calls for a reclaim: below its floor, or below
 * its critical tier. An unknown disk never does. */
export function diskShort(disk: ReclaimDisk | null): boolean {
  return disk !== null && (disk.short || disk.critical);
}

/** The free space a reclaim for the disk works back to: twice its floor. */
export function reclaimTarget(disk: Pick<ReclaimDisk, 'floorBytes'>): number {
  return 2 * disk.floorBytes;
}

/** The bytes above which an organization's idle workspace is deleted, or
 * null without a cap. */
export function sizeCapBytes(
  policy: Pick<SandboxWorkspacesConfig, 'maxWorkspaceGiB'>,
): number | null {
  return policy.maxWorkspaceGiB === undefined
    ? null
    : policy.maxWorkspaceGiB * GIB;
}

/** Outcomes whose bytes the reclaim counts as freed: deleted, or out of use
 * with its files being deleted. Anything else frees nothing yet. */
export function freesBytes(outcome: WorkspaceRetireOutcome): boolean {
  return outcome === 'destroyed' || outcome === 'deleting';
}

/** An organization whose idle workspaces the reclaim may weigh: one that
 * exists, whose policy was read, and that no hold keeps whole. */
export interface ReclaimOrganization {
  organizationId: string;
  policy: SandboxWorkspacesConfig;
  /** A legal hold keeps this workspace of the organization. */
  held: (sessionId: string) => boolean;
}

/** One idle workspace the reclaim may delete, as it was measured. */
export interface ReclaimCandidate {
  organizationId: string;
  sessionId: string;
  bytes: number;
  /** When the spawner measured it, on its clock. */
  measuredAtMs: number;
  lastUsedAt: number;
  policy: SandboxWorkspacesConfig;
}

/** What the reclaim reads and does — injectable, so the selection is held
 * by unit tests and the wiring by the real-Postgres lane. */
export interface ReclaimIo {
  organizations: () => Promise<ReclaimOrganization[]>;
  /** The spawner's usage answer: `null` from one older than the route;
   * THROWS when it cannot answer. */
  usage: (organizationId: string) => Promise<SandboxWorkspaceUsage | null>;
  /** The workspace's facts from its organization's rows, or null when they
   * do not hold it (no row names it, its latest incarnation is destroyed,
   * or this sweep already tried to delete it). */
  facts: (
    organizationId: string,
    sessionId: string,
  ) => Promise<IdleFacts | null>;
  /** Delete one workspace through the one retire path; its re-check under
   * the lock may still keep it. */
  retire: (
    candidate: ReclaimCandidate,
    reason: ReclaimReason,
    detail: Record<string, unknown>,
  ) => Promise<WorkspaceRetireOutcome>;
  /** The sweep's bounds are spent, or its job is stopping. */
  exhausted: () => boolean;
}

export interface ReclaimResult {
  /** Whether usage was read: not needed (no organization caps its
   * workspaces or reclaims for the disk), read, unavailable (no answer
   * came), or unsupported by a spawner older than the route. */
  usage: 'skipped' | 'read' | 'unavailable' | 'unsupported';
  /** The disk as the last answer read it; null while unknown. */
  disk: ReclaimDisk | null;
  /** Workspaces a rule could have taken whose size was unknown or older
   * than their last use: never deleted for their size. */
  unmeasured: number;
  /** What the deletions freed or are freeing, in bytes. */
  freedBytes: number;
}

function gib(bytes: number): string {
  return (bytes / GIB).toFixed(1);
}

/** Largest first; equal sizes in a stable order. */
function largestFirst(a: ReclaimCandidate, b: ReclaimCandidate): number {
  return (
    b.bytes - a.bytes ||
    a.organizationId.localeCompare(b.organizationId) ||
    a.sessionId.localeCompare(b.sessionId)
  );
}

/**
 * The reclaim pass. Asks each organization's usage only while it can matter:
 * an organization with a cap always, the others only until an answer says the
 * disk has room. Then deletes, within the sweep's bounds, every idle
 * workspace above its organization's cap, largest first, and — while the
 * disk is short — the largest idle workspaces of every organization that
 * allows it, until what the deletions free brings the disk back to twice its
 * floor. A spawner older than the route reclaims nothing.
 */
export async function reclaimWorkspaces(
  io: ReclaimIo,
  now: number,
): Promise<ReclaimResult> {
  const result: ReclaimResult = {
    usage: 'skipped',
    disk: null,
    unmeasured: 0,
    freedBytes: 0,
  };
  const capped = (organization: ReclaimOrganization) =>
    sizeCapBytes(organization.policy) !== null;
  // Capped organizations first: they are asked whatever the disk says, and
  // their answers tell whether the others need asking at all.
  const organizations = (await io.organizations())
    .filter(
      (organization) =>
        capped(organization) || organization.policy.reclaimOnDiskPressure,
    )
    .sort((a, b) => Number(capped(b)) - Number(capped(a)));
  const answers: Array<{
    organization: ReclaimOrganization;
    usage: SandboxWorkspaceUsage;
  }> = [];
  let asked = false;
  // What the last answer said of the disk; undefined before the first.
  let short: boolean | undefined;
  for (const organization of organizations) {
    if (io.exhausted()) break;
    const forDisk =
      organization.policy.reclaimOnDiskPressure && short !== false;
    if (!capped(organization) && !forDisk) continue;
    asked = true;
    let usage: SandboxWorkspaceUsage | null;
    try {
      usage = await io.usage(organization.organizationId);
    } catch (error) {
      // A plain error is a sentence an operator can act on; anything the
      // runtime raised keeps its stack.
      console.warn(
        `[sandbox.cleanup] the workspace usage of ${organization.organizationId} is unavailable; its workspaces are not weighed for their size this sweep:`,
        error instanceof Error && error.constructor === Error
          ? error.message
          : error,
      );
      continue;
    }
    if (usage === null) {
      result.usage = 'unsupported';
      return result;
    }
    answers.push({ organization, usage });
    if (usage.disk !== null) result.disk = usage.disk;
    short = diskShort(usage.disk);
  }
  if (!asked) return result;
  result.usage = answers.length > 0 ? 'read' : 'unavailable';

  const pressure = diskShort(result.disk);
  const candidates: ReclaimCandidate[] = [];
  for (const { organization, usage } of answers) {
    const cap = sizeCapBytes(organization.policy);
    const forDisk = pressure && organization.policy.reclaimOnDiskPressure;
    if (cap === null && !forDisk) continue;
    for (const workspace of usage.workspaces) {
      if (io.exhausted()) break;
      if (workspace.bytes === null || workspace.measuredAtMs === null) {
        result.unmeasured += 1;
        continue;
      }
      // Only what one of the two rules could take is worth reading.
      if (!forDisk && !(cap !== null && workspace.bytes > cap)) continue;
      if (organization.held(workspace.sessionId)) continue;
      const facts = await io.facts(
        organization.organizationId,
        workspace.sessionId,
      );
      if (facts === null || !idleForReclaim(facts, organization.policy, now)) {
        continue;
      }
      const bytes = trustedBytes(
        workspace,
        usage.measuredAtMs,
        now - facts.lastUsedAt,
      );
      if (bytes === null) {
        result.unmeasured += 1;
        continue;
      }
      candidates.push({
        organizationId: organization.organizationId,
        sessionId: workspace.sessionId,
        bytes,
        measuredAtMs: workspace.measuredAtMs,
        lastUsedAt: facts.lastUsedAt,
        policy: organization.policy,
      });
    }
  }

  // 1. Over its organization's cap, whatever the disk holds.
  const taken = new Set<ReclaimCandidate>();
  const aboveCap = (workspace: ReclaimCandidate) => {
    const cap = sizeCapBytes(workspace.policy);
    return cap !== null && workspace.bytes > cap;
  };
  for (const candidate of candidates.filter(aboveCap).sort(largestFirst)) {
    if (io.exhausted()) break;
    taken.add(candidate);
    const outcome = await io.retire(candidate, 'over_size', {
      lastUsedAt: candidate.lastUsedAt,
      workspaceBytes: candidate.bytes,
      measuredAtMs: candidate.measuredAtMs,
      maxWorkspaceGiB: candidate.policy.maxWorkspaceGiB,
    });
    if (freesBytes(outcome)) result.freedBytes += candidate.bytes;
  }

  // 2. The disk: the host's largest idle workspaces, whoever holds them.
  const disk = result.disk;
  if (!pressure || disk === null) return result;
  const target = reclaimTarget(disk);
  let projected = disk.freeBytes + result.freedBytes;
  if (projected >= target) return result;
  const ranked = candidates
    .filter(
      (candidate) =>
        candidate.policy.reclaimOnDiskPressure && !taken.has(candidate),
    )
    .sort(largestFirst);
  console.log(
    `[sandbox.cleanup] the sandbox workspace disk is short (${gib(disk.freeBytes)} GiB free, floor ${gib(disk.floorBytes)} GiB): deleting the largest of ${ranked.length} idle workspace(s) with a known size until ${gib(target)} GiB are free`,
  );
  for (const candidate of ranked) {
    if (projected >= target || io.exhausted()) break;
    const outcome = await io.retire(candidate, 'disk_pressure', {
      lastUsedAt: candidate.lastUsedAt,
      workspaceBytes: candidate.bytes,
      measuredAtMs: candidate.measuredAtMs,
      diskFreeBytes: projected,
      diskFloorBytes: disk.floorBytes,
    });
    if (freesBytes(outcome)) {
      projected += candidate.bytes;
      result.freedBytes += candidate.bytes;
    }
  }
  if (projected < target) {
    console.warn(
      `[sandbox.cleanup] the sandbox workspace disk stays short (about ${gib(projected)} GiB free once the deletions finish, target ${gib(target)} GiB): no other idle workspace may go this sweep (${result.unmeasured} of unknown size); new sessions wait until space is freed`,
    );
  }
  return result;
}
