'use client';

import { cn } from '@tale/ui/cn';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

interface MobileFloatingActionsProps {
  children: ReactNode;
  className?: string;
}

/** CSS custom property consumed by `PageLayout` for bottom scroll clearance. */
export const MOBILE_FLOATING_ACTIONS_PAD_VAR = '--mobile-floating-actions-pad';

/**
 * Clears the floating dock (≈3rem) plus a gap so page content can scroll
 * past it. Applied only while a dock with real actions is visible.
 */
export const MOBILE_FLOATING_ACTIONS_PAD = '4.5rem';

const PAD_COUNT_ATTR = 'data-floating-actions-pad-count';

function nodeHasContent(node: HTMLElement): boolean {
  // A mounted-but-empty slot (a portal target no page has filled, e.g. the
  // tab strip's actions slot on a tab without actions) is not content —
  // `:empty` here mirrors the slot's own `empty:hidden`.
  return (
    Array.from(node.children).some((child) => !child.matches(':empty')) ||
    (node.textContent?.trim().length ?? 0) > 0
  );
}

/** The controls a dock's rows are made of. */
const DOCK_ACTION_SELECTOR =
  'button, a[href], input, select, textarea, [role="button"], [role="combobox"]';

interface ActionRow {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** The dock's in-flow controls, grouped into the rows they wrapped onto. */
function actionRows(dock: HTMLElement): ActionRow[] {
  const rows: ActionRow[] = [];
  for (const action of dock.querySelectorAll(DOCK_ACTION_SELECTOR)) {
    // A control inside another control is part of that control's box, and an
    // out-of-flow one (a visually hidden input) sits on no row at all.
    if (action.parentElement?.closest(DOCK_ACTION_SELECTOR)) continue;
    const { position } = getComputedStyle(action);
    if (position === 'absolute' || position === 'fixed') continue;
    const box = action.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) continue;
    const row = rows.find(
      (candidate) => box.top < candidate.bottom && box.bottom > candidate.top,
    );
    if (row === undefined) {
      rows.push({
        top: box.top,
        bottom: box.bottom,
        left: box.left,
        right: box.right,
      });
    } else {
      row.top = Math.min(row.top, box.top);
      row.bottom = Math.max(row.bottom, box.bottom);
      row.left = Math.min(row.left, box.left);
      row.right = Math.max(row.right, box.right);
    }
  }
  return rows;
}

/**
 * Shrinks a wrapped dock to its widest row. Once the actions wrap, a `w-fit`
 * flex box takes its whole `max-w`, and the room the rows leave over reads as
 * extra padding beside them; giving back the room every row leaves free keeps
 * the inset even on all four sides. A width that would move an action onto
 * another row is undone, so the dock can only ever get tighter, never reflow.
 */
function hugWidestRow(dock: HTMLElement): void {
  dock.style.removeProperty('width');
  const rows = actionRows(dock);
  if (rows.length < 2) return;
  const frame = dock.getBoundingClientRect();
  const style = getComputedStyle(dock);
  const contentLeft =
    frame.left +
    Number.parseFloat(style.borderLeftWidth) +
    Number.parseFloat(style.paddingLeft);
  const contentRight =
    frame.right -
    Number.parseFloat(style.borderRightWidth) -
    Number.parseFloat(style.paddingRight);
  const spare = Math.floor(
    Math.min(
      ...rows.map((row) => row.left - contentLeft + (contentRight - row.right)),
    ),
  );
  if (spare < 1) return;
  dock.style.width = `${frame.width - spare}px`;
  if (actionRows(dock).length !== rows.length) {
    dock.style.removeProperty('width');
  }
}

function acquirePagePad(): void {
  const root = document.documentElement;
  const next = Number(root.getAttribute(PAD_COUNT_ATTR) ?? '0') + 1;
  root.setAttribute(PAD_COUNT_ATTR, String(next));
  root.style.setProperty(
    MOBILE_FLOATING_ACTIONS_PAD_VAR,
    MOBILE_FLOATING_ACTIONS_PAD,
  );
}

function releasePagePad(): void {
  const root = document.documentElement;
  const next = Number(root.getAttribute(PAD_COUNT_ATTR) ?? '1') - 1;
  if (next <= 0) {
    root.removeAttribute(PAD_COUNT_ATTR);
    root.style.removeProperty(MOBILE_FLOATING_ACTIONS_PAD_VAR);
  } else {
    root.setAttribute(PAD_COUNT_ATTR, String(next));
  }
}

/**
 * Content-width floating dock for page actions on `< md`. Portaled to
 * `document.body` so `position: fixed` is viewport-relative — callers often
 * live under `StickyHeader` (`backdrop-blur`), which would otherwise trap
 * fixed descendants and pin the dock behind the header.
 *
 * Sits bottom-right above the in-flow `MobileBottomNav`. Hidden when children
 * render nothing (slot components still pass a truthy element to the parent).
 * While visible, sets `--mobile-floating-actions-pad` so `PageLayout` adds
 * bottom scroll clearance and the dock does not cover page actions.
 * Callers must single-mount (gate with `useIsMobile`) — never render the same
 * actions both here and in a desktop header/tab slot.
 */
export function MobileFloatingActions({
  children,
  className,
}: MobileFloatingActionsProps) {
  const [mounted, setMounted] = useState(false);
  const [hasContent, setHasContent] = useState(false);
  const innerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return undefined;
    const node = innerRef.current;
    if (!node) return undefined;

    const update = () => setHasContent(nodeHasContent(node));
    update();
    const observer = new MutationObserver(update);
    observer.observe(node, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    return () => observer.disconnect();
  }, [mounted, children]);

  useEffect(() => {
    if (!hasContent) return undefined;
    acquirePagePad();
    return () => releasePagePad();
  }, [hasContent]);

  // Re-hug whenever the rows can change: the actions themselves, the window
  // width they wrap against, and the web fonts their labels measure in.
  useLayoutEffect(() => {
    const node = innerRef.current;
    if (!hasContent || !node) return undefined;
    const fit = () => {
      hugWidestRow(node);
    };
    fit();
    const observer = new MutationObserver(fit);
    observer.observe(node, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    window.addEventListener('resize', fit);
    // Not every environment implements the Font Loading API (jsdom does not).
    const fonts = 'fonts' in document ? document.fonts : undefined;
    fonts?.addEventListener('loadingdone', fit);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', fit);
      fonts?.removeEventListener('loadingdone', fit);
    };
  }, [hasContent]);

  if (!mounted || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className={cn(
        'pointer-events-none fixed right-4 z-40 w-fit md:hidden',
        'bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))]',
        !hasContent && 'hidden',
        className,
      )}
      aria-hidden={!hasContent}
    >
      <div
        ref={innerRef}
        // Capped to the viewport so a wide cluster (an editor's version, run
        // and save verbs) wraps inside the dock instead of running off the
        // left edge; `justify-end` keeps every wrapped row on the anchor side.
        // One `p-2` inset on all four sides — `hugWidestRow` keeps it even
        // once the actions wrap.
        className="border-border bg-background pointer-events-auto flex w-fit max-w-[calc(100vw-2rem)] flex-wrap items-center justify-end gap-2 rounded-xl border p-2 shadow-md"
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
