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
  /** Who sees the tab: `developer` — owners, admins and developers; `modelApi`
   * — also a member who may call the model endpoints, for whom REST is where
   * their personal key is made and Models where a tool is set up. */
  audience: 'developer' | 'modelApi';
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
  { slug: 'rest', labelKey: 'apiRest', icon: KeyRound, audience: 'modelApi' },
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
  access: Pick<ApiSettingsAccess, 'developer' | 'modelApi'>,
): ApiNavItem[] {
  return API_NAV_ITEMS.filter(
    (item) =>
      access.developer || (item.audience === 'modelApi' && access.modelApi),
  );
}
