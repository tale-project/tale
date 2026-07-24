import { HardDrive, KeyRound, type LucideIcon } from 'lucide-react';

interface ApiNavItem {
  slug: 'rest' | 'webdav';
  labelKey: 'apiRest' | 'webdav';
  icon: LucideIcon;
}

/**
 * API sub-section catalog (REST / WebDAV). Shared between the section's own
 * route (mobile tab strip) and the unified settings rail (inline expansion on
 * desktop). The MCP endpoint lives on the Integrations page.
 *
 * Runtimes (the tale-daemon fleet) left this catalog with the external-runtime
 * REST surface — it re-registers when the daemon-runs rebuild lands.
 */
export const API_NAV_ITEMS: ApiNavItem[] = [
  { slug: 'rest', labelKey: 'apiRest', icon: KeyRound },
  { slug: 'webdav', labelKey: 'webdav', icon: HardDrive },
];
