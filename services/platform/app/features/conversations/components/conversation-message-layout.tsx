import { cn } from '@tale/ui/cn';
import { Text } from '@tale/ui/text';
import type { ReactNode } from 'react';

export function MessageTimestamp({
  children,
  isCustomer,
  isFailed = false,
}: {
  children: ReactNode;
  isCustomer: boolean;
  isFailed?: boolean;
}) {
  return (
    <Text
      as="div"
      variant="caption"
      className={cn(
        'flex items-center justify-end gap-1.5 text-nowrap',
        isCustomer
          ? 'text-left'
          : cn('text-muted-foreground/70 text-right', !isFailed && 'mb-4'),
      )}
    >
      {children}
    </Text>
  );
}
