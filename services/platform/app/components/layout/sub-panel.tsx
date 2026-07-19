import type { ReactNode } from 'react';

import { cn } from '@/lib/utils/cn';

/**
 * Fixed panel widths. `default` (14rem / 224px) matches the expanded app
 * sidebar so a sub-panel reads as its sibling; `wide` (16rem / 256px) gives
 * list-heavy panels (chat history) the extra room their rows need.
 */
const WIDTH_CLASSES = {
  default: 'w-56',
  wide: 'w-64',
} as const;

export interface SubPanelProps {
  /** Landmark element. Use `nav` when the panel is purely navigation. */
  as?: 'div' | 'nav' | 'aside';
  /** Accessible name for the landmark. */
  ariaLabel?: string;
  /** Element id, e.g. as an `aria-controls` target for a panel toggle. */
  id?: string;
  width?: keyof typeof WIDTH_CLASSES;
  className?: string;
  children: ReactNode;
}

/**
 * The second-level side panel that sections mount inside their route layout,
 * to the left of their content — the settings rail and the chat sub-panel are
 * the two instances. One shared container so every section's sub-panel agrees
 * on chrome: fixed width, right border, `bg-background`, column flow, and
 * hidden below `md` (small viewports reach the same content through the
 * section's own mobile affordance — the settings overview page, the chat
 * drawer). Content and scroll behaviour stay with the caller: pass a
 * scrollable child, not an overflowing panel.
 */
export function SubPanel({
  as: Component = 'div',
  ariaLabel,
  id,
  width = 'default',
  className,
  children,
}: SubPanelProps) {
  return (
    <Component
      aria-label={ariaLabel}
      id={id}
      className={cn(
        'bg-background border-border hidden shrink-0 flex-col overflow-hidden border-r md:flex',
        WIDTH_CLASSES[width],
        className,
      )}
    >
      {children}
    </Component>
  );
}
