import {
  BarChart3,
  MessagesSquare,
  TrendingUp,
  Workflow,
  type LucideIcon,
} from 'lucide-react';

interface MetricsNavItem {
  slug: 'usage' | 'feedback' | 'automations' | 'projects';
  labelKey: 'usage' | 'feedback' | 'automations' | 'projects';
  icon: LucideIcon;
}

/**
 * Metrics sub-section catalog. Shared between the section's own route (mobile
 * tab strip) and the unified settings rail (inline expansion on desktop), so
 * the order and labels stay in one place.
 */
export const METRICS_NAV_ITEMS: MetricsNavItem[] = [
  { slug: 'usage', labelKey: 'usage', icon: TrendingUp },
  { slug: 'feedback', labelKey: 'feedback', icon: MessagesSquare },
  { slug: 'automations', labelKey: 'automations', icon: Workflow },
  { slug: 'projects', labelKey: 'projects', icon: BarChart3 },
];
