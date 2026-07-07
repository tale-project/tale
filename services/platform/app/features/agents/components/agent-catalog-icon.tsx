'use client';

import type { TFunction } from 'i18next';

import { CatalogCardIcon } from '@/app/components/catalog/catalog-grid';
import { cn } from '@/lib/utils/cn';

import {
  resolveAgentCatalogIcon,
  rosterStatusDotClass,
  rosterStatusFromEntry,
  type AgentCatalogRosterStatus,
} from '../utils/resolve-agent-catalog-icon';

interface AgentCatalogIconProps {
  slug: string;
  agentKind?: string;
  composerModeIcon?: string;
  primaryBehavior?: string;
  labels: string[];
  installed: boolean;
  enabled: boolean;
  t: TFunction;
}

export function AgentCatalogIcon({
  slug,
  agentKind,
  composerModeIcon,
  primaryBehavior,
  labels,
  installed,
  enabled,
  t,
}: AgentCatalogIconProps) {
  const resolved = resolveAgentCatalogIcon({
    slug,
    agentKind,
    composerModeIcon,
    primaryBehavior,
    labels,
  });
  const status: AgentCatalogRosterStatus = rosterStatusFromEntry({
    installed,
    enabled,
  });
  const statusLabel =
    status === 'enabled'
      ? t('status.enabled')
      : status === 'disabled'
        ? t('status.disabled')
        : t('status.available');

  const glyph =
    resolved.kind === 'brand' ? (
      <resolved.Icon className="size-5" />
    ) : (
      <resolved.Icon className="text-muted-foreground size-5" aria-hidden />
    );

  return (
    <div className="relative shrink-0">
      <CatalogCardIcon>{glyph}</CatalogCardIcon>
      <span
        className={cn(
          'border-bg-base absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full border-2',
          rosterStatusDotClass(status),
        )}
        aria-hidden="true"
      />
      <span className="sr-only">{statusLabel}</span>
    </div>
  );
}
