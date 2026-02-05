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
  userId: string;
  enabled: boolean | null;
  expiresAt: Date | null;
  createdAt: Date;
  lastRequest: Date | null;
}
