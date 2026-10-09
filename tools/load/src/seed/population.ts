/**
 * The population as data: who the users are, which rows the SQL seed writes
 * for them, and which memberships they hold. Pure functions only, so the
 * naming and the layout are unit-tested without a database, and every row
 * derives from the plan helpers the driver uses as well.
 */

import { Faker, base, en } from '@faker-js/faker';

import {
  isMegaOrgMember,
  megaOrganizationIndex,
  memberRoleFor,
  organizationIndexFor,
  sessionId,
  sessionTokenFor,
  userEmail,
  userId,
  type LoadPlan,
  type PlanMemberRole,
} from '../plan.ts';
import { syntheticIp } from './options.ts';

/** The part of a plan the population derives from (the list may be empty). */
export type PopulationPlan = Pick<
  LoadPlan,
  'runId' | 'users' | 'organizations'
>;

/** A plan skeleton for a population, before any organization exists. */
export function populationFor(args: {
  runId: string;
  emailDomain: string;
  password: string;
  sessionsMinted: boolean;
  users: number;
  orgSize: number;
  megaOrgSize: number;
}): PopulationPlan {
  return {
    runId: args.runId,
    users: {
      count: args.users,
      emailDomain: args.emailDomain,
      password: args.password,
      sessionsMinted: args.sessionsMinted,
    },
    organizations: {
      count: Math.ceil(args.users / args.orgSize),
      size: args.orgSize,
      megaOrgSize: args.megaOrgSize,
      list: [],
    },
  };
}

/** Every organization index the population has: blocks, then the mega org. */
export function organizationIndexes(plan: PopulationPlan): number[] {
  const mega = megaOrganizationIndex(plan);
  const total = plan.organizations.count + (mega === null ? 0 : 1);
  return Array.from({ length: total }, (_, index) => index);
}

/** Virtual-user index of organization `orgIndex`'s owner. */
export function ownerIndexFor(plan: PopulationPlan, orgIndex: number): number {
  return orgIndex === megaOrganizationIndex(plan)
    ? 0
    : orgIndex * plan.organizations.size;
}

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

/** One Faker instance; seeding it is the expensive part, generating is not. */
const faker = new Faker({ locale: [en, base] });

/** Names are generated in fixed blocks so one seed serves a thousand users. */
const NAME_BLOCK = 1024;

/** A 31-bit number from the run id, so two runs draw different people. */
function runSeed(runId: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < runId.length; i += 1) {
    h = Math.imul(h ^ runId.charCodeAt(i), 0x01000193);
  }
  return (h >>> 0) & 0x7fffffff;
}

/**
 * Display names of users `[start, end)`. Faker is seeded per fixed block of
 * {@link NAME_BLOCK} indexes and walked from the block's start, so the name
 * of user `k` depends on the run id and `k` alone, whatever batch boundaries
 * the caller uses: a rerun writes the same names.
 */
export function displayNames(
  runId: string,
  start: number,
  end: number,
): string[] {
  const names: string[] = [];
  const seed = runSeed(runId);
  for (
    let block = Math.floor(start / NAME_BLOCK);
    block * NAME_BLOCK < end;
    block += 1
  ) {
    faker.seed([seed, block]);
    const first = block * NAME_BLOCK;
    const last = Math.min(end, first + NAME_BLOCK);
    for (let index = first; index < last; index += 1) {
      const name = faker.person.fullName();
      if (index >= start) names.push(name);
    }
  }
  return names;
}

