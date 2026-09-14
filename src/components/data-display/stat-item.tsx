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
      <dd className="break-all">{children}</dd>
    </div>
  );
}
