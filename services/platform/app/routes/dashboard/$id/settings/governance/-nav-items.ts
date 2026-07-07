import {
  AlertOctagon,
  Brain,
  ClipboardList,
  Scale,
  ScrollText,
  Shield,
  ShieldAlert,
  Terminal,
  Trash2,
  type LucideIcon,
} from 'lucide-react';

const GOVERNANCE_GROUPS = [
  'content-models',
  'policies-limits',
  'run-code-policy',
  'security-monitoring',
  'guardrails',
  'logs',
  'legal-hold',
  'data-subject-requests',
  'trash',
] as const;
type GovernanceGroup = (typeof GOVERNANCE_GROUPS)[number];

interface GovernanceNavItem {
  slug: GovernanceGroup;
  labelKey:
    | 'contentAndModels'
    | 'policiesAndLimits'
    | 'runCodePolicy'
    | 'securityAndMonitoring'
    | 'guardrails'
    | 'logs'
    | 'legalHold'
    | 'dataSubjectRequests'
    | 'trash';
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
  { slug: 'logs', labelKey: 'logs', icon: ScrollText },
  { slug: 'legal-hold', labelKey: 'legalHold', icon: AlertOctagon },
  {
    slug: 'data-subject-requests',
    labelKey: 'dataSubjectRequests',
    icon: ClipboardList,
  },
  { slug: 'trash', labelKey: 'trash', icon: Trash2 },
];
