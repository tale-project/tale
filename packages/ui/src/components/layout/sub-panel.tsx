import { cn } from '@tale/ui/cn';
import type { ReactNode } from 'react';

/**
 * Fixed panel widths. `default` (14rem / 224px) matches the expanded app
 * sidebar so a sub-panel reads as its sibling; `wide` (16rem / 256px) gives
 * list-heavy panels the extra room their rows need; `list` (17.5rem / 280px)
 * is for panels whose rows carry two lines — a title and a line of context.
 */
const WIDTH_CLASSES = {
  default: 'w-56',
  wide: 'w-64',
  list: 'w-70',
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

export interface SubPanelHeaderProps {
  /** The section's name — the panel's heading. */
  title: ReactNode;
  /** Trailing controls (the section's primary action, a collapse toggle). */
  actions?: ReactNode;
  className?: string;
}

/**
 * The head of every section panel: the section's name and its one or two
 * actions in the same `h-13` row as a page header, border included, so the
 * panel's first line and the page's header line meet as one rule across the
 * screen. One header for every panel — Home, Settings, and whatever section
 * grows a panel next — so moving between sections never changes the frame.
 */
export function SubPanelHeader({
  title,
  actions,
  className,
}: SubPanelHeaderProps) {
  return (
    <div
      className={cn(
        'border-border flex h-13 shrink-0 items-center justify-between gap-2 border-b pr-2.5 pl-4',
        className,
      )}
    >
      <h2 className="text-foreground min-w-0 truncate text-[15px] font-semibold tracking-tight">
        {title}
      </h2>
      {actions !== undefined && (
        <div className="flex shrink-0 items-center gap-0.5">{actions}</div>
      )}
    </div>
  );
}
