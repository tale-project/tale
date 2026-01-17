'use client';

import { useOnlineStatus } from '@/app/hooks/use-online-status';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

interface OfflineIndicatorProps {
  className?: string;
  showWhenOnline?: boolean;
}

export function OfflineIndicator({
  className,
  showWhenOnline = false,
}: OfflineIndicatorProps) {
  const isOnline = useOnlineStatus();
  const { t } = useT('common');

  if (isOnline && !showWhenOnline) {
    return null;
  }

  return (
    <div
      className={cn(
        'fixed top-0 left-0 right-0 z-50 flex items-center justify-center px-4 py-2 text-sm font-medium transition-colors',
        isOnline
          ? 'bg-green-500 text-white'
          : 'bg-yellow-500 text-yellow-950',
        className
      )}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-2">
        <span
          className={cn(
            'h-2 w-2 rounded-full',
            isOnline ? 'bg-white' : 'bg-yellow-950 animate-pulse'
          )}
        />
        <span>
          {isOnline ? t('offline.backOnline') : t('offline.youAreOffline')}
        </span>
      </div>
    </div>
  );
}
