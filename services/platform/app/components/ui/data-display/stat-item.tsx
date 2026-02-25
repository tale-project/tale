'use client';

import { type ReactNode } from 'react';

import { Text } from '@/app/components/ui/typography/text';
import { cn } from '@/lib/utils/cn';

interface StatItemProps {
  label: string;
  children: ReactNode;
  className?: string;
}

export function StatItem({ label, children, className }: StatItemProps) {
  return (
    <div className={cn('flex flex-col', className)}>
      <Text variant="caption" as="span">
        {label}
      </Text>
      <div>{children}</div>
    </div>
  );
}
