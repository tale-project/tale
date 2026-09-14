import { Row } from '@tale/ui/layout';
import { SkeletonCircle } from '@tale/ui/skeleton';
import { Text } from '@tale/ui/text';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils/cn';

export function ConversationDateHeader({ children }: { children: ReactNode }) {
  return (
    <div className="z-10 mb-4 py-2">
      <Row gap={0} align="stretch" justify="center">
        <SkeletonCircle asChild>
          <div className="bg-background border-border rounded-full border px-2 py-0.5 shadow-sm">
            <Text as="span" variant="label-sm" className="text-primary">
              {children}
            </Text>
          </div>
        </SkeletonCircle>
      </Row>
    </div>
  );
}

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
