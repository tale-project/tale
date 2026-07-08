'use client';

/**
 * An automation's tile glyph + label chips. Shared by the catalog grid card
 * and its pre-install detail panel (`automation-panel.tsx`) so both surfaces
 * render an automation's icon/labels identically — split out of
 * `automations-grid.tsx` so the panel can reuse them without importing the
 * grid (which imports the panel back, to open it from a card click).
 */
import { LayoutGrid } from 'lucide-react';
import { DynamicIcon, type IconName, iconNames } from 'lucide-react/dynamic';

import { CatalogLabels } from '@/app/components/catalog/catalog-labels';

import type { AutomationSummary } from '../hooks/use-automations';

const KNOWN_ICON_NAMES = new Set<string>(iconNames);

/** Type-guard narrowing a manifest icon string to a real lucide icon name. */
function isIconName(name: string): name is IconName {
  return KNOWN_ICON_NAMES.has(name);
}

/**
 * An automation's tile glyph: the bundled `icon.svg` (served as a data URI) wins,
 * then the manifest's lucide `icon` name, then the generic LayoutGrid.
 */
export function AutomationIcon({
  automation,
  className,
}: {
  automation: Pick<AutomationSummary, 'iconUrl' | 'icon'>;
  className?: string;
}) {
  if (automation.iconUrl) {
    return <img src={automation.iconUrl} alt="" className={className} />;
  }
  if (automation.icon && isIconName(automation.icon)) {
    return <DynamicIcon name={automation.icon} className={className} />;
  }
  return <LayoutGrid className={className} />;
}

/** Manifest `labels` on catalog cards and the panel/page header — the shared
 *  {@link CatalogLabels} renderer under the automation-feature name. */
export function AutomationLabels({ labels }: { labels?: string[] }) {
  return <CatalogLabels labels={labels} />;
}
