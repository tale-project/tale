'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, CircleCheck, XCircle, Clock, Database, RotateCw, AlertTriangle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';
import type { RagStatus } from '@/types/documents';
import { retryRagIndexing } from '../actions/retry-rag-indexing';

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
  { label: string; icon: React.ElementType; iconClassName?: string; textClassName?: string }
> = {
  pending: {
    label: 'Pending',
    icon: Clock,
    textClassName: 'text-muted-foreground',
  },
  queued: {
    label: 'Queued',
    icon: Clock,
    textClassName: 'text-muted-foreground',
  },
  running: {
    label: 'Indexing',
    icon: Loader2,
    textClassName: 'text-muted-foreground',
  },
  completed: {
    label: 'Indexed',
    icon: CircleCheck,
    iconClassName: 'text-green-600',
    textClassName: 'text-muted-foreground',
  },
  failed: {
    label: 'Failed',
    icon: XCircle,
    iconClassName: 'text-destructive',
    textClassName: 'text-destructive',
  },
  not_indexed: {
    label: 'Not indexed',
    icon: Database,
    textClassName: 'text-muted-foreground',
  },
  stale: {
    label: 'Needs reindex',
    icon: AlertTriangle,
    iconClassName: 'text-amber-500',
    textClassName: 'text-muted-foreground',
  },
};

export default function RagStatusBadge({ status, indexedAt, error, documentId }: RagStatusBadgeProps) {
  const [isRetrying, setIsRetrying] = useState(false);
  const router = useRouter();

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
        title: 'Error',
        description: 'Document ID is required for retry',
        variant: 'destructive',
      });
      return;
    }

    setIsRetrying(true);
    try {
      const result = await retryRagIndexing(documentId);
      if (result.success) {
        toast({
          title: 'Reindexing started',
          description: 'Document indexing has been queued.',
        });
        // Refresh the page data to show updated status
        router.refresh();
      } else {
        toast({
          title: 'Retry failed',
          description: result.error || 'Failed to retry RAG indexing',
          variant: 'destructive',
        });
      }
    } catch (err) {
      toast({
        title: 'Error',
        description: 'An unexpected error occurred',
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
      {config.label}
    </span>
  );

  // Show clickable dialog with indexed date for completed status
  if (status === 'completed') {
    const indexedDate = indexedAt ? new Date(indexedAt * 1000) : null;
    const formattedDate = indexedDate
      ? indexedDate.toLocaleDateString(undefined, {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })
      : 'Unknown';

    return (
      <Dialog>
        <DialogTrigger asChild>
          <button
            type="button"
            className={`inline-flex items-center gap-1 text-sm cursor-pointer hover:underline ${config.textClassName || ''}`}
          >
            <Icon className={`size-3.5 ${config.iconClassName || ''}`} />
            {config.label}
          </button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader className="pr-8">
            <DialogTitle className="flex items-center gap-2 text-green-600">
              <CircleCheck className="size-5" />
              Document Indexed
            </DialogTitle>
            <DialogDescription>
              This document has been successfully indexed and is available for RAG search.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4">
            <p className="text-sm">
              <span className="font-medium">Indexed on:</span> {formattedDate}
            </p>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // Show failed status with inline retry button
  if (status === 'failed') {
    return (
      <span className="inline-flex items-center gap-1.5">
        <Dialog>
          <DialogTrigger asChild>
            <button
              type="button"
              className={`inline-flex items-center gap-1 text-sm cursor-pointer hover:underline ${config.textClassName || ''}`}
            >
              <Icon className={`size-3.5 ${config.iconClassName || ''}`} />
              {config.label}
            </button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader className="pr-8">
              <DialogTitle className="flex items-center gap-2 text-destructive">
                <XCircle className="size-5" />
                Indexing Failed
              </DialogTitle>
              <DialogDescription>
                The document could not be indexed for RAG search.
              </DialogDescription>
            </DialogHeader>
            <div className="mt-4">
              <p className="text-sm font-medium mb-2">Error Details:</p>
              <pre className="text-xs bg-muted p-3 rounded-md overflow-auto max-h-[200px] whitespace-pre-wrap">
                {error || 'Unknown error occurred'}
              </pre>
            </div>
          </DialogContent>
        </Dialog>
        <Button
          size="icon"
          variant="outline"
          className="size-5 rounded-full border-muted-foreground/30 hover:border-primary hover:bg-primary/10 hover:text-primary"
          onClick={handleRetry}
          disabled={isRetrying || !documentId}
          title="Retry indexing"
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
          Stale
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
              Reindexing...
            </>
          ) : (
            <>
              <RotateCw className="size-3 mr-1" />
              Reindex
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
          {config.label}
        </span>
        <Button
          size="sm"
          variant="outline"
          className="h-6 px-2 text-xs"
          onClick={handleRetry}
          disabled={isRetrying || !documentId}
        >
          {isRetrying ? (
            <>
              <Loader2 className="size-3 animate-spin mr-1" />
              Indexing...
            </>
          ) : (
            <>
              <Database className="size-3 mr-1" />
              Index
            </>
          )}
        </Button>
      </span>
    );
  }

  return content;
}
