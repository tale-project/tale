'use client';

import {
  MessageCircle,
  BrainIcon,
  Workflow,
  Folder,
  Inbox,
  Settings as SettingsIcon,
} from 'lucide-react';
import { useMemo } from 'react';

import { useInboxAvailability } from '@/app/features/conversations/hooks/use-inbox-availability';
import { type NavSection } from '@/app/lib/nav-memory';
import { useT } from '@/lib/i18n/client';
import { type AppAction, type AppSubject } from '@/lib/permissions/ability';

import { useIsMac } from './use-is-mac';

export interface NavItem {
  label: string;
  to: string;
  params: Record<string, string>;
  href: string;
  icon?: React.ComponentType<{
    className?: string;
    style?: React.CSSProperties;
  }>;
  external?: boolean;
  /** CASL ability check required to show this item. When absent, always visible. */
  can?: [AppAction, AppSubject];
  subItems?: NavItem[];
  /** Unread count rendered as a chip on the nav icon (omit/0 = no chip). */
  badge?: number;
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
   * Which nav-memory section this entry owns. Present on every primary
   * destination; absent on anything that is not a section (external links).
   * The rail reads the remembered place for this section when the user is
   * somewhere else, and ignores it when they are already here.
   */
  section?: NavSection;
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
  /** Items pinned at the bottom of the sidebar (above the UserButton) and surfaced in the mobile overflow sheet. */
  pinned: NavItem[];
}

export function useNavigationItems(businessId: string): NavigationItems {
  const { t: tNav } = useT('navigation');
  const { t: tKnowledge } = useT('knowledge');
  const { t: tProjects } = useT('projects');
  const { t: tConversations } = useT('conversations');
  const isMac = useIsMac();
  const newChatShortcut = isMac ? '⌥ ⌘ N' : 'ALT + CTRL + N';
  // The Inbox entry used to be gated on an installed automation declaring the
  // `inbox` builtin view; that signal lives in the automations backend, which
  // is offline while it is rebuilt, so `useInboxAvailability` currently
  // reports every org as inbox-capable and the entry always shows.
  const { hasInbox: hasInboxAutomation } = useInboxAvailability(businessId);
  return useMemo(
    (): NavigationItems => ({
      primary: [
        {
          // Section destination: opens the caller's last chat (or a blank
          // composer when there is none). Fresh chats use the header + /
          // ⌥⌘N shortcut with `?new=1`.
          label: tNav('chat'),
          to: '/dashboard/$id/chat',
          params: { id: businessId },
          href: `/dashboard/${businessId}/chat`,
          icon: MessageCircle,
          shortcut: newChatShortcut,
          section: 'chat',
          // Clicking chat while already in it starts a new one — the same
          // navigation the ⌥⌘N shortcut performs. Entering from elsewhere
          // still resumes (the remembered thread, else the surface's own
          // most-recently-active fallback).
          reentrySearch: { new: true },
          isActivePath: (pathname) =>
            pathname === `/dashboard/${businessId}/chat` ||
            pathname.startsWith(`/dashboard/${businessId}/chat/`),
        },
        {
          label: tProjects('title'),
          to: '/dashboard/$id/projects',
          params: { id: businessId },
          href: `/dashboard/${businessId}/projects`,
          icon: Folder,
          section: 'projects',
          can: ['read', 'projects'],
        },
        {
          label: tNav('knowledge'),
          to: '/dashboard/$id/documents',
          params: { id: businessId },
          href: `/dashboard/${businessId}/documents`,
          icon: BrainIcon,
          section: 'knowledge',
          // Mirrors KnowledgeNavigation's tab strip exactly. The rail's active
          // state is computed from these, and that state now decides where a
          // click GOES (remembered place vs. section default), so a tab
          // missing here would both fail to highlight and mis-route.
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
          section: 'automations',
        },
        // Annotated: an inline conditional spread is inferred without the
        // array's contextual type, which widens `section` to `string` and
        // then poisons the whole literal.
        ...(hasInboxAutomation
          ? ([
              {
                label: tConversations('title'),
                to: '/dashboard/$id/conversations',
                params: { id: businessId },
                href: `/dashboard/${businessId}/conversations`,
                icon: Inbox,
                section: 'conversations',
              },
            ] satisfies NavItem[])
          : []),
        {
          // Single Settings entry. The index route redirects to the
          // permission-appropriate landing page (org settings for admins,
          // account for everyone else) via getDefaultSettingsRoute. The
          // default active-path matcher lights it up for every `/settings`
          // sub-route since they all share this prefix.
          label: tNav('userSettings'),
          to: '/dashboard/$id/settings',
          params: { id: businessId },
          href: `/dashboard/${businessId}/settings`,
          icon: SettingsIcon,
          section: 'settings',
        },
      ],
      pinned: [],
    }),
    [
      businessId,
      tNav,
      tKnowledge,
      tProjects,
      tConversations,
      hasInboxAutomation,
      newChatShortcut,
    ],
  );
}
