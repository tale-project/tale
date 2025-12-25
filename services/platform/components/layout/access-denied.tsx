'use client';

import { cn } from '@/lib/utils/cn';
import { useT } from '@/lib/i18n';

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
export function AccessDenied({
  title,
  message,
  className,
}: AccessDeniedProps) {
  const { t } = useT('accessDenied');
  const displayTitle = title ?? t('title');
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center min-h-[50vh] text-center',
        className,
      )}
    >
      <h1 className="text-2xl font-semibold text-foreground mb-2">{displayTitle}</h1>
      <p className="text-muted-foreground">{message}</p>
    </div>
  );
}
