'use client';

import { useMemo } from 'react';
import {
  MessageCircle,
  CircleCheck,
  Inbox,
  BrainIcon,
  Network,
} from 'lucide-react';
import { useT } from '@/lib/i18n/client';

export interface NavItem {
  label: string;
  to: string;
  params: Record<string, string>;
  href: string;
  icon?: React.ComponentType<{ className?: string }>;
  external?: boolean;
  roles?: string[];
  subItems?: NavItem[];
}

export function useNavigationItems(businessId: string): NavItem[] {
  const { t: tNav } = useT('navigation');
  const { t: tKnowledge } = useT('knowledge');
  const { t: tConversations } = useT('conversations');

  return useMemo(
    (): NavItem[] => [
      {
        label: tNav('chatWithAI'),
        to: '/dashboard/$id/chat',
        params: { id: businessId },
        href: `/dashboard/${businessId}/chat`,
        icon: MessageCircle,
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
            label: tKnowledge('toneOfVoice'),
            to: '/dashboard/$id/tone-of-voice',
            params: { id: businessId },
            href: `/dashboard/${businessId}/tone-of-voice`,
          },
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
        label: tNav('approvals'),
        to: '/dashboard/$id/approvals/$status',
        params: { id: businessId, status: 'pending' },
        href: `/dashboard/${businessId}/approvals/pending`,
        icon: CircleCheck,
      },
      {
        label: tNav('automations'),
        to: '/dashboard/$id/automations',
        params: { id: businessId },
        href: `/dashboard/${businessId}/automations`,
        icon: Network,
        roles: ['admin', 'developer'],
      },
    ],
    [businessId, tNav, tKnowledge, tConversations],
  );
}

export const hasRequiredRole = (
  userRole?: string | null,
  requiredRoles?: string[],
): boolean => {
  if (!requiredRoles || requiredRoles.length === 0) return true;
  if (!userRole) return false;
  const ur = userRole.toLowerCase();
  return requiredRoles.some((r) => r.toLowerCase() === ur);
};
