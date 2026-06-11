import {
  AlertOctagon,
  Brain,
  ClipboardList,
  MessagesSquare,
  Scale,
  ScrollText,
  Shield,
  ShieldAlert,
  Terminal,
  Trash2,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react';

export const GOVERNANCE_GROUPS = [
  'content-models',
  'policies-limits',
  'run-code-policy',
  'security-monitoring',
  'guardrails',
  'audit-logs',
  'usage',
  'legal-hold',
  'data-subject-requests',
  'trash',
  'feedback',
] as const;
export type GovernanceGroup = (typeof GOVERNANCE_GROUPS)[number];

export interface GovernanceNavItem {
  slug: GovernanceGroup;
  labelKey:
    | 'contentAndModels'
    | 'policiesAndLimits'
    | 'runCodePolicy'
    | 'securityAndMonitoring'
    | 'guardrails'
    | 'auditLogs'
    | 'usage'
    | 'legalHold'
    | 'dataSubjectRequests'
    | 'trash'
    | 'feedback';
  icon: LucideIcon;
}

/**
 * Governance sub-section catalog. Shared between the section's own route
 * (mobile tab strip) and the unified settings rail (inline expansion on
 * desktop), so the order and labels stay in one place.
 */
export const GOVERNANCE_NAV_ITEMS: GovernanceNavItem[] = [
  { slug: 'content-models', labelKey: 'contentAndModels', icon: Brain },
  { slug: 'policies-limits', labelKey: 'policiesAndLimits', icon: Scale },
  { slug: 'run-code-policy', labelKey: 'runCodePolicy', icon: Terminal },
  {
    slug: 'security-monitoring',
    labelKey: 'securityAndMonitoring',
    icon: ShieldAlert,
  },
  { slug: 'guardrails', labelKey: 'guardrails', icon: Shield },
  { slug: 'audit-logs', labelKey: 'auditLogs', icon: ScrollText },
  { slug: 'usage', labelKey: 'usage', icon: TrendingUp },
  { slug: 'legal-hold', labelKey: 'legalHold', icon: AlertOctagon },
  {
    slug: 'data-subject-requests',
    labelKey: 'dataSubjectRequests',
    icon: ClipboardList,
  },
  { slug: 'trash', labelKey: 'trash', icon: Trash2 },
  { slug: 'feedback', labelKey: 'feedback', icon: MessagesSquare },
];
