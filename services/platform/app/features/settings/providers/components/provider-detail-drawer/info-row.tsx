'use client';

import { HStack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';

import { cn } from '@/lib/utils/cn';

export function InfoRow({
  label,
  children,
  muted,
  isLast,
}: {
  label: string;
  children: React.ReactNode;
  muted?: boolean;
  isLast?: boolean;
}) {
  return (
    <HStack
      gap={4}
      align="start"
      className={cn('px-4 py-2.5', !isLast && 'border-b')}
    >
      <Text variant="muted" className="w-32 shrink-0 text-sm font-normal">
        {label}
      </Text>
      <div
        className={cn(
          'min-w-0 flex-1 text-sm break-words',
          muted ? 'text-muted-foreground' : 'font-medium',
        )}
      >
        {children}
      </div>
    </HStack>
  );
}
