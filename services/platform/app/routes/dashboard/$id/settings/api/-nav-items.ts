import { Cable, HardDrive, KeyRound, type LucideIcon } from 'lucide-react';

interface ApiNavItem {
  slug: 'rest' | 'mcp' | 'webdav';
  labelKey: 'apiRest' | 'mcp' | 'webdav';
  icon: LucideIcon;
}

/**
 * API sub-section catalog (REST / WebDAV). Shared between the section's own
 * route (mobile tab strip) and the unified settings rail (inline expansion on
 * desktop).
 *
 * Runtimes (the tale-daemon fleet) left this catalog with the external-runtime
 * REST surface — it re-registers when the daemon-runs rebuild lands.
 */
export const API_NAV_ITEMS: ApiNavItem[] = [
  { slug: 'rest', labelKey: 'apiRest', icon: KeyRound },
  { slug: 'mcp', labelKey: 'mcp', icon: Cable },
  { slug: 'webdav', labelKey: 'webdav', icon: HardDrive },
];
