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
      className={cn('flex min-h-0 flex-1 flex-col overflow-auto', className)}
    >
      {header && <StickyHeader>{header}</StickyHeader>}
      {content}
    </div>
  );
}
