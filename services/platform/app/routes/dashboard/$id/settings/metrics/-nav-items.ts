import {
  BarChart3,
  Bot,
  MessagesSquare,
  TrendingUp,
  Workflow,
  type LucideIcon,
} from 'lucide-react';

interface MetricsNavItem {
  slug: 'usage' | 'feedback' | 'automations' | 'workforce' | 'projects';
  labelKey: 'usage' | 'feedback' | 'automations' | 'workforce' | 'projects';
  icon: LucideIcon;
}

/**
 * Metrics sub-section catalog. Shared between the section's own route (mobile
 * tab strip) and the unified settings rail (inline expansion on desktop).
 */
export const METRICS_NAV_ITEMS: MetricsNavItem[] = [
  { slug: 'usage', labelKey: 'usage', icon: TrendingUp },
  { slug: 'feedback', labelKey: 'feedback', icon: MessagesSquare },
  { slug: 'automations', labelKey: 'automations', icon: Workflow },
  { slug: 'workforce', labelKey: 'workforce', icon: Bot },
  { slug: 'projects', labelKey: 'projects', icon: BarChart3 },
];
