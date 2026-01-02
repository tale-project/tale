'use client';

import {
  MessageCircle,
  CircleCheck,
  Inbox,
  BrainIcon,
  Network,
} from 'lucide-react';
import { useT } from '@/lib/i18n';

export interface NavItem {
  label: string;
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

  return [
    {
      label: tNav('chatWithAI'),
      href: `/dashboard/${businessId}/chat`,
      icon: MessageCircle,
    },
    {
      label: tNav('conversations'),
      href: `/dashboard/${businessId}/conversations/open`,
      icon: Inbox,
      subItems: [
        {
          label: tConversations('status.open'),
          href: `/dashboard/${businessId}/conversations/open`,
        },
        {
          label: tConversations('status.closed'),
          href: `/dashboard/${businessId}/conversations/closed`,
        },
        {
          label: tConversations('status.spam'),
          href: `/dashboard/${businessId}/conversations/spam`,
        },
        {
          label: tConversations('status.archived'),
          href: `/dashboard/${businessId}/conversations/archived`,
        },
      ],
    },
    {
      label: tNav('knowledge'),
      href: `/dashboard/${businessId}/documents`,
      icon: BrainIcon,
      subItems: [
        {
          label: tKnowledge('toneOfVoice'),
          href: `/dashboard/${businessId}/tone-of-voice`,
        },
        {
          label: tKnowledge('documents'),
          href: `/dashboard/${businessId}/documents`,
        },
        {
          label: tKnowledge('websites'),
          href: `/dashboard/${businessId}/websites`,
        },
        {
          label: tKnowledge('products'),
          href: `/dashboard/${businessId}/products`,
        },
        {
          label: tKnowledge('customers'),
          href: `/dashboard/${businessId}/customers`,
        },
        {
          label: tKnowledge('vendors'),
          href: `/dashboard/${businessId}/vendors`,
        },
      ],
    },
    {
      label: tNav('approvals'),
      href: `/dashboard/${businessId}/approvals/pending`,
      icon: CircleCheck,
    },
    {
      label: tNav('automations'),
      href: `/dashboard/${businessId}/automations`,
      icon: Network,
      roles: ['admin', 'developer'],
    },
  ];
}

export const hasRequiredRole = (
  userRole?: string | null,
  requiredRoles?: string[],
): boolean => {
  if (!requiredRoles || requiredRoles.length === 0) return true;
  if (!userRole) return false;
  const ur = userRole.toLowerCase();
  const rr = requiredRoles.map((r) => r.toLowerCase());
  return rr.includes(ur);
};
