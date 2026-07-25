import {
  Activity,
  BarChart3,
  MessagesSquare,
  TerminalSquare,
  TrendingUp,
  Workflow,
  type LucideIcon,
} from 'lucide-react';

type MetricsNavSlug =
  | 'usage'
  | 'feedback'
  | 'chat-health'
  | 'external-turns'
  | 'automations'
  | 'projects';

interface MetricsNavItem {
  slug: MetricsNavSlug;
  labelKey: MetricsNavSlug;
  icon: LucideIcon;
}

/**
 * Metrics sub-section catalog. Shared between the section's own route (mobile
 * tab strip) and the unified settings rail (inline expansion on desktop), so
 * the order and labels stay in one place. `slug` is the route filename; the
 * label resolves to `metrics.groups.<labelKey>`.
 */
export const METRICS_NAV_ITEMS: MetricsNavItem[] = [
  { slug: 'usage', labelKey: 'usage', icon: TrendingUp },
  { slug: 'feedback', labelKey: 'feedback', icon: MessagesSquare },
  { slug: 'chat-health', labelKey: 'chat-health', icon: Activity },
  { slug: 'external-turns', labelKey: 'external-turns', icon: TerminalSquare },
  { slug: 'automations', labelKey: 'automations', icon: Workflow },
  { slug: 'projects', labelKey: 'projects', icon: BarChart3 },
];
