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

import {
  useIntegrationCredentials,
  useIntegrations,
} from '@/app/features/settings/integrations/hooks/queries';
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
  /** The credential row for this slug exists and is active. */
  ready: boolean;
}

export interface IntegrationReadiness {
  /** slug → ready (an active credential row exists for this slug). */
  readyBySlug: Map<string, boolean>;
  /** slug → human-readable title from the integration's config.json. */
  titleBySlug: Map<string, string>;
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

/**
 * Per-slug readiness + title lookup. Used to gate any composer surface that
 * lets the user pick an agent or toggle a capability — an unready integration
 * should never silently fail at run time.
 */
export function useIntegrationReadiness(
  organizationId: string,
): IntegrationReadiness {
  const { integrations } = useIntegrations('default');
  const { data: credentials } = useIntegrationCredentials(organizationId);

  return useMemo(() => {
    const activeBySlug = new Map<string, boolean>();
    if (Array.isArray(credentials)) {
      for (const cred of credentials) {
        if (!isRecord(cred)) continue;
        const slug = typeof cred.slug === 'string' ? cred.slug : undefined;
        if (!slug) continue;
        activeBySlug.set(
          slug,
          typeof cred.isActive === 'boolean' && cred.isActive,
        );
      }
    }
    const readyBySlug = new Map<string, boolean>();
    const titleBySlug = new Map<string, string>();
    for (const integration of integrations) {
      if (!isRecord(integration)) continue;
      const slug =
        typeof integration.slug === 'string' ? integration.slug : undefined;
      if (!slug) continue;
      readyBySlug.set(slug, activeBySlug.get(slug) === true);
      if (typeof integration.title === 'string' && integration.title) {
        titleBySlug.set(slug, integration.title);
      }
    }
    return { readyBySlug, titleBySlug };
  }, [integrations, credentials]);
}

/**
 * Returns the slugs of integrations this agent declares but that aren't ready.
 * Empty array means the agent is safe to use.
 */
export function getAgentMissingIntegrations(
  agent: { integrationBindings?: string[] },
  readiness: IntegrationReadiness,
): string[] {
  if (!agent.integrationBindings?.length) return [];
  return agent.integrationBindings.filter(
    (slug) => readiness.readyBySlug.get(slug) !== true,
  );
}

export function useComposerCapabilities(
  organizationId: string,
): CapabilityEntry[] {
  const { integrations } = useIntegrations('default');
  const readiness = useIntegrationReadiness(organizationId);

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
        ready: readiness.readyBySlug.get(slug) === true,
      });
    }
    entries.sort((a, b) => {
      if (a.order !== b.order) return a.order - b.order;
      return a.label.localeCompare(b.label);
    });
    return entries;
  }, [integrations, readiness]);
}
