'use client';

import { Heading } from '@/app/components/ui/typography/heading';
import { Text } from '@/app/components/ui/typography/text';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

interface AccessDeniedProps {
  /**
   * The title to display. Defaults to translated "Access Denied".
   */
  title?: string;
  /**
   * The description message explaining what permissions are needed.
   */
  message: string;
  className?: string;
}

/**
 * Access denied component for permission errors.
 * Shows a centered message when users lack required permissions.
 */
export function AccessDenied({ title, message, className }: AccessDeniedProps) {
  const { t } = useT('accessDenied');
  const displayTitle = title ?? t('title');
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center min-h-[50vh] text-center',
        className,
      )}
    >
      <Heading level={1} size="2xl" className="mb-2">
        {displayTitle}
      </Heading>
      <Text variant="muted">{message}</Text>
    </div>
  );
}
