'use client';

import { type ReactNode } from 'react';

import { cn } from '@/lib/utils/cn';

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
  const content = organizationId ? (
    <LayoutErrorBoundary organizationId={organizationId}>
      {children}
    </LayoutErrorBoundary>
  ) : (
    children
  );

  return (
    <div
      // `scrollbar-gutter: stable` reserves the vertical scrollbar's space so
      // that filtering a list (which can add/remove the scrollbar as the row
      // count changes) doesn't shift the page horizontally.
      //
      // Floating-dock end clearance lives on scrollable *content* (`ContentArea`,
      // inbox list) via `--mobile-floating-actions-pad` — not here. Padding on
      // this flex shell clips `overflow-hidden` pages and misses `flex-1 min-h-0`
      // outlets.
      className={cn(
        'flex min-h-0 flex-1 flex-col overflow-auto [scrollbar-gutter:stable]',
        className,
      )}
    >
      {header && <StickyHeader>{header}</StickyHeader>}
      {content}
    </div>
  );
}
