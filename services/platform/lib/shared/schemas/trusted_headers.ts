import { z } from 'zod/v4';

/**
 * Trusted headers, organization mode — the shapes the settings card, its
 * `/api/app/trusted-headers` routes and the hand-off door share.
 *
 * An organization owns one switch, one role ceiling and a handful of keys.
 * A key is the credential an application's authenticating proxy presents on
 * `GET /api/trusted-headers/authenticate`; the door resolves the
 * organization FROM the key, so the proxy can sign users into that
 * organization and no other.
 */

/** Keys per organization — enough for a rotation overlap, not a registry. */
export const TRUSTED_HEADER_KEYS_PER_ORG_MAX = 10;

/** Admin-chosen key label, trimmed and bounded. */
export const TRUSTED_HEADER_KEY_NAME_MAX = 64;

/**
 * The roles a proxy may assert, lowest first. `owner` is deliberately
 * absent — the seat that owns the organization is never handed out by a
 * header — and so is `disabled`: to shut a member out, revoke their
 * membership or stop asserting them.
 */
export const TRUSTED_HEADER_ASSERTABLE_ROLES = [
  'member',
  'editor',
  'developer',
  'admin',
] as const;

export const trustedHeaderAssertableRoleSchema = z.enum(
  TRUSTED_HEADER_ASSERTABLE_ROLES,
);
export type TrustedHeaderAssertableRole = z.infer<
  typeof trustedHeaderAssertableRoleSchema
>;

/** `PUT /api/app/trusted-headers/settings` */
export const trustedHeaderSettingsInputSchema = z.object({
  enabled: z.boolean(),
  maxAssertedRole: trustedHeaderAssertableRoleSchema,
});
export type TrustedHeaderSettingsInput = z.infer<
  typeof trustedHeaderSettingsInputSchema
>;

/** `POST /api/app/trusted-headers/keys` */
export const trustedHeaderKeyCreateSchema = z.object({
  name: z.string().trim().min(1).max(TRUSTED_HEADER_KEY_NAME_MAX),
});
export type TrustedHeaderKeyCreateInput = z.infer<
  typeof trustedHeaderKeyCreateSchema
>;

/** One live key as the settings card lists it — never the plaintext. */
export interface TrustedHeaderKeyView {
  id: string;
  name: string;
  tokenPrefix: string;
  createdAt: number;
  createdBy: string;
  lastUsedAt: number | null;
}

/** The request headers the door reads, by their effective names. */
export interface TrustedHeaderNames {
  /** Carries the key when the proxy cannot set `Authorization`. */
  key: string;
  email: string;
  name: string;
  role: string;
  teams: string;
}

/** `GET /api/app/trusted-headers` */
export interface TrustedHeadersView {
  enabled: boolean;
  maxAssertedRole: TrustedHeaderAssertableRole;
  keys: TrustedHeaderKeyView[];
  headers: TrustedHeaderNames;
}

/** `POST /api/app/trusted-headers/keys` — the plaintext, exactly once. */
export interface TrustedHeaderKeyCreated {
  id: string;
  key: string;
  tokenPrefix: string;
}

const ROLE_RANK: Record<TrustedHeaderAssertableRole, number> = {
  member: 1,
  editor: 2,
  developer: 3,
  admin: 4,
};

function isAssertableRole(value: string): value is TrustedHeaderAssertableRole {
  return (TRUSTED_HEADER_ASSERTABLE_ROLES as readonly string[]).includes(value);
}

/**
 * The role a sign-in actually gets: the asserted one, folded to the
 * vocabulary, never above the organization's ceiling. Anything the proxy
 * says that is not an assertable role — `owner`, `disabled`, a typo, an
 * empty header — reads as `member`, the floor.
 */
export function clampAssertedRole(
  requested: string | undefined,
  maxAssertedRole: TrustedHeaderAssertableRole,
): TrustedHeaderAssertableRole {
  const folded = (requested ?? '').toLowerCase().trim();
  const asserted: TrustedHeaderAssertableRole = isAssertableRole(folded)
    ? folded
    : 'member';
  return ROLE_RANK[asserted] > ROLE_RANK[maxAssertedRole]
    ? maxAssertedRole
    : asserted;
}
