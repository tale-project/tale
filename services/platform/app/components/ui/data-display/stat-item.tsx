'use client';

import { type ReactNode } from 'react';

import { Text } from '@/app/components/ui/typography/text';
import { cn } from '@/lib/utils/cn';

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
      className={cn('flex flex-col', colSpan === 2 && 'col-span-2', className)}
    >
      <dt>
        <Text variant="caption" as="span">
          {label}
        </Text>
      </dt>
      <dd>{children}</dd>
    </div>
  );
}
