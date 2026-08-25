'use client';

import { Description } from '@tale/ui/description';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { useAdaptiveHeaderSlots } from '@/app/components/layout/adaptive-header';
import { useIsMobile } from '@/app/hooks/use-is-mobile';
import { cn } from '@/lib/utils/cn';

interface PageActionHeaderProps {
  title?: ReactNode;
  /**
   * Element the title renders as. A `span` by default — the strip is chrome,
   * not content. Pass a heading level when this title IS the page's heading,
   * so the document outline doesn't jump from the area's `h1` straight to the
   * page's section headings.
   */
  titleAs?: 'span' | 'h1' | 'h2' | 'h3';
  description?: ReactNode;
  /**
   * Chrome that belongs next to the page name (version, live/deploy), not
   * in the right-hand action cluster. Portals beside the adaptive-header
   * title on desktop and beside the mobile title slot; falls back to sitting
   * after the local title when those slots are absent.
   */
  identity?: ReactNode;
  /**
   * Right-aligned slot, typically `<EditorActions>`. The wrapper reserves
   * min-width so the layout doesn't shift between empty/loading/loaded
   * action states.
   */
  actions?: ReactNode;
  className?: string;
}

/**
 * Page-level header chrome for non-tabbed editor pages outside the settings
 * area (settings pages carry no page header; their Save/Discard cluster lives
 * in the settings layout header).
 *
 * On desktop this portals identity next to the title, the action cluster into
 * the right of the same row (`AdaptiveHeaderRoot`), and the description onto
 * the row under the name — the SectionHeader pattern: the name is identity,
 * verbs sit opposite, copy sits below rather than beside the buttons. Below
 * `md` (and anywhere the adaptive header is absent) identity follows the
 * mobile title slot when one exists; otherwise this component renders that
 * layout itself, matching `TabNavigation`'s `min-h-13` so tabbed and
 * non-tabbed editors don't bounce.
 */
export function PageActionHeader({
  title,
  titleAs: TitleTag = 'span',
  description,
  identity,
  actions,
  className,
}: PageActionHeaderProps) {
  const slots = useAdaptiveHeaderSlots();
  const isMobile = useIsMobile();
  const actionsEl = slots?.actionsEl ?? null;
  const descriptionEl = slots?.descriptionEl ?? null;
  const identityEl =
    slots === null
      ? null
      : isMobile
        ? slots.identityElMobile
        : slots.identityElDesktop;
  // Inside the dashboard header on desktop the cluster belongs in that
  // strip, even before the slot refs attach — rendering a second row for
  // one frame would flash the unbalanced layout this exists to prevent.
  const portalToDesktop = slots !== null && !isMobile;

  const identityCluster =
    identity !== undefined ? (
      <div className="flex items-center gap-2">{identity}</div>
    ) : null;
  const cluster =
    actions !== undefined ? (
      <div className="flex min-w-[160px] items-center justify-end">
        {actions}
      </div>
    ) : null;
  const copy =
    description !== undefined ? (
      <Description muted className="max-w-prose">
        {description}
      </Description>
    ) : null;

  return (
    <>
      {identityEl !== null && identityCluster !== null
        ? createPortal(identityCluster, identityEl)
        : null}
      {portalToDesktop && actionsEl !== null && cluster !== null
        ? createPortal(cluster, actionsEl)
        : null}
      {portalToDesktop && descriptionEl !== null && copy !== null
        ? createPortal(copy, descriptionEl)
        : null}
      {!portalToDesktop && (
        <div
          className={cn(
            'border-border bg-background flex min-h-13 flex-col justify-center gap-1 border-b px-4 py-2',
            className,
          )}
        >
          {(title !== undefined ||
            cluster !== null ||
            (identityCluster !== null && identityEl === null)) && (
            <div className="flex min-w-0 items-center gap-3">
              {title !== undefined ? (
                <TitleTag className="text-foreground min-w-0 flex-1 truncate text-sm font-medium">
                  {title}
                </TitleTag>
              ) : (
                <div className="min-w-0 flex-1" />
              )}
              {identityEl === null ? identityCluster : null}
              {cluster}
            </div>
          )}
          {copy}
        </div>
      )}
    </>
  );
}
