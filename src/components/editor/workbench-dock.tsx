'use client';

import * as TabsPrimitive from '@radix-ui/react-tabs';
import { Card } from '@tale/ui/card';
import { useT } from '@tale/ui/i18n/client';
import { IconButton } from '@tale/ui/icon-button';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogTitle,
} from '@tale/ui/responsive-dialog';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import {
  forwardRef,
  useId,
  useImperativeHandle,
  useRef,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

import { cn } from '../../lib/cn';
import { isEscapeClaimed } from '../overlays/claims-escape';

/** One panel of the dock: a list of problems, a run of tests. */
export interface WorkbenchDockPanel {
  /** Stable: the tab's value, and what `activeId` names. */
  id: string;
  /** The panel's title, or its tab's label. */
  label: string;
  /** Beside the label: a count in words ("2 errors"). Part of a tab's name. */
  badge?: ReactNode;
  content: ReactNode;
  /** The panel's own controls in the header (a filter, "Run all"), shown
   * while it is the active one. */
  actions?: ReactNode;
}

export interface WorkbenchDockHandle {
  /** Focuses the active tab — or, with one panel, the dock itself. */
  focus(): void;
}

export interface WorkbenchDockProps {
  /** One panel shows a title; two or more show a tab list. */
  panels: readonly WorkbenchDockPanel[];
  activeId: string;
  onActiveChange?: (id: string) => void;
  /**
   * Hides the dock — from Close, or Escape anywhere inside it. The host
   * returns focus to the control that opened it.
   */
  onClose: () => void;
  /** Close's name: the specific verb ("Hide problems"). */
  closeLabel: string;
  /** The taller of two heights; switched at once, never animated. */
  expanded?: boolean;
  /** Present, the header offers "Expand panel" / "Collapse panel". */
  onExpandedChange?: (next: boolean) => void;
  /** The region's id — the opener's `aria-controls`. */
  id?: string;
  /** Names the region when the panels are tabs; defaults to the active
   * panel's label. One panel names it by its title. */
  'aria-label'?: string;
  className?: string;
}

/** Rises into place once; reduced motion shows it at once. */
const ENTER =
  'animate-in fade-in slide-in-from-bottom-2 duration-[var(--duration-standard)] ease-[var(--ease-out-quint)] motion-reduce:animate-none';

// A contrast theme shows a transparent border: an idle tab's line takes the
// page's own colour, the open tab's the system's selection colour.
const TAB_TRIGGER =
  'text-muted-foreground hover:text-foreground data-[state=active]:text-foreground data-[state=active]:border-primary focus-visible:ring-ring inline-flex min-h-9 items-center gap-2 border-b-2 border-transparent px-1 text-sm font-medium whitespace-nowrap focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset forced-colors:[border-bottom-color:Canvas] forced-colors:data-[state=active]:[border-bottom-color:Highlight]';

/**
 * A panel docked under an editor's canvas — Problems, Tests — spanning the
 * canvas column only, so an inspector beside it keeps its height. A header
 * (the title or the tabs, the active panel's controls, Expand and Close)
 * over a body that scrolls on its own. Escape anywhere inside closes it,
 * unless a widget there has claimed Escape or an open menu took it.
 *
 * Below the width where it fits, show the panel in a `WorkbenchSheet`.
 */
export const WorkbenchDock = forwardRef<
  WorkbenchDockHandle,
  WorkbenchDockProps
>(function WorkbenchDock(
  {
    panels,
    activeId,
    onActiveChange,
    onClose,
    closeLabel,
    expanded = false,
    onExpandedChange,
    id,
    'aria-label': ariaLabel,
    className,
  },
  ref,
) {
  const { t } = useT('workbenchDock');
  const titleId = useId();
  const regionRef = useRef<HTMLElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const active = panels.find((panel) => panel.id === activeId) ?? panels[0];
  const tabbed = panels.length > 1;

  useImperativeHandle(
    ref,
    () => ({
      focus() {
        const tab = tabsRef.current?.querySelector<HTMLElement>(
          '[role="tab"][data-state="active"]',
        );
        (tab ?? regionRef.current)?.focus();
      },
    }),
    [],
  );

  if (active === undefined) return null;

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape') return;
    // An open menu dismissed itself with this Escape, or a widget inside
    // (a code editor's completion list) needs it: the dock stays.
    if (event.defaultPrevented || isEscapeClaimed(event.nativeEvent)) return;
    event.preventDefault();
    onClose();
  };

  const body = cn(
    'border-border min-h-0 overflow-y-auto border-t',
    expanded ? 'max-h-[min(60vh,32rem)]' : 'max-h-56',
  );

  const controls = (
    <>
      {active.actions}
      <span className="flex-1" aria-hidden="true" />
      {onExpandedChange !== undefined && (
        <IconButton
          icon={expanded ? ChevronDown : ChevronUp}
          size="sm"
          variant="ghost"
          aria-label={t(expanded ? 'collapse' : 'expand')}
          onClick={() => onExpandedChange(!expanded)}
        />
      )}
      <IconButton
        icon={X}
        size="sm"
        variant="ghost"
        aria-label={closeLabel}
        onClick={onClose}
      />
    </>
  );

  return (
    // oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- keydown boundary for the whole dock (Escape closes it), not a control; a named section is a region
    <section
      ref={regionRef}
      id={id}
      tabIndex={-1}
      data-slot="workbench-dock"
      data-expanded={expanded}
      {...(tabbed
        ? { 'aria-label': ariaLabel ?? active.label }
        : { 'aria-labelledby': titleId })}
      onKeyDown={onKeyDown}
      className={cn(
        'border-border bg-background focus-visible:ring-ring flex min-h-24 shrink flex-col border-t focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset',
        ENTER,
        className,
      )}
    >
      {tabbed ? (
        <TabsPrimitive.Root
          value={active.id}
          onValueChange={onActiveChange}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="flex min-h-9 shrink-0 flex-wrap items-center gap-x-2 gap-y-1 px-3">
            <TabsPrimitive.List
              ref={tabsRef}
              aria-label={ariaLabel}
              className="flex min-w-0 items-center gap-3"
            >
              {panels.map((panel) => (
                <TabsPrimitive.Trigger
                  key={panel.id}
                  value={panel.id}
                  className={TAB_TRIGGER}
                >
                  {panel.label}
                  {panel.badge !== undefined && (
                    <span className="text-muted-foreground text-xs font-normal tabular-nums">
                      {panel.badge}
                    </span>
                  )}
                </TabsPrimitive.Trigger>
              ))}
            </TabsPrimitive.List>
            {controls}
          </div>
          {panels.map((panel) => (
            <TabsPrimitive.Content
              key={panel.id}
              value={panel.id}
              // Kept mounted, so a panel keeps its scroll, its filter and
              // its current row while another is shown.
              forceMount
              className={cn(
                body,
                'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset data-[state=inactive]:hidden',
              )}
            >
              {panel.content}
            </TabsPrimitive.Content>
          ))}
        </TabsPrimitive.Root>
      ) : (
        <>
          <div className="flex min-h-9 shrink-0 flex-wrap items-center gap-x-2 gap-y-1 px-3 py-1">
            <h2 id={titleId} className="text-foreground text-sm font-medium">
              {active.label}
            </h2>
            {active.badge !== undefined && (
              <span className="text-muted-foreground text-xs tabular-nums">
                {active.badge}
              </span>
            )}
            {controls}
          </div>
          <div className={body}>{active.content}</div>
        </>
      )}
    </section>
  );
});

