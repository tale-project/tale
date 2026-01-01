'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, CircleCheck, XCircle, Clock, Database, RotateCw, AlertTriangle } from 'lucide-react';
import { ViewDialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';
import { useT } from '@/lib/i18n';
import type { RagStatus } from '@/types/documents';
import { retryRagIndexing } from '../actions/retry-rag-indexing';
import { useDateFormat } from '@/hooks/use-date-format';

// Statuses that indicate indexing is in progress and should auto-refresh
const IN_PROGRESS_STATUSES: RagStatus[] = ['pending', 'queued', 'running'];
const POLL_INTERVAL_MS = 3000; // Poll every 3 seconds

interface RagStatusBadgeProps {
  status: RagStatus | undefined;
  /** Timestamp (in seconds) when the document was indexed */
  indexedAt?: number;
  /** Error message (for failed status) */
  error?: string;
  /** Document ID (required for retry functionality) */
  documentId?: string;
}

const statusConfig: Record<
  RagStatus,
  { icon: React.ElementType; iconClassName?: string; textClassName?: string }
> = {
  pending: {
    icon: Clock,
    textClassName: 'text-muted-foreground',
  },
  queued: {
    icon: Clock,
    textClassName: 'text-muted-foreground',
  },
  running: {
    icon: Loader2,
    textClassName: 'text-muted-foreground',
  },
  completed: {
    icon: CircleCheck,
    iconClassName: 'text-success',
    textClassName: 'text-muted-foreground',
  },
  failed: {
    icon: XCircle,
    iconClassName: 'text-destructive',
    textClassName: 'text-destructive',
  },
  not_indexed: {
    icon: Database,
    textClassName: 'text-muted-foreground',
  },
  stale: {
    icon: AlertTriangle,
    iconClassName: 'text-warning',
    textClassName: 'text-muted-foreground',
  },
};

export function RagStatusBadge({ status, indexedAt, error, documentId }: RagStatusBadgeProps) {
  const { t } = useT('documents');
  const { formatDate } = useDateFormat();
  const [isRetrying, setIsRetrying] = useState(false);
  const [isCompletedDialogOpen, setIsCompletedDialogOpen] = useState(false);
  const [isFailedDialogOpen, setIsFailedDialogOpen] = useState(false);
  const router = useRouter();

  // Get translated label for status
  const getStatusLabel = (s: RagStatus) => {
    const labels: Record<RagStatus, string> = {
      pending: t('rag.status.pending'),
      queued: t('rag.status.queued'),
      running: t('rag.status.indexing'),
      completed: t('rag.status.indexed'),
      failed: t('rag.status.failed'),
      not_indexed: t('rag.status.notIndexed'),
      stale: t('rag.status.needsReindex'),
    };
    return labels[s];
  };

  // Auto-poll for status updates when indexing is in progress
  useEffect(() => {
    if (!status || !IN_PROGRESS_STATUSES.includes(status)) {
      return;
    }

    const intervalId = setInterval(() => {
      router.refresh();
    }, POLL_INTERVAL_MS);

    return () => clearInterval(intervalId);
  }, [status, router]);

  const handleRetry = async () => {
    if (!documentId) {
      toast({
        title: t('rag.toast.documentIdRequired'),
        variant: 'destructive',
      });
      return;
    }

    setIsRetrying(true);
    try {
      const result = await retryRagIndexing(documentId);
      if (result.success) {
        toast({
          title: t('rag.toast.indexingStarted'),
          description: t('rag.toast.indexingQueued'),
        });
        // Refresh the page data to show updated status
        router.refresh();
      } else {
        toast({
          title: t('rag.toast.retryFailed'),
          description: result.error || t('rag.toast.retryFailedDescription'),
          variant: 'destructive',
        });
      }
    } catch {
      toast({
        title: t('rag.toast.unexpectedError'),
        variant: 'destructive',
      });
    } finally {
      setIsRetrying(false);
    }
  };

  if (!status) {
    return <span className="text-muted-foreground text-sm">—</span>;
  }

  const config = statusConfig[status];
  const Icon = config.icon;

  const content = (
    <span className={`inline-flex items-center gap-1 text-sm ${config.textClassName || ''}`}>
      <Icon
        className={`size-3.5 ${status === 'running' ? 'animate-spin' : ''} ${config.iconClassName || ''}`}
      />
      {getStatusLabel(status)}
    </span>
  );

  // Show clickable dialog with indexed date for completed status
  if (status === 'completed') {
    const indexedDate = indexedAt ? new Date(indexedAt * 1000) : null;
    const formattedDate = indexedDate
      ? formatDate(indexedDate, 'long')
      : t('rag.status.unknown');

    return (
      <>
        <button
          type="button"
          onClick={() => setIsCompletedDialogOpen(true)}
          className={`inline-flex items-center gap-1 text-sm cursor-pointer hover:underline ${config.textClassName || ''}`}
        >
          <Icon className={`size-3.5 ${config.iconClassName || ''}`} />
          {getStatusLabel(status)}
        </button>
        <ViewDialog
          open={isCompletedDialogOpen}
          onOpenChange={setIsCompletedDialogOpen}
          title={t('rag.dialog.indexed.title')}
          description={t('rag.dialog.indexed.description')}
        >
          <div className="mt-4">
            <p className="text-sm">
              <span className="font-medium">{t('rag.dialog.indexed.indexedOn')}</span> {formattedDate}
            </p>
          </div>
        </ViewDialog>
      </>
    );
  }

  // Show failed status with inline retry button
  if (status === 'failed') {
    return (
      <span className="inline-flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => setIsFailedDialogOpen(true)}
          className={`inline-flex items-center gap-1 text-sm cursor-pointer hover:underline ${config.textClassName || ''}`}
        >
          <Icon className={`size-3.5 ${config.iconClassName || ''}`} />
          {getStatusLabel(status)}
        </button>
        <ViewDialog
          open={isFailedDialogOpen}
          onOpenChange={setIsFailedDialogOpen}
          title={t('rag.dialog.failed.title')}
          description={t('rag.dialog.failed.description')}
        >
          <div className="mt-4">
            <p className="text-sm font-medium mb-2">{t('rag.dialog.failed.errorDetails')}</p>
            <pre className="text-xs bg-muted p-3 rounded-md overflow-auto max-h-[200px] whitespace-pre-wrap">
              {error || t('rag.dialog.failed.unknownError')}
            </pre>
          </div>
        </ViewDialog>
        <Button
          size="icon"
          variant="outline"
          className="size-5 rounded-full border-muted-foreground/30 hover:border-primary hover:bg-primary/10 hover:text-primary"
          onClick={handleRetry}
          disabled={isRetrying || !documentId}
          title={t('rag.retryIndexing')}
        >
          {isRetrying ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <RotateCw className="size-3" />
          )}
        </Button>
      </span>
    );
  }

  // Show stale status with prominent reindex button
  if (status === 'stale') {
    return (
      <span className="inline-flex items-center gap-2">
        <span className={`inline-flex items-center gap-1 text-sm ${config.textClassName || ''}`}>
          <Icon className={`size-3.5 ${config.iconClassName || ''}`} />
          {t('rag.status.stale')}
        </span>
        <Button
          size="sm"
          variant="outline"
          className="h-6 px-2 text-xs border-amber-500/50 bg-amber-500/10 text-amber-600 hover:bg-amber-500/20 hover:border-amber-500 hover:text-amber-700"
          onClick={handleRetry}
          disabled={isRetrying || !documentId}
        >
          {isRetrying ? (
            <>
              <Loader2 className="size-3 animate-spin mr-1" />
              {t('rag.reindexing')}
            </>
          ) : (
            <>
              <RotateCw className="size-3 mr-1" />
              {t('rag.reindex')}
            </>
          )}
        </Button>
      </span>
    );
  }

  // Show not_indexed status with Index button
  if (status === 'not_indexed') {
    return (
      <span className="inline-flex items-center gap-2">
        <span className={`inline-flex items-center gap-1 text-sm ${config.textClassName || ''}`}>
          <Icon className={`size-3.5 ${config.iconClassName || ''}`} />
          {getStatusLabel(status)}
        </span>
        <Button
          size="icon"
          variant="outline"
          className="size-6 rounded-sm"
          onClick={handleRetry}
          disabled={isRetrying || !documentId}
          title={t('rag.index')}
        >
          {isRetrying ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <RotateCw className="size-3" />
          )}
        </Button>
      </span>
    );
  }

  return content;
}
