'use client';

/**
 * The design-conformance chrome for connected registry blocks — new blocks
 * compose these two pieces instead of hand-rolling frames or state screens, so
 * every block looks like the issue desk by construction:
 *
 * - `BlockFrame` — the titled card (icon + title + optional description + a
 *   right-aligned actions slot) over the registry `Section` (itself the
 *   `@tale/ui` Card surface). Title/description are literal display strings
 *   rendered verbatim (UI translations are platform-owned).
 * - `BindingStates` — the framing states every bound block shares, in
 *   precedence order: `blocked` (path not allowlisted), `needsConfig`
 *   (unresolved `$config:`), `needsProject` (unresolved `$projectId` — open
 *   from a bound project), `awaitingState` (unresolved `$state.<key>` —
 *   neutral "select something" placeholder), `loading` (skeleton). Visuals are
 *   extracted VERBATIM from Collection/ExternalList so existing views don't
 *   shift; those two blocks converge onto this in a follow-up.
 */
import { SkeletonText } from '@tale/ui/skeleton';
import { Text } from '@tale/ui/text';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { useT } from '@/lib/i18n/client';

import { Section } from './connected/section';

export interface BlockFrameProps {
  /** Literal display string, rendered verbatim. */
  title?: string;
  /** Literal display string, rendered verbatim. */
  description?: string;
  icon?: LucideIcon;
  /** Right-aligned header slot (filters, refresh, add-actions). */
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function BlockFrame({
  title,
  description,
  icon,
  actions,
  children,
  className,
}: BlockFrameProps) {
  return (
    <Section
      title={title}
      description={description}
      icon={icon}
      action={actions}
      className={className}
    >
      {children}
    </Section>
  );
}

export interface BindingStatesProps {
  /** The bound path is not in the automation's allowlist — nothing was called. */
  blocked?: boolean;
  /** The bound function path, shown in the blocked notice. */
  path?: string;
  /** A `$config:` reference is unset — prompt to configure. */
  needsConfig?: boolean;
  /** A `$projectId` reference is unset — prompt to open from a project. */
  needsProject?: boolean;
  /** A `$state.<key>` reference is unset — neutral selection placeholder. */
  awaitingState?: boolean;
  loading?: boolean;
  /**
   * Rendered while `loading`; defaults to the shared three-line skeleton.
   * For granular masking pass the block's own
   * `<Skeletonize loading>…</Skeletonize>`-wrapped placeholder tree.
   */
  skeleton?: ReactNode;
  children: ReactNode;
}

/**
 * Renders the first applicable framing state, else the loaded content. Sits
 * INSIDE a `BlockFrame` (or a block's own `Section`) — it owns the body only,
 * so the title/actions chrome stays visible in every state.
 */
export function BindingStates({
  blocked,
  path,
  needsConfig,
  needsProject,
  awaitingState,
  loading,
  skeleton,
  children,
}: BindingStatesProps) {
  const { t } = useT('automations');
  if (blocked) {
    return (
      <Text variant="error">{t('binding.blocked', { path: path ?? '' })}</Text>
    );
  }
  if (needsConfig) {
    return <Text variant="muted">{t('list.needsConfig')}</Text>;
  }
  if (needsProject) {
    return <Text variant="muted">{t('list.needsProject')}</Text>;
  }
  if (awaitingState) {
    return <Text variant="muted">{t('binding.awaitingSelection')}</Text>;
  }
  if (loading) {
    return <>{skeleton ?? <SkeletonText lines={3} />}</>;
  }
  return <>{children}</>;
}
