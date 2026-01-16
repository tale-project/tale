import { useServiceWorker } from '@/app/hooks/use-service-worker';
import { Button } from '@/app/components/ui/primitives/button';
import { cn } from '@/lib/utils/cn';

interface ServiceWorkerUpdatePromptProps {
  className?: string;
}

export function ServiceWorkerUpdatePrompt({
  className,
}: ServiceWorkerUpdatePromptProps) {
  const { isUpdateAvailable, applyUpdate } = useServiceWorker();

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
        <p className="text-sm font-medium">New version available</p>
        <p className="text-xs text-muted-foreground">
          Reload to get the latest updates
        </p>
      </div>
      <Button size="sm" onClick={applyUpdate}>
        Reload
      </Button>
    </div>
  );
}
