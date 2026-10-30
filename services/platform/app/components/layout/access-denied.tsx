'use client';

import { cn } from '@tale/ui/cn';
import { Heading } from '@tale/ui/heading';
import { Text } from '@tale/ui/text';
import type { ReactNode } from 'react';

import { useT } from '@/lib/i18n/client';

interface AccessDeniedProps {
  /**
   * The title to display. Defaults to translated "Access Denied".
   */
  title?: string;
  /**
   * The description message explaining what permissions are needed.
   */
  message: string;
  /** What the person can do about it, shown under the message. */
  action?: ReactNode;
  className?: string;
}

/**
 * Access denied component for permission errors.
 * Shows a centered message when users lack required permissions.
 */
export function AccessDenied({
  title,
  message,
  action,
  className,
}: AccessDeniedProps) {
  const { t } = useT('accessDenied');
  const displayTitle = title ?? t('title');
  return (
    <div
      className={cn(
        'flex min-h-[50vh] flex-col items-center justify-center text-center',
        className,
      )}
    >
      <Heading level={1} size="2xl" className="mb-2">
        {displayTitle}
      </Heading>
      <Text variant="muted">{message}</Text>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
