import {
  Bot,
  Cable,
  HardDrive,
  KeyRound,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';

import type { ApiSettingsAccess } from '@/app/features/settings/model-endpoints/hooks/use-api-settings-access';

interface ApiNavItem {
  slug: 'rest' | 'models' | 'mcp' | 'agents' | 'webdav';
  labelKey: 'apiRest' | 'apiModels' | 'mcp' | 'connectedAgents' | 'webdav';
  icon: LucideIcon;
  /** Who sees the tab: `developer` — owners, admins and developers; `apiKeys`
   * — also a member who may create a personal API key, for whom REST is where
   * it is made; `modelApi` — also a member who may call the model endpoints,
   * for whom Models is where a tool is set up; `agents` — also a member who
   * may connect a coding agent or holds a connection, for whom Connected
   * agents is where theirs are listed and disconnected. */
  audience: 'developer' | 'apiKeys' | 'modelApi' | 'agents';
}

/**
 * API sub-section catalog (REST / Models / MCP / Connected agents / WebDAV).
 * Shared between the section's own route (mobile tab strip) and the unified
 * settings rail (inline expansion on desktop).
 *
 * Runtimes (the tale-daemon fleet) left this catalog with the external-runtime
 * REST surface — it re-registers when the daemon-runs rebuild lands.
 */
export const API_NAV_ITEMS: ApiNavItem[] = [
  { slug: 'rest', labelKey: 'apiRest', icon: KeyRound, audience: 'apiKeys' },
  {
    slug: 'models',
    labelKey: 'apiModels',
    icon: Sparkles,
    audience: 'modelApi',
  },
  { slug: 'mcp', labelKey: 'mcp', icon: Cable, audience: 'developer' },
  {
    slug: 'agents',
    labelKey: 'connectedAgents',
    icon: Bot,
    audience: 'agents',
  },
  {
    slug: 'webdav',
    labelKey: 'webdav',
    icon: HardDrive,
    audience: 'developer',
  },
];

/** The API tabs a member may open. */
export function visibleApiNavItems(
  access: Pick<
    ApiSettingsAccess,
    'developer' | 'apiKeys' | 'modelApi' | 'agents'
  >,
): ApiNavItem[] {
  return API_NAV_ITEMS.filter((item) =>
    // Connected agents is not the developer roles' by right: it takes agent
    // sign-in to be on, or a connection to look after.
    item.audience === 'agents'
      ? access.agents
      : access.developer ||
        (item.audience === 'apiKeys' && access.apiKeys) ||
        (item.audience === 'modelApi' && access.modelApi),
  );
}

/** The access the navigation lists tabs by: a tab the member may open, and
 * one a failed read left undecided — opened, it says the access didn't load
 * and offers to try again, where hiding it would read as a refusal. */
export function listedApiAccess(
  access: Pick<
    ApiSettingsAccess,
    'developer' | 'apiKeys' | 'modelApi' | 'agents' | 'undecided'
  >,
): Pick<ApiSettingsAccess, 'developer' | 'apiKeys' | 'modelApi' | 'agents'> {
  return {
    developer: access.developer,
    apiKeys: access.apiKeys || access.undecided.apiKeys,
    modelApi: access.modelApi || access.undecided.modelApi,
    agents: access.agents || access.undecided.agents,
  };
}

/** Which sentence says why a tab is closed to a member: the one naming what
 * opens it, or — for a tab only the developer roles open — the roles. */
const TAB_DENIED_MESSAGE_KEY = {
  developer: 'apiTab',
  apiKeys: 'apiTab',
  modelApi: 'apiModels',
  agents: 'apiAgents',
} as const satisfies Record<
  ApiNavItem['audience'],
  'apiTab' | 'apiModels' | 'apiAgents'
>;

export function tabDeniedMessageKey(
  item: Pick<ApiNavItem, 'audience'>,
): 'apiTab' | 'apiModels' | 'apiAgents' {
  return TAB_DENIED_MESSAGE_KEY[item.audience];
}
