import {
  Bot,
  ChartColumn,
  Code,
  Crown,
  FileText,
  GitPullRequest,
  Headphones,
  ImagePlus,
  ListFilter,
  Megaphone,
  Palette,
  Plug,
  Scale,
  Shield,
  Telescope,
  Terminal,
  TrendingUp,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import type { ComponentType } from 'react';

import { ClaudeIcon } from '@/app/components/icons/claude-icon';
import { resolveCapabilityIcon } from '@/app/features/chat/hooks/use-composer-capabilities';

type BrandIcon = ComponentType<{ className?: string }>;

export type AgentCatalogIcon =
  | { kind: 'brand'; Icon: BrandIcon }
  | { kind: 'lucide'; Icon: LucideIcon };

const LABEL_ICON: Record<string, LucideIcon> = {
  engineering: Code,
  creative: Palette,
  research: Telescope,
  analytics: ChartColumn,
  automation: Workflow,
  integrations: Plug,
  support: Headphones,
  content: FileText,
  marketing: Megaphone,
  design: Palette,
  executive: Crown,
  sales: TrendingUp,
  security: Shield,
  quality: Shield,
  'code review': GitPullRequest,
  triage: ListFilter,
  legal: Scale,
};

/** First matching catalog label → Lucide icon for workforce / chat agents. */
function resolveLabelIcon(labels: string[]): LucideIcon | undefined {
  for (const label of labels) {
    const icon = LABEL_ICON[label.toLowerCase()];
    if (icon) return icon;
  }
  return undefined;
}

/**
 * One resolver for agent catalog tiles — reuses composer capability icons,
 * brand marks for the Claude Code product agent, and label heuristics for the
 * rest. `agentKind: claude-code` is a runtime (Software Developer uses it too);
 * the Anthropic mark is only for agents whose slug is the Claude Code product.
 */
export function resolveAgentCatalogIcon(agent: {
  slug: string;
  agentKind?: string;
  composerModeIcon?: string;
  primaryBehavior?: string;
  labels: string[];
}): AgentCatalogIcon {
  if (isClaudeCodeProductSlug(agent.slug)) {
    return { kind: 'brand', Icon: ClaudeIcon };
  }

  if (agent.composerModeIcon) {
    return {
      kind: 'lucide',
      Icon: resolveCapabilityIcon(agent.composerModeIcon),
    };
  }

  if (agent.primaryBehavior === 'image-generation') {
    return { kind: 'lucide', Icon: ImagePlus };
  }

  if (agent.agentKind === 'opencode') {
    return { kind: 'lucide', Icon: Terminal };
  }

  const labelIcon = resolveLabelIcon(agent.labels);
  if (labelIcon) return { kind: 'lucide', Icon: labelIcon };

  return { kind: 'lucide', Icon: Bot };
}

/** Slug identifies the Claude Code chat product — not every claude-code runtime. */
function isClaudeCodeProductSlug(slug: string): boolean {
  const base = slug.includes('/') ? slug.split('/').pop()! : slug;
  return base === 'claude-code' || base.startsWith('claude-code-');
}

export type AgentCatalogRosterStatus = 'available' | 'enabled' | 'disabled';

/** Dot colour on the icon tile — decorative; callers expose text status separately. */
export function rosterStatusDotClass(status: AgentCatalogRosterStatus): string {
  switch (status) {
    case 'enabled':
      return 'bg-success';
    case 'disabled':
      return 'bg-warning';
    default:
      return 'bg-muted-foreground/50';
  }
}

export function rosterStatusFromEntry(entry: {
  installed: boolean;
  enabled: boolean;
}): AgentCatalogRosterStatus {
  if (!entry.installed) return 'available';
  if (entry.enabled) return 'enabled';
  return 'disabled';
}
