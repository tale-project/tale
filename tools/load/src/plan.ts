/**
 * The load plan: what `seed` built and what `run` and `smoke` drive.
 *
 * A plan is deterministic from its parameters. Virtual user `k` (0-based)
 * is always the same person: same e-mail, same organization, same session
 * token. Every shard of a distributed run therefore derives its users from
 * the plan's parameters alone; nothing per user is shipped between machines,
 * which is what lets one plan file drive a million users from fifty
 * generators.
 *
 * The file is JSON on disk (`load-plan.json`) and is validated on read.
 */

import { createHmac } from 'node:crypto';

import { z } from 'zod';

/** Organizations the seed created through the API (hooks and scaffold ran). */
export const planOrganizationSchema = z.object({
  /** Index of the organization within the plan, 0-based. */
  index: z.number().int().min(0),
  id: z.string().min(1),
  slug: z.string().min(1),
  name: z.string().min(1),
  /** Virtual-user index of the organization's owner. */
  ownerIndex: z.number().int().min(0),
  /** A project every member may write to: the journeys file tasks here. */
  projectId: z.string().min(1).nullable(),
  /** Provider slug the org's chat and embeddings resolve against. */
  providerSlug: z.string().min(1).nullable(),
  /** A model id the composer offers for this org's chat turns. */
  modelId: z.string().min(1).nullable(),
});

export type PlanOrganization = z.infer<typeof planOrganizationSchema>;

export const loadPlanSchema = z.object({
  version: z.literal(1),
  /** ISO timestamp the seed finished. */
  createdAt: z.string(),
  /** Base URL the seed talked to; `run` may override it per shard. */
  target: z.string().url(),
  /**
   * Seed identity: e-mails and session tokens derive from it, so two plans
   * against one deployment never collide.
   */
  runId: z.string().regex(/^[a-z0-9]{4,16}$/),
  users: z.object({
    count: z.number().int().min(1),
    /** E-mail domain of every virtual user (`load-<runId>-u<k>@<domain>`). */
    emailDomain: z.string().min(3),
    /** One password for every seeded user; a load plan is not a secret store. */
    password: z.string().min(12),
    /**
     * Whether the seed wrote session rows whose tokens derive from
     * `sessionTokenFor`. Only true where the seed had database access; a
     * deployment seeded over HTTP alone signs every user in.
     */
    sessionsMinted: z.boolean(),
  }),
  /**
   * How users map to organizations: users `[o * size, (o + 1) * size)` belong
   * to organization `o`, the first of each block being its owner. When
   * `megaOrgSize > 0` one more organization follows the blocks (it is the
   * last entry of `list`): users `[0, megaOrgSize)` are ALSO members of it,
   * owned by user 0, so the plan exercises both a large tenant and people
   * who belong to two organizations.
   */
  organizations: z.object({
    count: z.number().int().min(1),
    size: z.number().int().min(1),
    megaOrgSize: z.number().int().min(0),
    list: z.array(planOrganizationSchema),
  }),
  /** Mock provider the seeded orgs point at, when one was configured. */
  provider: z
    .object({
      slug: z.string().min(1),
      baseUrl: z.string().url(),
      envName: z.string().regex(/^TALE_PROVIDER_KEY_[A-Za-z0-9_]+$/),
      apiFormat: z.enum(['openai', 'anthropic']),
      chatModel: z.string().min(1),
      embeddingModel: z.string().min(1),
      embeddingDimensions: z.number().int().min(1),
    })
    .nullable(),
});

export type LoadPlan = z.infer<typeof loadPlanSchema>;

/** E-mail of virtual user `index`. Lower-case: sign-in compares lower(email). */
export function userEmail(
  plan: Pick<LoadPlan, 'runId' | 'users'>,
  index: number,
): string {
  return `load-${plan.runId}-u${index}@${plan.users.emailDomain}`;
}

/** Stable user id the SQL seed writes for virtual user `index`. */
export function userId(runId: string, index: number): string {
  return `load_${runId}_u${index}`;
}

/** Stable session id the SQL seed writes for virtual user `index`. */
export function sessionId(runId: string, index: number): string {
  return `load_${runId}_s${index}`;
}

/**
 * The session token of virtual user `index`: an HMAC of the run id and the
 * index under the deployment's auth secret, so it cannot be guessed from the
 * plan alone and every shard re-derives it without a token file.
 */
export function sessionTokenFor(
  authSecret: string,
  runId: string,
  index: number,
): string {
  return createHmac('sha256', authSecret)
    .update(`tale-load:${runId}:${index}`)
    .digest('base64url')
    .slice(0, 32);
}

/**
 * The block organization virtual user `index` belongs to, or `null` for a
 * user past the last block. Membership of the mega organization is separate:
 * see `isMegaOrgMember`.
 */
export function organizationIndexFor(
  plan: Pick<LoadPlan, 'organizations'>,
  index: number,
): number | null {
  const block = Math.floor(index / plan.organizations.size);
  return block < plan.organizations.count ? block : null;
}

