import { Cloud, CloudOff, RefreshCw, AlertCircle } from 'lucide-react';
import { useSyncStatus } from '@/app/hooks/use-sync-status';
import { useMutationQueue } from '@/app/hooks/use-mutation-queue';
import { cn } from '@/lib/utils/cn';
import { Button } from '@/app/components/ui/primitives/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/app/components/ui/overlays/tooltip';

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
      return <CloudOff className="h-4 w-4 text-muted-foreground" />;
    }
    if (isSyncing) {
      return <RefreshCw className="h-4 w-4 animate-spin text-primary" />;
    }
    if (hasIssues) {
      return <AlertCircle className="h-4 w-4 text-destructive" />;
    }
    if (hasPending) {
      return <RefreshCw className="h-4 w-4 text-warning" />;
    }
    return <Cloud className="h-4 w-4 text-success" />;
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
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn('gap-2', className)}
          onClick={handleSync}
          disabled={isSyncing || !isOnline}
        >
          {getStatusIcon()}
          {showLabel && (
            <span className="text-sm text-muted-foreground">
              {getStatusText()}
            </span>
          )}
          {(hasPending || hasIssues) && (
            <span
              className={cn(
                'flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-xs font-medium',
                hasIssues
                  ? 'bg-destructive text-destructive-foreground'
                  : 'bg-warning text-warning-foreground'
              )}
            >
              {hasIssues ? failedCount : pendingCount}
            </span>
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <p>{getTooltipText()}</p>
      </TooltipContent>
    </Tooltip>
  );
}
