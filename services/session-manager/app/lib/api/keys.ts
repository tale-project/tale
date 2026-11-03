import type { SecretsFilter } from './endpoints';

/** The react-query keys of the app, so a write can name what it makes stale. */
export const queryKeys = {
  meta: ['meta'] as const,
  settings: ['settings'] as const,
  sessions: ['sessions'] as const,
  /** Every window of the sessions list, not the single sessions of the pages. */
  sessionLists: ['sessions', 'list'] as const,
  /** One window of the list: the newest `limit`, down to `minId` when it is read back to one. */
  sessionList: (limit: number, minId?: number) =>
    ['sessions', 'list', limit, minId ?? null] as const,
  session: (id: number) => ['sessions', 'one', id] as const,
  /**
   * The sessions a secret can be for, kept apart from the sessions' own keys:
   * the polling quickens while any cached session is busy, and this list is
   * read for a picker, not polled. A write to a session names it, all the same.
   */
  sessionChoices: ['session-choices'] as const,
  proxies: ['proxies'] as const,
  proxyList: (limit: number) => ['proxies', 'list', limit] as const,
  secrets: ['secrets'] as const,
  secretList: (filter: SecretsFilter) => ['secrets', 'list', filter] as const,
  secret: (id: number) => ['secrets', 'one', id] as const,
};
