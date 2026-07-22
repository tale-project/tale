'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { cn } from '@/lib/utils/cn';

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
  return (
    node.childElementCount > 0 || (node.textContent?.trim().length ?? 0) > 0
  );
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
        className="border-border bg-background pointer-events-auto flex w-fit items-center gap-2 rounded-xl border px-3 py-2 shadow-md"
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
