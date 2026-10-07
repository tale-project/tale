'use client';

import { useIsMac } from '@tale/ui/use-is-mac';
import {
  BrainIcon,
  House,
  Workflow,
  Settings as SettingsIcon,
  type LucideIcon,
} from 'lucide-react';
import { useMemo } from 'react';

import { useCanUseAutomations } from '@/app/features/automations/hooks/use-can-use-automations';
import { useUnreadConversationCount } from '@/app/features/conversations/hooks/queries';
import { useInboxAvailability } from '@/app/features/conversations/hooks/use-inbox-availability';
import { isHomePath } from '@/app/features/home/lib/home-paths';
import { useT } from '@/lib/i18n/client';
import { type AppAction, type AppSubject } from '@/lib/permissions/ability';

export interface NavItem {
  label: string;
  to: string;
  params: Record<string, string>;
  href: string;
  /** Lucide only, like every icon in the app. */
  icon?: LucideIcon;
  external?: boolean;
  /** CASL ability check required to show this item. When absent, always visible. */
  can?: [AppAction, AppSubject];
  subItems?: NavItem[];
  /** Unread count rendered as a chip on the nav icon (omit/0 = no chip). */
  badge?: number;
  /**
   * What the chip MEANS, translated ("3 unread conversations"). The tile's
   * accessible name is `label, badgeLabel`, because the chip itself is
   * decorative — a bare "3" announces nothing. Required whenever `badge` is
   * set; without it the count is sighted-only.
   */
  badgeLabel?: string;
  /**
   * Platform-resolved keyboard-shortcut hint (e.g. `⌥ ⌘ N`) shown as a chip in
   * the item's hover tooltip. Present only for items that own a global
   * shortcut; the binding itself lives in the `Navigation` component.
   */
  shortcut?: string;
  /**
   * Custom active-path matcher. When provided, replaces the default
   * `pathname === href || pathname.startsWith(href + '/')` check. Useful when
   * sibling entries share a prefix and the default would over-match.
   */
  isActivePath?: (pathname: string) => boolean;
  /**
   * Search the tile always navigates with. Only Home carries one:
   * `{ new: true }`, so the tile opens a fresh composer from any section and
   * from Home itself, never the last chat.
   */
  search?: Record<string, unknown>;
}

export interface NavigationItems {
  /** Main destinations shown in the primary nav list. */
  primary: NavItem[];
  /** Items pinned at the foot of the rail (above the UserButton); on a phone they join the tab bar. */
  pinned: NavItem[];
}

function isPathMatch(itemHref: string, currentPath: string): boolean {
  if (itemHref === currentPath) return true;
  if (currentPath.startsWith(itemHref + '/')) return true;
  return false;
}

/** Shared by the desktop rail and the mobile tab bar so the two navigations
 *  cannot disagree on which tile is "active". */
export function isItemActive(item: NavItem, pathname: string): boolean {
  return item.isActivePath
    ? item.isActivePath(pathname)
    : isPathMatch(item.href, pathname) ||
        (item.subItems?.some((subItem) =>
          isPathMatch(subItem.href, pathname),
        ) ??
          false);
}

export function useNavigationItems(businessId: string): NavigationItems {
  const { t: tNav } = useT('navigation');
  const { t: tKnowledge } = useT('knowledge');
  const isMac = useIsMac();
  const newChatShortcut = isMac ? '⌥ ⌘ N' : 'ALT + CTRL + N';
  const { showInbox: hasInbox } = useInboxAvailability(businessId);
  // The chip on the Home tile: OPEN inbox conversations still carrying
  // unread messages, already narrowed to this caller's inbox scope by the
  // counts door — the one signal that arrives from outside while you work.
  // Skipped without an inbox, and `undefined` until the first read lands —
  // the tile renders bare rather than flashing a zero.
  const { data: unreadConversations } = useUnreadConversationCount(
    hasInbox ? businessId : undefined,
  );
  // Automations is a builder's section: only Owners, Admins and Developers
  // get the entry, whatever the organization runs.
  const showAutomations = useCanUseAutomations();

  // Every tile opens its section's overview — the same page every time,
  // whatever was open in that section before and also from inside it: a
  // tile is a request for the section, never a replay of a place in it.
  return useMemo(
    (): NavigationItems => ({
      primary: [
        {
          // Home holds everything you work on — chats, projects with their
          // tasks, and the inbox — behind one panel. The tile always opens a
          // fresh composer, the same navigation the ⌥⌘N shortcut performs;
          // the earlier chats stay one row away in the Home panel.
          label: tNav('home'),
          to: '/dashboard/$id/chat',
          params: { id: businessId },
          href: `/dashboard/${businessId}/chat`,
          icon: House,
          shortcut: newChatShortcut,
          search: { new: true },
          isActivePath: (path) => isHomePath(path, businessId),
          badge: unreadConversations ?? 0,
          badgeLabel: tNav('aria.unreadConversations', {
            count: unreadConversations ?? 0,
          }),
        },
        {
          label: tNav('knowledge'),
          to: '/dashboard/$id/documents',
          params: { id: businessId },
          href: `/dashboard/${businessId}/documents`,
          icon: BrainIcon,
          // Mirrors KnowledgeNavigation's tab strip exactly: the rail's
          // active state is computed from these, so a tab missing here would
          // fail to highlight while the user is on it.
          subItems: [
            {
              label: tKnowledge('documents'),
              to: '/dashboard/$id/documents',
              params: { id: businessId },
              href: `/dashboard/${businessId}/documents`,
            },
            {
              label: tKnowledge('knowledgeEntries'),
              to: '/dashboard/$id/knowledge-entries',
              params: { id: businessId },
              href: `/dashboard/${businessId}/knowledge-entries`,
            },
            {
              label: tKnowledge('websites'),
              to: '/dashboard/$id/websites',
              params: { id: businessId },
              href: `/dashboard/${businessId}/websites`,
            },
            {
              label: tKnowledge('products'),
              to: '/dashboard/$id/products',
              params: { id: businessId },
              href: `/dashboard/${businessId}/products`,
            },
            {
              label: tKnowledge('contacts'),
              to: '/dashboard/$id/contacts',
              params: { id: businessId },
              href: `/dashboard/${businessId}/contacts`,
            },
          ],
        },
        ...(showAutomations
          ? [
              {
                label: tNav('automations'),
                to: '/dashboard/$id/automations',
                params: { id: businessId },
                href: `/dashboard/${businessId}/automations`,
                icon: Workflow,
              },
            ]
          : []),
      ],
      pinned: [
        {
          // Single Settings entry, pinned with the account tiles at the foot
          // of the rail: configuration is not a place you work in. The index
          // route redirects to the permission-appropriate landing page (org
          // settings for admins, account for everyone else) via
          // getDefaultSettingsRoute; the default active-path matcher lights
          // it up for every `/settings` sub-route.
          label: tNav('userSettings'),
          to: '/dashboard/$id/settings',
          params: { id: businessId },
          href: `/dashboard/${businessId}/settings`,
          icon: SettingsIcon,
        },
      ],
    }),
    [
      businessId,
      tNav,
      tKnowledge,
      unreadConversations,
      newChatShortcut,
      showAutomations,
    ],
  );
}
