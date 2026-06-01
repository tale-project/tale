'use client';

import {
  MessageCircle,
  Inbox,
  BrainIcon,
  Network,
  Bot,
  Building2,
  Folder,
  Settings as SettingsIcon,
} from 'lucide-react';
import { createElement, useMemo } from 'react';

import { useT } from '@/lib/i18n/client';
import { type AppAction, type AppSubject } from '@/lib/permissions/ability';

/**
 * Organization-settings nav icon: the org Building2 glyph with a small gear
 * badge in the bottom-right corner, marking it as *settings* for the org (vs.
 * the plain gear used for personal settings). The gear sits on a small disc
 * filled with the surrounding surface color so it reads cleanly over the
 * building outline. Accepts the same `{ className, style }` props as a Lucide
 * icon so it drops straight into `NavItem.icon`.
 */
function OrgSettingsIcon({
  className,
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return createElement(
    'span',
    { className: 'relative inline-flex shrink-0' },
    createElement(Building2, { className, style }),
    createElement(
      'span',
      {
        // Disc punches a hole in the building outline so the gear stays legible.
        className:
          'bg-background absolute -right-1 -bottom-1 flex items-center justify-center rounded-full',
        'aria-hidden': true,
      },
      createElement(SettingsIcon, {
        className: 'size-3 shrink-0',
        style,
      }),
    ),
  );
}

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
   * two pinned entries share a prefix (e.g. user vs. organization settings).
   */
  isActivePath?: (pathname: string) => boolean;
}

const PERSONAL_SETTINGS_SEGMENTS = new Set([
  'personal',
  'account',
  'personalization',
]);

function isPersonalSettingsPath(pathname: string, businessId: string): boolean {
  const base = `/dashboard/${businessId}/settings/`;
  if (!pathname.startsWith(base)) return false;
  const next = pathname.slice(base.length).split('/')[0];
  return PERSONAL_SETTINGS_SEGMENTS.has(next);
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
      ],
      pinned: [
        {
          label: tNav('userSettings'),
          to: '/dashboard/$id/settings/personal',
          params: { id: businessId },
          href: `/dashboard/${businessId}/settings/personal`,
          icon: SettingsIcon,
          isActivePath: (pathname) =>
            isPersonalSettingsPath(pathname, businessId),
        },
        {
          label: tNav('orgSettings'),
          to: '/dashboard/$id/settings',
          params: { id: businessId },
          href: `/dashboard/${businessId}/settings`,
          icon: OrgSettingsIcon,
          isActivePath: (pathname) => {
            const base = `/dashboard/${businessId}/settings`;
            if (pathname !== base && !pathname.startsWith(`${base}/`))
              return false;
            return !isPersonalSettingsPath(pathname, businessId);
          },
        },
      ],
    }),
    [businessId, tNav, tKnowledge, tConversations, tProjects],
  );
}
