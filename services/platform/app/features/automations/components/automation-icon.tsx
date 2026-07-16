'use client';

/**
 * An automation's tile glyph + label chips. Shared by the catalog grid card
 * and its pre-install detail panel (`automation-panel.tsx`) so both surfaces
 * render an automation's icon/labels identically — split out of
 * `automations-grid.tsx` so the panel can reuse them without importing the
 * grid (which imports the panel back, to open it from a card click).
 */
import { LayoutGrid, type LucideIcon } from 'lucide-react';
import { DynamicIcon, type IconName, iconNames } from 'lucide-react/dynamic';
import type { ReactNode } from 'react';

import { CatalogLabels } from '@/app/components/catalog/catalog-labels';
import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { cn } from '@/lib/utils/cn';

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

/**
 * A corner glyph pinned to an automation's icon tile — the marker every surface
 * uses for a BUNDLE (`Package`) and for a CUSTOM, uploaded automation
 * (`UserPen`). Deliberately NOT a title-row chip: the badge slot stays reserved
 * for INSTALL state alone. `label` is both the hover tooltip and the accessible
 * name (via an `sr-only` twin), because the glyph itself is decorative — the
 * Radix tooltip only mounts its content on hover, so it can't carry the name.
 */
export function AutomationMarker({
  icon: Icon,
  label,
  className,
  children,
}: {
  icon: LucideIcon;
  label: string;
  /** Extra classes for the positioned wrapper (e.g. `shrink-0` in a flex row). */
  className?: string;
  children: ReactNode;
}) {
  return (
    <Tooltip content={label} side="top">
      <div className={cn('relative', className)}>
        {children}
        <span className="bg-background ring-border absolute -right-1.5 -bottom-1.5 rounded-md p-0.5 ring-1">
          <Icon aria-hidden="true" className="text-muted-foreground size-3" />
          <span className="sr-only">{label}</span>
        </span>
      </div>
    </Tooltip>
  );
}

/** Manifest `labels` on catalog cards and the panel/page header — the shared
 *  {@link CatalogLabels} renderer under the automation-feature name. */
export function AutomationLabels({
  labels,
  tone = 'badge',
}: {
  labels?: string[];
  tone?: 'badge' | 'quiet';
}) {
  return <CatalogLabels labels={labels} tone={tone} />;
}
