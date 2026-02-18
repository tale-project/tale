'use client';

import { type ComponentType, type ReactNode } from 'react';

import { cn } from '@/lib/utils/cn';

interface EmptyPlaceholderProps {
  icon?: ComponentType<{ className?: string }>;
  children: ReactNode;
  className?: string;
}

export function EmptyPlaceholder({
  icon: Icon,
  children,
  className,
}: EmptyPlaceholderProps) {
  return (
    <div
      className={cn(
        'rounded-lg border border-dashed p-8 text-center',
        className,
      )}
    >
      {Icon && (
        <Icon
          className="text-muted-foreground/50 mx-auto mb-2 size-8"
          aria-hidden="true"
        />
      )}
      <div className="text-muted-foreground text-sm">{children}</div>
    </div>
  );
}
