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
   * Search to apply when the tile is clicked while ALREADY active — the
   * "take me back to this section's default" gesture. Only chat needs one:
   * re-entering chat opens a fresh composer rather than resuming a thread.
   */
  reentrySearch?: Record<string, unknown>;
}

export interface NavigationItems {
  /** Main destinations shown in the primary nav list. */
  primary: NavItem[];
  /** Items pinned at the foot of the rail (above the UserButton); on a phone they join the tab bar. */
  pinned: NavItem[];
}

export function useNavigationItems(businessId: string): NavigationItems {
  const { t: tNav } = useT('navigation');
  const { t: tKnowledge } = useT('knowledge');
  const isMac = useIsMac();
  const newChatShortcut = isMac ? '⌥ ⌘ N' : 'ALT + CTRL + N';
  const { hasInbox } = useInboxAvailability(businessId);
  // The chip on the Home tile: OPEN inbox conversations still carrying
  // unread messages, already narrowed to this caller's inbox scope by the
  // counts door — the one signal that arrives from outside while you work.
  // Skipped without an inbox, and `undefined` until the first read lands —
  // the tile renders bare rather than flashing a zero.
  const { data: unreadConversations } = useUnreadConversationCount(
    hasInbox ? businessId : undefined,
  );
  return useMemo(
    (): NavigationItems => ({
      primary: [
        {
          // Home holds everything you work on — chats, projects with their
          // tasks, and the inbox — behind one panel. The tile opens the
          // caller's last chat (or a blank composer when there is none);
          // clicking it while already in Home starts a fresh chat, the same
          // navigation the ⌥⌘N shortcut performs.
          label: tNav('home'),
          to: '/dashboard/$id/chat',
          params: { id: businessId },
          href: `/dashboard/${businessId}/chat`,
          icon: House,
          shortcut: newChatShortcut,
          reentrySearch: { new: true },
          isActivePath: (pathname) => isHomePath(pathname, businessId),
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
        {
          label: tNav('automations'),
          to: '/dashboard/$id/automations',
          params: { id: businessId },
          href: `/dashboard/${businessId}/automations`,
          icon: Workflow,
        },
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
    [businessId, tNav, tKnowledge, unreadConversations, newChatShortcut],
  );
}
