import type { ReturnsOf } from '@/app/lib/backend/contract';

/**
 * Whose key it is. `user`: the viewer's own key, which works in every
 * organization they belong to. `personal`: another member's own key, which
 * works here the same way; only an Owner's or Admin's view of every key
 * lists it, and only its holder ends it. The others are bound to this
 * organization: a key an Owner or Admin made for a member, and the keys of a
 * team, a project and the organization itself, which act as their own
 * identity.
 */
export type ApiKeyOwner =
  | { kind: 'user' }
  | {
      kind: 'personal';
      userId: string;
      name: string | null;
      email: string | null;
    }
  | {
      kind: 'member';
      userId: string;
      name: string | null;
      email: string | null;
    }
  | { kind: 'team'; teamId: string; teamName: string | null }
  | { kind: 'project'; projectId: string; projectName: string | null }
  | { kind: 'organization' };

/**
 * Which keys the list shows: the ones the viewer manages, or — for an Owner
 * or Admin — every key that works here, the members' own keys included.
 */
export type ApiKeyListScope = 'managed' | 'all';

/**
 * Whether the organization lets its members' own keys in (APIKEY-R12):
 * `refused` while an Owner or Admin turned them off here, `unavailable` while
 * the setting cannot be read, which refuses them too.
 */
export type PersonalKeysStanding =
  ReturnsOf<'governance/queries:getMyApiKeyAccess'>['personalKeys'];

/** The role a team's, a project's or the organization's key acts with. */
export type ApiKeyRole = 'member' | 'editor' | 'developer' | 'admin';

/** One key as `GET /api/app/api-keys` lists it — masked, never the secret. */
export interface ApiKey {
  id: string;
  name: string | null;
  /**
   * The first few characters of the API key, including the prefix.
   * Used for UI display to help users identify their keys.
   * May be null if starting character storage is disabled in config.
   */
  start: string | null;
  /**
   * The API key prefix (e.g., "sk_", "tale_").
   * This is just the configured prefix, not the key characters.
   * Used as fallback when `start` is not available.
   */
  prefix: string | null;
  /**
   * Trailing plaintext characters of the key, captured at creation time.
   * Rendered alongside `start` as `start … suffix` so users can match a row
   * against the key they hold. Rows created before this feature shipped
   * have no value — those render with the prefix only.
   */
  suffix?: string | null;
  enabled: boolean | null;
  /** Epoch ms; null for a key that never expires. */
  expiresAt: number | null;
  createdAt: number;
  lastRequest: number | null;
  owner: ApiKeyOwner;
  role: ApiKeyRole | null;
  /** Who made a key bound to this organization; null for the viewer's own. */
  createdBy: { userId: string; name: string | null } | null;
  canRevoke: boolean;
  /**
   * Whether this organization has blocked the viewer's own key here: its
   * requests here are refused, while it works in their other organizations.
   * Absent from a server that predates blocks.
   */
  blockedHere?: boolean;
}

/**
 * What `GET /api/app/api-keys` answers. The list of every key also says
 * whether the members' own keys work here: while they do not, it lists none
 * of them.
 */
export interface ApiKeyListing {
  keys: ApiKey[];
  personalKeys?: PersonalKeysStanding;
}

/** Whose key a new one is, as the create dialog chooses it. */
export type ApiKeyOwnerInput =
  | { kind: 'self' }
  | { kind: 'member'; userId: string }
  | { kind: 'team'; teamId: string; role: ApiKeyRole }
  | { kind: 'project'; projectId: string; role: ApiKeyRole }
  | { kind: 'organization'; role: ApiKeyRole };

/** A member's own key, as an Owner or Admin sees it on the member's row. */
export interface MemberPersonalApiKey {
  id: string;
  name: string | null;
  start: string | null;
  prefix: string | null;
  suffix: string | null;
  enabled: boolean | null;
  expiresAt: number | null;
  createdAt: number;
  /** When and by whom this organization blocked it; null while it works. */
  blocked: { at: number; by: { userId: string; name: string | null } } | null;
}

/** `GET /api/app/api-keys/members/:userId/personal`. */
export interface MemberPersonalApiKeys {
  keys: MemberPersonalApiKey[];
  /** Whether the viewer may block and free these keys. */
  canBlock: boolean;
  /**
   * Whether this organization lets members' own keys in at all
   * (APIKEY-R12): while `refused` none of these keys works here, blocked or
   * not; while `unavailable` the setting cannot be read and the keys are
   * kept out until it can.
   */
  personalKeys: 'admitted' | 'refused' | 'unavailable';
}
