import { Cloud, CloudOff, RefreshCw, AlertCircle } from 'lucide-react';

import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { Button } from '@/app/components/ui/primitives/button';
import { useMutationQueue } from '@/app/hooks/use-mutation-queue';
import { useSyncStatus } from '@/app/hooks/use-sync-status';
import { cn } from '@/lib/utils/cn';

interface SyncStatusIndicatorProps {
  className?: string;
  showLabel?: boolean;
}

export function SyncStatusIndicator({
  className,
  showLabel = false,
}: SyncStatusIndicatorProps) {
  const { isOnline, isSyncing, syncNow } = useSyncStatus();
  const { pendingCount, failedCount, retryAll } = useMutationQueue();

  const hasIssues = failedCount > 0;
  const hasPending = pendingCount > 0;

  const handleSync = async () => {
    if (hasIssues) {
      await retryAll();
    }
    await syncNow();
  };

  const getStatusIcon = () => {
    if (!isOnline) {
      return <CloudOff className="text-muted-foreground h-4 w-4" />;
    }
    if (isSyncing) {
      return <RefreshCw className="text-primary h-4 w-4 animate-spin" />;
    }
    if (hasIssues) {
      return <AlertCircle className="text-destructive h-4 w-4" />;
    }
    if (hasPending) {
      return <RefreshCw className="text-warning h-4 w-4" />;
    }
    return <Cloud className="text-success h-4 w-4" />;
  };

  const getStatusText = () => {
    if (!isOnline) return 'Offline';
    if (isSyncing) return 'Syncing...';
    if (hasIssues) return `${failedCount} failed`;
    if (hasPending) return `${pendingCount} pending`;
    return 'Synced';
  };

  const getTooltipText = () => {
    if (!isOnline) {
      return 'You are offline. Changes will sync when you reconnect.';
    }
    if (isSyncing) {
      return 'Syncing your changes...';
    }
    if (hasIssues) {
      return `${failedCount} change(s) failed to sync. Click to retry.`;
    }
    if (hasPending) {
      return `${pendingCount} change(s) pending sync.`;
    }
    return 'All changes synced.';
  };

  return (
    <Tooltip content={<p>{getTooltipText()}</p>}>
      <Button
        variant="ghost"
        size="sm"
        className={cn('gap-2', className)}
        onClick={handleSync}
        disabled={isSyncing || !isOnline}
      >
        {getStatusIcon()}
        {showLabel && (
          <span className="text-muted-foreground text-sm">
            {getStatusText()}
          </span>
        )}
        {(hasPending || hasIssues) && (
          <span
            className={cn(
              'flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-xs font-medium',
              hasIssues
                ? 'bg-destructive text-destructive-foreground'
                : 'bg-warning text-warning-foreground',
            )}
          >
            {hasIssues ? failedCount : pendingCount}
          </span>
        )}
      </Button>
    </Tooltip>
  );
}
