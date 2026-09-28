'use client';

import { cn } from '@tale/ui/cn';
import { useResizeObserver } from '@tale/ui/use-resize-observer';
import { useRef, type ReactNode } from 'react';

import { LayoutErrorBoundary } from '../error-boundaries/boundaries/layout-error-boundary';
import { StickyHeader } from './sticky-header';

interface PageLayoutProps {
  header?: ReactNode;
  children: ReactNode;
  organizationId?: string;
  className?: string;
}

export function PageLayout({
  header,
  children,
  organizationId,
  className,
}: PageLayoutProps) {
  const shellRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  useResizeObserver(
    headerRef,
    () => {
      const element = headerRef.current;
      shellRef.current?.style.setProperty(
        '--page-sticky-header-height',
        `${element && getComputedStyle(element).position === 'sticky' ? element.getBoundingClientRect().height : 0}px`,
      );
    },
    { listenToWindow: true, deps: [!!header] },
  );

  const content = organizationId ? (
    <LayoutErrorBoundary organizationId={organizationId}>
      {children}
    </LayoutErrorBoundary>
  ) : (
    children
  );

  return (
    <div
      ref={shellRef}
      // `scrollbar-gutter: stable` reserves the vertical scrollbar's space so
      // that filtering a list (which can add/remove the scrollbar as the row
      // count changes) doesn't shift the page horizontally.
      //
      // Floating-dock end clearance lives on scrollable *content* (`ContentArea`,
      // inbox list) via `--mobile-floating-actions-pad` — not here. Padding on
      // this flex shell clips `overflow-hidden` pages and misses `flex-1 min-h-0`
      // outlets.
      className={cn(
        'mobile-nav-scroll flex min-h-0 flex-1 flex-col overflow-auto [scrollbar-gutter:stable]',
        className,
      )}
    >
      {header && <StickyHeader ref={headerRef}>{header}</StickyHeader>}
      {content}
    </div>
  );
}