export interface WorkbenchSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** A line under the title: the counts in words. */
  description?: ReactNode;
  /** The panel's own controls, between the title and the content. */
  actions?: ReactNode;
  /** Close's name; the shared "Close" when left out. */
  closeLabel?: string;
  /** Call `event.preventDefault()` to move focus yourself as the sheet
   * opens — onto a list's current row. */
  onOpenAutoFocus?: (event: Event) => void;
  /** Leave focus where the close puts it: the sheet closed because the
   * reader went somewhere else (a field in another sheet). */
  preventCloseAutoFocus?: boolean;
  children: ReactNode;
}

/**
 * A dock's panel where there is no room under the canvas: a dialog on a
 * tablet, a drawer on a phone. The title and its line, the panel's
 * controls, and the content in a card that scrolls on its own.
 */
export function WorkbenchSheet({
  open,
  onOpenChange,
  title,
  description,
  actions,
  closeLabel,
  onOpenAutoFocus,
  preventCloseAutoFocus,
  children,
}: WorkbenchSheetProps) {
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent
        closeLabel={closeLabel}
        className="flex max-h-[85dvh] flex-col"
        preventCloseAutoFocus={preventCloseAutoFocus}
        onOpenAutoFocus={onOpenAutoFocus}
      >
        {/* One column with its own spacing, so the phone's drawer and the
            tablet's dialog (which spaces its children itself) lay the sheet
            out alike; only the content scrolls. */}
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <div className="flex flex-col gap-1 pr-8">
            <ResponsiveDialogTitle className="text-base font-semibold">
              {title}
            </ResponsiveDialogTitle>
            {description !== undefined && (
              <ResponsiveDialogDescription className="text-muted-foreground text-sm tabular-nums">
                {description}
              </ResponsiveDialogDescription>
            )}
          </div>
          {actions}
          <Card padding="none" className="min-h-0 overflow-y-auto">
            {children}
          </Card>
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
