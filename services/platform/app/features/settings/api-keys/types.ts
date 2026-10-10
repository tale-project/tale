/**
 * Whose key it is. `user`: the viewer's own key, which works in every
 * organization they belong to. The others are bound to this organization:
 * a key an Owner or Admin made for a member, and the keys of a team, a
 * project and the organization itself, which act as their own identity.
 */
export type ApiKeyOwner =
  | { kind: 'user' }
  | {
      kind: 'member';
      userId: string;
      name: string | null;
      email: string | null;
    }
  | { kind: 'team'; teamId: string; teamName: string | null }
  | { kind: 'project'; projectId: string; projectName: string | null }
  | { kind: 'organization' };

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
}

/** Whose key a new one is, as the create dialog chooses it. */
export type ApiKeyOwnerInput =
  | { kind: 'self' }
  | { kind: 'member'; userId: string }
  | { kind: 'team'; teamId: string; role: ApiKeyRole }
  | { kind: 'project'; projectId: string; role: ApiKeyRole }
  | { kind: 'organization'; role: ApiKeyRole };
