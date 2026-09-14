'use client';

import { Text } from '@tale/ui/text';
import { type ReactNode } from 'react';

import { cn } from '../../lib/cn';

interface StatItemProps {
  label: string;
  children: ReactNode;
  colSpan?: 1 | 2;
  className?: string;
}

export function StatItem({
  label,
  children,
  colSpan,
  className,
}: StatItemProps) {
  return (
    <div
      className={cn(
        'flex min-w-0 flex-col',
        colSpan === 2 && 'col-span-2',
        className,
      )}
    >
      <dt>
        <Text variant="caption" as="span">
          {label}
        </Text>
      </dt>
      {/* Word boundaries, not `break-all` — a 2-col grid would otherwise
          split a timestamp mid-digit ("11:1" / "1"). */}
      <dd className="wrap-break-word">{children}</dd>
    </div>
  );
}
