'use client';

import { type ComponentType, type ReactNode } from 'react';

import { Heading } from '@/app/components/ui/typography/heading';
import { Text } from '@/app/components/ui/typography/text';
import { cn } from '@/lib/utils/cn';

interface EmptyStateProps {
  icon?: ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-1 flex-col items-center justify-center px-4 py-12 text-center',
        className,
      )}
    >
      {Icon && (
        <Icon className="text-muted-foreground mb-4 size-5" aria-hidden />
      )}
      <Heading level={3} size="sm">
        {title}
      </Heading>
      {description && (
        <Text variant="muted" className="mt-1 max-w-[20rem]">
          {description}
        </Text>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
