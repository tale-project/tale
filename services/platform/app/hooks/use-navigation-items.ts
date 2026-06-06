'use client';

import {
  MessageCircle,
  Inbox,
  BrainIcon,
  Network,
  Bot,
  Folder,
  Settings as SettingsIcon,
} from 'lucide-react';
import { useMemo } from 'react';

import { useT } from '@/lib/i18n/client';
import { type AppAction, type AppSubject } from '@/lib/permissions/ability';

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
  /**
   * Custom active-path matcher. When provided, replaces the default
   * `pathname === href || pathname.startsWith(href + '/')` check. Useful when
   * sibling entries share a prefix and the default would over-match.
   */
  isActivePath?: (pathname: string) => boolean;
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
  const { t: tConversations } = useT('conversations');
  const { t: tProjects } = useT('projects');
  return useMemo(
    (): NavigationItems => ({
      primary: [
        {
          label: tNav('chatWithAI'),
          to: '/dashboard/$id/chat',
          params: { id: businessId },
          href: `/dashboard/${businessId}/chat`,
          icon: MessageCircle,
        },
        {
          label: tProjects('title'),
          to: '/dashboard/$id/projects',
          params: { id: businessId },
          href: `/dashboard/${businessId}/projects`,
          icon: Folder,
          can: ['read', 'projects'],
        },
        {
          label: tNav('conversations'),
          to: '/dashboard/$id/conversations/$status',
          params: { id: businessId, status: 'open' },
          href: `/dashboard/${businessId}/conversations/open`,
          icon: Inbox,
          subItems: [
            {
              label: tConversations('status.open'),
              to: '/dashboard/$id/conversations/$status',
              params: { id: businessId, status: 'open' },
              href: `/dashboard/${businessId}/conversations/open`,
            },
            {
              label: tConversations('status.closed'),
              to: '/dashboard/$id/conversations/$status',
              params: { id: businessId, status: 'closed' },
              href: `/dashboard/${businessId}/conversations/closed`,
            },
            {
              label: tConversations('status.spam'),
              to: '/dashboard/$id/conversations/$status',
              params: { id: businessId, status: 'spam' },
              href: `/dashboard/${businessId}/conversations/spam`,
            },
            {
              label: tConversations('status.archived'),
              to: '/dashboard/$id/conversations/$status',
              params: { id: businessId, status: 'archived' },
              href: `/dashboard/${businessId}/conversations/archived`,
            },
          ],
        },
        {
          label: tNav('knowledge'),
          to: '/dashboard/$id/documents',
          params: { id: businessId },
          href: `/dashboard/${businessId}/documents`,
          icon: BrainIcon,
          subItems: [
            {
              label: tKnowledge('documents'),
              to: '/dashboard/$id/documents',
              params: { id: businessId },
              href: `/dashboard/${businessId}/documents`,
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
              label: tKnowledge('customers'),
              to: '/dashboard/$id/customers',
              params: { id: businessId },
              href: `/dashboard/${businessId}/customers`,
            },
            {
              label: tKnowledge('vendors'),
              to: '/dashboard/$id/vendors',
              params: { id: businessId },
              href: `/dashboard/${businessId}/vendors`,
            },
          ],
        },
        {
          label: tNav('agents'),
          to: '/dashboard/$id/agents',
          params: { id: businessId },
          href: `/dashboard/${businessId}/agents`,
          icon: Bot,
          can: ['write', 'agents'],
        },
        {
          label: tNav('automations'),
          to: '/dashboard/$id/automations',
          params: { id: businessId },
          href: `/dashboard/${businessId}/automations`,
          icon: Network,
          can: ['write', 'wfDefinitions'],
        },
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
        },
      ],
      pinned: [],
    }),
    [businessId, tNav, tKnowledge, tConversations, tProjects],
  );
}
