/**
 * Typed registry of marketing platform pages. Nav dropdown, footer Platform
 * column, related-pages blocks, and the hub grid all read from here — add a
 * page once and every chrome surface picks it up.
 *
 * Paths are the English-default canonicals registered in
 * `localized-link.tsx` `ROUTE_PATHS` and `lib/seo/marketing-routes.ts`.
 */

import type { LucideIcon } from 'lucide-react';
import {
  Bot,
  FolderOpen,
  LayoutGrid,
  MessagesSquare,
  ShieldCheck,
  Sparkles,
  Workflow,
} from 'lucide-react';

export type PlatformPageId =
  | 'hub'
  | 'agents'
  | 'chat'
  | 'automations'
  | 'knowledge'
  | 'governance'
  | 'conversations';

export interface PlatformPageDef {
  id: PlatformPageId;
  /** Canonical English path. */
  path:
    | '/platform'
    | '/platform/agents'
    | '/platform/chat'
    | '/platform/automations'
    | '/platform/knowledge'
    | '/platform/governance'
    | '/platform/conversations';
  /** Key under `seo.*` for title/description. */
  seoKey:
    | 'platform'
    | 'platformAgents'
    | 'platformChat'
    | 'platformAutomations'
    | 'platformKnowledge'
    | 'platformGovernance'
    | 'platformConversations';
  /** Key under `nav.product.*` for the dropdown label. */
  navKey:
    | 'hub'
    | 'agents'
    | 'chat'
    | 'automations'
    | 'knowledge'
    | 'governance'
    | 'conversations';
  /** Short blurb key under `nav.product.*.description` (dropdown subtitle). */
  descriptionKey: 'description';
  /** Docs deep-link path (appended to DOCS_URL). */
  docsPath: string;
  /** Sibling modules shown in the related-pages strip. */
  related: readonly PlatformPageId[];
  /** Show in the Product dropdown (hub is the dropdown trigger, not a row). */
  inNavDropdown: boolean;
  /** Show in the footer Platform column. */
  inFooter: boolean;
}

/**
 * Module order (nav dropdown, footer Platform column, hub grid):
 * Chat → Knowledge → Agents → Automations → Conversations → Governance.
 * (Product also has Projects between Chat and Knowledge; no marketing page yet.)
 */
export const PLATFORM_PAGES: readonly PlatformPageDef[] = [
  {
    id: 'hub',
    path: '/platform',
    seoKey: 'platform',
    navKey: 'hub',
    descriptionKey: 'description',
    docsPath: '/platform/chat/overview',
    related: [
      'chat',
      'knowledge',
      'agents',
      'automations',
      'conversations',
      'governance',
    ],
    inNavDropdown: false,
    inFooter: true,
  },
  {
    id: 'chat',
    path: '/platform/chat',
    seoKey: 'platformChat',
    navKey: 'chat',
    descriptionKey: 'description',
    docsPath: '/platform/chat/overview',
    related: ['knowledge', 'agents', 'conversations', 'governance'],
    inNavDropdown: true,
    inFooter: true,
  },
  {
    id: 'knowledge',
    path: '/platform/knowledge',
    seoKey: 'platformKnowledge',
    navKey: 'knowledge',
    descriptionKey: 'description',
    docsPath: '/platform/knowledge/overview',
    related: ['chat', 'agents', 'automations', 'governance'],
    inNavDropdown: true,
    inFooter: true,
  },
  {
    id: 'agents',
    path: '/platform/agents',
    seoKey: 'platformAgents',
    navKey: 'agents',
    descriptionKey: 'description',
    docsPath: '/platform/agents/concepts',
    related: ['chat', 'knowledge', 'automations', 'governance'],
    inNavDropdown: true,
    inFooter: true,
  },
  {
    id: 'automations',
    path: '/platform/automations',
    seoKey: 'platformAutomations',
    navKey: 'automations',
    descriptionKey: 'description',
    docsPath: '/platform/automations/concepts',
    related: ['agents', 'knowledge', 'governance', 'chat'],
    inNavDropdown: true,
    inFooter: true,
  },
  {
    id: 'conversations',
    path: '/platform/conversations',
    seoKey: 'platformConversations',
    navKey: 'conversations',
    descriptionKey: 'description',
    docsPath: '/platform/chat/shared-threads',
    related: ['chat', 'agents', 'knowledge', 'governance'],
    inNavDropdown: true,
    inFooter: true,
  },
  {
    id: 'governance',
    path: '/platform/governance',
    seoKey: 'platformGovernance',
    navKey: 'governance',
    descriptionKey: 'description',
    docsPath: '/platform/approvals/concepts',
    related: ['automations', 'conversations', 'agents', 'chat'],
    inNavDropdown: true,
    inFooter: true,
  },
] as const;

export function getPlatformPage(id: PlatformPageId): PlatformPageDef {
  const page = PLATFORM_PAGES.find((p) => p.id === id);
  if (!page) throw new Error(`Unknown platform page: ${id}`);
  return page;
}

/** Lucide icons shared by header Product menu, hub grid, and related modules. */
const PLATFORM_ICONS: Record<PlatformPageId, LucideIcon> = {
  hub: LayoutGrid,
  agents: Bot,
  chat: MessagesSquare,
  automations: Workflow,
  knowledge: FolderOpen,
  governance: ShieldCheck,
  conversations: Sparkles,
};

export function getPlatformIcon(id: PlatformPageId): LucideIcon {
  return PLATFORM_ICONS[id];
}

export const NAV_DROPDOWN_PAGES = PLATFORM_PAGES.filter((p) => p.inNavDropdown);
export const FOOTER_PLATFORM_PAGES = PLATFORM_PAGES.filter((p) => p.inFooter);
