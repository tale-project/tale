// The settings the user changes in the web page (stored in the database, unlike
// the environment's).

import { DEFAULT_START_PAGE, webUrl } from '../../lib/web-url.ts';

/** The keys the settings have in the `preferences` table. */
export const START_PAGE_KEY = 'start_page';
export const MCP_ENABLED_KEY = 'mcp_enabled';

export interface Preferences {
  /** What a new session, and a session without open tabs, opens. */
  startPage: string;
  /** AI assistants may connect over MCP. */
  mcpEnabled: boolean;
}

export const DEFAULT_PREFERENCES: Readonly<Preferences> = {
  startPage: DEFAULT_START_PAGE,
  mcpEnabled: false,
};

/** The stored values; one that is missing or unusable falls back to its default. */
export function loadPreferences(
  stored: Readonly<Record<string, unknown>>,
): Preferences {
  const startPage = stored[START_PAGE_KEY];
  return {
    startPage:
      typeof startPage === 'string' && webUrl(startPage) !== null
        ? startPage
        : DEFAULT_PREFERENCES.startPage,
    mcpEnabled: stored[MCP_ENABLED_KEY] === true,
  };
}
