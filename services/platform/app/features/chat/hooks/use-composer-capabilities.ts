import {
  Bot,
  Circle,
  Globe,
  ImagePlus,
  Telescope,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { useMemo } from 'react';

import { useIntegrations } from '@/app/features/settings/integrations/hooks/queries';
import { isRecord } from '@/lib/utils/type-guards';

const ICON_MAP: Record<string, LucideIcon> = {
  telescope: Telescope,
  globe: Globe,
  bot: Bot,
  wrench: Wrench,
  image: ImagePlus,
  circle: Circle,
};

export function resolveCapabilityIcon(name: string | undefined): LucideIcon {
  if (!name) return Circle;
  return ICON_MAP[name] ?? Circle;
}

export interface CapabilityEntry {
  slug: string;
  label: string;
  tooltip?: string;
  icon: LucideIcon;
  order: number;
  installed: boolean;
}

function hasExposeAsCapability(value: unknown): value is {
  label: string;
  icon?: string;
  tooltip?: string;
  order?: number;
} {
  if (!isRecord(value)) return false;
  const label = value.label;
  return typeof label === 'string' && label.length > 0;
}

export function useComposerCapabilities(): CapabilityEntry[] {
  const { integrations } = useIntegrations('default');

  return useMemo<CapabilityEntry[]>(() => {
    if (!integrations) return [];
    const entries: CapabilityEntry[] = [];
    for (const integration of integrations) {
      if (!isRecord(integration)) continue;
      const slug =
        typeof integration.slug === 'string' ? integration.slug : undefined;
      if (!slug) continue;
      const exposure = hasExposeAsCapability(integration.exposeAsCapability)
        ? integration.exposeAsCapability
        : null;
      if (!exposure) continue;
      entries.push({
        slug,
        label: exposure.label,
        tooltip: exposure.tooltip,
        icon: resolveCapabilityIcon(exposure.icon),
        order: typeof exposure.order === 'number' ? exposure.order : 100,
        installed: integration.installed === true,
      });
    }
    entries.sort((a, b) => {
      if (a.order !== b.order) return a.order - b.order;
      return a.label.localeCompare(b.label);
    });
    return entries;
  }, [integrations]);
}