/** Whether virtual user `index` is also a member of the mega organization. */
export function isMegaOrgMember(
  plan: Pick<LoadPlan, 'organizations'>,
  index: number,
): boolean {
  return index < plan.organizations.megaOrgSize;
}

/** Whether virtual user `index` owns its organization. */
export function isOwner(
  plan: Pick<LoadPlan, 'organizations'>,
  index: number,
): boolean {
  return index % plan.organizations.size === 0;
}

/** Slug of organization `orgIndex`; the mega organization uses index `count`. */
export function organizationSlug(runId: string, orgIndex: number): string {
  return `load-${runId}-o${orgIndex}`;
}

/**
 * Index of the mega organization in `organizations.list` (it follows the
 * blocks, so it is `count`), or `null` when the plan has none.
 */
export function megaOrganizationIndex(
  plan: Pick<LoadPlan, 'organizations'>,
): number | null {
  return plan.organizations.megaOrgSize > 0 ? plan.organizations.count : null;
}

/** Roles a seeded membership can carry, in Tale's own vocabulary. */
export const PLAN_MEMBER_ROLES = [
  'owner',
  'admin',
  'developer',
  'editor',
  'member',
] as const;

export type PlanMemberRole = (typeof PLAN_MEMBER_ROLES)[number];

/**
 * Share of the NON-owner members of an organization that hold each elevated
 * role; everyone else is a plain `member`. Roughly what a real tenant looks
 * like: a handful of admins, some developers wiring automations, a tenth who
 * may edit shared content.
 */
export const MEMBER_ROLE_SHARES = {
  admin: 0.02,
  developer: 0.05,
  editor: 0.1,
} as const;

const BLOCK_ROLE_SALT = 0x9e3779b9;
const MEGA_ROLE_SALT = 0x7f4a7c15;

/**
 * A well-mixed number in `[0, 1)` from an integer: murmur3's finalizer. Used
 * instead of a seeded random stream so a role is a pure function of the user
 * index, and neighbouring indexes still land on unrelated roles.
 */
function unitHash(value: number, salt: number): number {
  let h = (value ^ salt) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4_294_967_296;
}

function weightedRole(draw: number): Exclude<PlanMemberRole, 'owner'> {
  let threshold = MEMBER_ROLE_SHARES.admin;
  if (draw < threshold) return 'admin';
  threshold += MEMBER_ROLE_SHARES.developer;
  if (draw < threshold) return 'developer';
  threshold += MEMBER_ROLE_SHARES.editor;
  if (draw < threshold) return 'editor';
  return 'member';
}

/**
 * The role virtual user `index` holds in organization `orgIndex`, or `null`
 * when the user is not a member of it. Owners are fixed (the first user of a
 * block; user 0 for the mega organization); every other member's role is
 * drawn from {@link MEMBER_ROLE_SHARES} by a hash of the index, salted per
 * organization kind so a block admin is not automatically a mega admin.
 */
export function memberRoleFor(
  plan: Pick<LoadPlan, 'organizations'>,
  orgIndex: number,
  index: number,
): PlanMemberRole | null {
  if (orgIndex === megaOrganizationIndex(plan)) {
    if (!isMegaOrgMember(plan, index)) return null;
    if (index === 0) return 'owner';
    return weightedRole(unitHash(index, MEGA_ROLE_SALT));
  }
  if (organizationIndexFor(plan, index) !== orgIndex) return null;
  if (isOwner(plan, index)) return 'owner';
  return weightedRole(unitHash(index, BLOCK_ROLE_SALT));
}

/**
 * Name of Better Auth's session cookie on a deployment whose SITE_URL is
 * `siteUrl`: https deployments add the `__Secure-` prefix.
 */
export function sessionCookieName(siteUrl: string): string {
  const secure = new URL(siteUrl).protocol === 'https:';
  return `${secure ? '__Secure-' : ''}better-auth.session_token`;
}

/**
 * The cookie VALUE Better Auth accepts for session `token`: the token, a dot
 * and the standard-base64 HMAC-SHA256 of the token under the auth secret,
 * URI-encoded — exactly what `better-call`'s `signCookieValue` produces.
 */
export function signedSessionCookieValue(
  authSecret: string,
  token: string,
): string {
  const signature = createHmac('sha256', authSecret)
    .update(token)
    .digest('base64');
  return encodeURIComponent(`${token}.${signature}`);
}

/**
 * The half-open range of user indexes shard `shard` of `shards` drives.
 * Ranges partition `[0, count)` exactly; the first `count % shards` shards
 * take one extra user.
 */
export function shardRange(
  count: number,
  shard: number,
  shards: number,
): { start: number; end: number } {
  if (!Number.isInteger(shards) || shards < 1) {
    throw new Error(`shards must be a positive integer, got ${shards}`);
  }
  if (!Number.isInteger(shard) || shard < 0 || shard >= shards) {
    throw new Error(`shard must be in [0, ${shards}), got ${shard}`);
  }
  const base = Math.floor(count / shards);
  const extra = count % shards;
  const start = shard * base + Math.min(shard, extra);
  const end = start + base + (shard < extra ? 1 : 0);
  return { start, end };
}
