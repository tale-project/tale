import { cn } from '@tale/ui/cn';
import { ChevronDown, type LucideIcon } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

import { LocalizedLink } from '@/app/components/layout/localized-link';
import type { LocalizedRoutePath } from '@/lib/seo/route-paths';

/** Hover intent: brief open delay, short close bridge to reach the panel. */
const OPEN_DELAY_MS = 40;
const CLOSE_DELAY_MS = 120;

export interface NavMenuItemView {
  id: string;
  path?: LocalizedRoutePath;
  /** External href — mutually exclusive with `path`. */
  href?: string;
  label: string;
  description: string;
  icon: LucideIcon;
}

export interface NavMenuProps {
  /** Visible trigger label. */
  label: string;
  /** Whether this menu's panel is open. */
  open: boolean;
  /** Called when the user toggles or dismisses the menu. */
  onOpenChange: (open: boolean) => void;
  items: readonly NavMenuItemView[];
  /** Optional footer link under the item grid. */
  footer?: { path: LocalizedRoutePath; label: string };
  /** Wider panel for denser menus (Resources). */
  columns?: 1 | 2;
}

/**
 * Header disclosure panel — WAI-ARIA disclosure (not `role="menu"`).
 * Click / Esc / outside-close; fine-pointer hover opens with intent delay.
 * Open state is owned by the parent so sibling menus can be exclusive.
 *
 * Motion: soft CSS enter, instant close (no exit animation) — the pattern
 * polished marketing navs use so switching menus never feels laggy.
 */
export function NavMenu({
  label,
  open,
  onOpenChange,
  items,
  footer,
  columns = 2,
}: NavMenuProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const openTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const buttonId = useId();
  const panelId = useId();
  /** One frame after mount so the CSS enter transition can run. */
  const [entered, setEntered] = useState(false);

  const clearTimers = useCallback(() => {
    if (openTimerRef.current) clearTimeout(openTimerRef.current);
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    openTimerRef.current = null;
    closeTimerRef.current = null;
  }, []);

  const close = useCallback(() => {
    clearTimers();
    onOpenChange(false);
  }, [clearTimers, onOpenChange]);

  const openNow = useCallback(() => {
    clearTimers();
    onOpenChange(true);
  }, [clearTimers, onOpenChange]);

  useEffect(() => () => clearTimers(), [clearTimers]);

  useEffect(() => {
    if (!open) {
      setEntered(false);
      return undefined;
    }
    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      setEntered(true);
      return undefined;
    }
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => setEntered(true));
    });
    return () => cancelAnimationFrame(id);
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close();
    };
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);

  /** Hover intent only on fine pointers — touch stays click-to-toggle. */
  const canHoverOpen = () =>
    typeof window !== 'undefined' &&
    window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  const scheduleOpen = () => {
    if (!canHoverOpen()) return;
    clearTimers();
    if (open) return;
    openTimerRef.current = setTimeout(openNow, OPEN_DELAY_MS);
  };

  const scheduleClose = () => {
    if (!canHoverOpen()) return;
    clearTimers();
    closeTimerRef.current = setTimeout(close, CLOSE_DELAY_MS);
  };

  const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' && !open) {
      event.preventDefault();
      openNow();
    }
  };

  return (
    <div
      ref={rootRef}
      className="relative"
      onMouseEnter={scheduleOpen}
      onMouseLeave={scheduleClose}
    >
      <button
        type="button"
        id={buttonId}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          clearTimers();
          onOpenChange(!open);
        }}
        onKeyDown={onTriggerKeyDown}
        className={cn(
          'inline-flex items-center gap-1 text-[13px] font-normal tracking-tight transition-colors duration-150',
          open ? 'text-fg-base' : 'text-fg-muted hover:text-fg-base',
        )}
      >
        {label}
        <ChevronDown
          aria-hidden
          className={cn(
            'size-3.5 transition-transform duration-150 ease-out motion-reduce:transition-none',
            open && 'rotate-180',
          )}
        />
      </button>

      {open ? (
        <div
          id={panelId}
          role="region"
          aria-labelledby={buttonId}
          className={cn(
            'border-border-base bg-surface-site-raised shadow-site-card absolute top-full left-0 z-50 mt-2 rounded-2xl border p-2',
            'origin-top transition-[opacity,transform] duration-150 ease-out motion-reduce:transition-none',
            entered ? 'translate-y-0 opacity-100' : 'translate-y-1 opacity-0',
            columns === 2
              ? 'w-[min(580px,calc(100vw-2rem))]'
              : 'w-[min(320px,calc(100vw-2rem))]',
          )}
        >
          <ul
            role="list"
            className={cn(
              'grid gap-0.5',
              columns === 2 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1',
            )}
          >
            {items.map((item) => (
              <li key={item.id}>
                <NavMenuRow item={item} onNavigate={close} />
              </li>
            ))}
          </ul>
          {footer ? (
            <div className="border-border-base mt-1.5 border-t pt-1.5">
              <LocalizedLink
                to={footer.path}
                onClick={close}
                className="text-fg-muted hover:text-fg-base hover:bg-surface-site-inset block rounded-lg px-3 py-2 text-sm transition-colors"
              >
                {footer.label}
              </LocalizedLink>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function NavMenuRow({
  item,
  onNavigate,
}: {
  item: NavMenuItemView;
  onNavigate: () => void;
}) {
  const Icon = item.icon;
  const body: ReactNode = (
    <>
      <span className="bg-surface-site-deep text-fg-muted shadow-site-inset mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg">
        <Icon aria-hidden className="size-3.5" />
      </span>
      <span className="min-w-0">
        <span className="text-fg-base block text-sm font-medium tracking-tight">
          {item.label}
        </span>
        <span className="text-fg-muted mt-0.5 block text-xs leading-snug">
          {item.description}
        </span>
      </span>
    </>
  );

  const className =
    'hover:bg-surface-site-inset focus-visible:bg-surface-site-inset flex gap-3 rounded-xl px-3 py-2 transition-colors focus-visible:outline-none';

  if (item.href) {
    return (
      <a
        href={item.href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={onNavigate}
        className={className}
      >
        {body}
      </a>
    );
  }

  if (!item.path) return null;

  return (
    <LocalizedLink to={item.path} onClick={onNavigate} className={className}>
      {body}
    </LocalizedLink>
  );
}
