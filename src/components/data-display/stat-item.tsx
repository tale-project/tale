'use client';

import { Text } from '@tale/ui/text';
import { type ReactNode } from 'react';

import { cn } from '../../lib/cn';

interface StatItemProps {
  label: string;
  children: ReactNode;
  colSpan?: 1 | 2;
  className?: string;
  layout?: 'stack' | 'row';
}

export function StatItem({
  label,
  children,
  colSpan,
  className,
  layout = 'stack',
}: StatItemProps) {
  return (
    <div
      className={cn(
        layout === 'row'
          ? 'grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,2fr)] items-baseline gap-x-4 gap-y-1'
          : 'flex min-w-0 flex-col',
        colSpan === 2 && 'col-span-2',
        className,
      )}
    >
      <dt>
        <Text variant="caption" as="span">
          {label}
        </Text>
      </dt>
      {/* Wrap at spaces first; only an unbroken run (a URL, an id) breaks
          mid-word — `break-all` split dates like "8:54" across lines. */}
      <dd className="min-w-0 wrap-anywhere">{children}</dd>
    </div>
  );
}