/** Company name of organization `orgIndex`, stable per run id and index. */
export function organizationName(runId: string, orgIndex: number): string {
  faker.seed([runSeed(runId), 0x0ff1ce, orgIndex]);
  return faker.company.name();
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

/** How long a minted session lives. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** User agent of minted sessions, so they are recognisable in the table. */
const SESSION_USER_AGENT = 'tale-load';

/** Stable id of virtual user `index`'s credential account row. */
export function accountId(runId: string, index: number): string {
  return `load_${runId}_a${index}`;
}

/** Stable id of the membership of user `index` in organization `orgIndex`. */
export function memberId(
  runId: string,
  orgIndex: number,
  index: number,
): string {
  return `load_${runId}_m${orgIndex}_${index}`;
}

export interface UserRow {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
  twoFactorEnabled: boolean;
}

/**
 * `"user"` rows for users `[start, end)`. Verified like every account the
 * platform provisions (its user-create hook asserts it), 2FA off.
 */
export function buildUserRows(
  plan: PopulationPlan,
  start: number,
  end: number,
  now: Date,
): UserRow[] {
  const names = displayNames(plan.runId, start, end);
  const rows: UserRow[] = [];
  for (let index = start; index < end; index += 1) {
    rows.push({
      id: userId(plan.runId, index),
      name: names[index - start] ?? `Load User ${index}`,
      email: userEmail(plan, index),
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
      twoFactorEnabled: false,
    });
  }
  return rows;
}

export interface AccountRow {
  id: string;
  accountId: string;
  providerId: 'credential';
  userId: string;
  password: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Credential `account` rows: the shape the platform's own password writer
 * uses (`accountId` = the user id, `providerId` = `credential`), with ONE
 * scrypt hash shared by every row.
 */
export function buildAccountRows(
  plan: PopulationPlan,
  start: number,
  end: number,
  passwordHash: string,
  now: Date,
): AccountRow[] {
  const rows: AccountRow[] = [];
  for (let index = start; index < end; index += 1) {
    const user = userId(plan.runId, index);
    rows.push({
      id: accountId(plan.runId, index),
      accountId: user,
      providerId: 'credential',
      userId: user,
      password: passwordHash,
      createdAt: now,
      updatedAt: now,
    });
  }
  return rows;
}

export interface SessionRow {
  id: string;
  token: string;
  userId: string;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
  ipAddress: string;
  userAgent: string;
}

/**
 * One `session` row per user, its token derived by `sessionTokenFor` so any
 * shard re-derives the cookie from the plan and the secret alone.
 */
export function buildSessionRows(
  plan: PopulationPlan,
  start: number,
  end: number,
  authSecret: string,
  now: Date,
): SessionRow[] {
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  const rows: SessionRow[] = [];
  for (let index = start; index < end; index += 1) {
    rows.push({
      id: sessionId(plan.runId, index),
      token: sessionTokenFor(authSecret, plan.runId, index),
      userId: userId(plan.runId, index),
      expiresAt,
      createdAt: now,
      updatedAt: now,
      ipAddress: syntheticIp('10', index),
      userAgent: SESSION_USER_AGENT,
    });
  }
  return rows;
}

/** One membership the seed adds (owners are added by organization create). */
export interface Membership {
  orgIndex: number;
  index: number;
  role: Exclude<PlanMemberRole, 'owner'>;
}

/**
 * The non-owner memberships of users `[start, end)`: their block
 * organization, and the mega organization for the first `megaOrgSize`.
 * Owners are left out: the organization-create call made them owners, with
 * the audit row and hooks that come with it.
 */
export function membershipsFor(
  plan: PopulationPlan,
  start: number,
  end: number,
): Membership[] {
  const mega = megaOrganizationIndex(plan);
  const out: Membership[] = [];
  for (let index = start; index < end; index += 1) {
    const block = organizationIndexFor(plan, index);
    if (block !== null) {
      const role = memberRoleFor(plan, block, index);
      if (role !== null && role !== 'owner') {
        out.push({ orgIndex: block, index, role });
      }
    }
    if (mega !== null && isMegaOrgMember(plan, index)) {
      const role = memberRoleFor(plan, mega, index);
      if (role !== null && role !== 'owner') {
        out.push({ orgIndex: mega, index, role });
      }
    }
  }
  return out;
}

/** How many memberships {@link membershipsFor} yields over all users. */
export function expectedMembershipCount(plan: PopulationPlan): number {
  const blockMembers = plan.users.count - plan.organizations.count;
  const megaMembers = Math.max(0, plan.organizations.megaOrgSize - 1);
  return blockMembers + megaMembers;
}

export interface MemberRow {
  id: string;
  organizationId: string;
  userId: string;
  role: string;
  createdAt: Date;
}

/**
 * `member` rows for users `[start, end)`. Memberships of an organization the
 * seed has no id for (its creation failed) are counted in `skipped`.
 */
export function buildMemberRows(
  plan: PopulationPlan,
  start: number,
  end: number,
  orgIds: ReadonlyMap<number, string>,
  now: Date,
): { rows: MemberRow[]; skipped: number } {
  const rows: MemberRow[] = [];
  let skipped = 0;
  for (const membership of membershipsFor(plan, start, end)) {
    const organizationId = orgIds.get(membership.orgIndex);
    if (organizationId === undefined) {
      skipped += 1;
      continue;
    }
    rows.push({
      id: memberId(plan.runId, membership.orgIndex, membership.index),
      organizationId,
      userId: userId(plan.runId, membership.index),
      role: membership.role,
      createdAt: now,
    });
  }
  return { rows, skipped };
}

/**
 * The organization user `index` lands in after sign-in: their block
 * organization, else the mega organization when they belong to it.
 */
export function activeOrganizationIndex(
  plan: PopulationPlan,
  index: number,
): number | null {
  const block = organizationIndexFor(plan, index);
  if (block !== null) return block;
  return isMegaOrgMember(plan, index) ? megaOrganizationIndex(plan) : null;
}

/** Half-open index ranges of at most `size` covering `[0, total)`. */
export function batches(
  total: number,
  size: number,
): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  for (let start = 0; start < total; start += size) {
    out.push({ start, end: Math.min(total, start + size) });
  }
  return out;
}
