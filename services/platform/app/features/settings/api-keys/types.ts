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
   * Trailing plaintext characters of the key, captured at creation time
   * by an after-hook on `/api-key/create` (the upstream Better Auth
   * plugin doesn't know about this column). Rendered alongside `start`
   * as `start … suffix` so users can match a row against the key they
   * hold. Optional because (a) Better Auth's SDK return type doesn't
   * include it and (b) rows created before this feature shipped have no
   * value — those render with the prefix only.
   */
  suffix?: string | null;
  userId?: string;
  enabled: boolean | null;
  expiresAt: Date | null;
  createdAt: Date;
  lastRequest: Date | null;
}
