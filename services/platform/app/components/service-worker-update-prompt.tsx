'use client';

import { useServiceWorker } from '@/app/hooks/use-service-worker';
import { useT } from '@/lib/i18n/client';
import { Button } from '@/app/components/ui/primitives/button';
import { cn } from '@/lib/utils/cn';

interface ServiceWorkerUpdatePromptProps {
  className?: string;
}

export function ServiceWorkerUpdatePrompt({
  className,
}: ServiceWorkerUpdatePromptProps) {
  const { isUpdateAvailable, applyUpdate } = useServiceWorker();
  const { t } = useT('common');

  if (!isUpdateAvailable) {
    return null;
  }

  return (
    <div
      className={cn(
        'fixed bottom-4 right-4 z-50 flex items-center gap-3 rounded-lg border bg-background p-4 shadow-lg',
        className
      )}
      role="alert"
      aria-live="polite"
    >
      <div className="flex-1">
        <p className="text-sm font-medium">{t('update.newVersionAvailable')}</p>
        <p className="text-xs text-muted-foreground">
          {t('update.reloadForUpdates')}
        </p>
      </div>
      <Button size="sm" onClick={applyUpdate}>
        {t('update.reload')}
      </Button>
    </div>
  );
}
