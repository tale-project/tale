import {
  Cable,
  HardDrive,
  KeyRound,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';

import type { ApiSettingsAccess } from '@/app/features/settings/model-endpoints/hooks/use-api-settings-access';

interface ApiNavItem {
  slug: 'rest' | 'models' | 'mcp' | 'webdav';
  labelKey: 'apiRest' | 'apiModels' | 'mcp' | 'webdav';
  icon: LucideIcon;
  /** Who sees the tab: `developer` — owners, admins and developers; `apiKeys`
   * — also a member who may create a personal API key, for whom REST is where
   * it is made; `modelApi` — also a member who may call the model endpoints,
   * for whom Models is where a tool is set up. */
  audience: 'developer' | 'apiKeys' | 'modelApi';
}

/**
 * API sub-section catalog (REST / Models / MCP / WebDAV). Shared between the
 * section's own route (mobile tab strip) and the unified settings rail
 * (inline expansion on desktop).
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
    slug: 'webdav',
    labelKey: 'webdav',
    icon: HardDrive,
    audience: 'developer',
  },
];

/** The API tabs a member may open. */
export function visibleApiNavItems(
  access: Pick<ApiSettingsAccess, 'developer' | 'apiKeys' | 'modelApi'>,
): ApiNavItem[] {
  return API_NAV_ITEMS.filter(
    (item) =>
      access.developer ||
      (item.audience === 'apiKeys' && access.apiKeys) ||
      (item.audience === 'modelApi' && access.modelApi),
  );
}
