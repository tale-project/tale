'use client';

import { Button } from '@tale/ui/button';
import { ChevronDown } from 'lucide-react';
import {
  type ReactNode,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import { cn } from '@/lib/utils/cn';

/**
 * Caps a region at a max height and, when more content sits below the fold,
 * paints a bottom gradient plus a scroll-down control so the overflow is
 * discoverable without growing the surrounding layout.
 *
 * Each consumer owns its own instance — Projects, Versions, and Runs each
 * scroll independently rather than sharing one viewport.
 */
export function CappedScrollRegion({
  children,
  className,
  contentClassName,
  maxHeightClassName = 'max-h-64',
  /** Tailwind `from-*` colour that matches the surface behind the fade. */
  fadeFromClassName = 'from-background',
  scrollLabel,
}: {
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  maxHeightClassName?: string;
  fadeFromClassName?: string;
  /** Accessible name for the scroll-down button. */
  scrollLabel: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [canScrollDown, setCanScrollDown] = useState(false);

  const update = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    // 1px tolerance absorbs sub-pixel rounding so a fully scrolled list
    // does not keep the affordance visible.
    setCanScrollDown(el.scrollHeight - el.scrollTop - el.clientHeight > 1);
  }, []);

  useLayoutEffect(() => {
    const el = containerRef.current;
    // `undefined`, not a bare return: the other path hands back a cleanup, and
    // the effect's returns have to agree.
    if (!el) return undefined;
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    // Content size can change without the container resizing (chips wrap,
    // rows append) — watch the first child when present.
    const child = el.firstElementChild;
    if (child !== null) observer.observe(child);
    return () => observer.disconnect();
  }, [update, children]);

  return (
    <div className={cn('relative min-h-0', className)}>
      <div
        ref={containerRef}
        onScroll={update}
        className={cn(
          'overflow-y-auto overscroll-contain',
          maxHeightClassName,
          contentClassName,
        )}
      >
        {children}
      </div>
      {canScrollDown && (
        <>
          <div
            aria-hidden
            className={cn(
              'pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t to-transparent',
              fadeFromClassName,
            )}
          />
          <div className="absolute inset-x-0 bottom-1.5 z-10 flex justify-center">
            <Button
              type="button"
              size="icon-sm"
              variant="secondary"
              icon={ChevronDown}
              aria-label={scrollLabel}
              // Nested inside clickable hosts (e.g. a MultiSelect combobox
              // trigger) — stop the host from treating this as its own click.
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                const el = containerRef.current;
                if (!el) return;
                el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
              }}
              onPointerDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              className="bg-background/95 animate-content-in rounded-full shadow-md"
            />
          </div>
        </>
      )}
    </div>
  );
}
