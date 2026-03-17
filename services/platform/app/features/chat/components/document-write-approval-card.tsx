'use client';

import {
  CheckCircle,
  FileText,
  FolderOpen,
  Loader2,
  XCircle,
} from 'lucide-react';
import { memo, useMemo, useState } from 'react';

import type { Id } from '@/convex/_generated/dataModel';
import type { DocumentWriteMetadata } from '@/convex/approvals/types';

import { Badge } from '@/app/components/ui/feedback/badge';
import { ActionRow } from '@/app/components/ui/layout/action-row';
import { HStack, Stack } from '@/app/components/ui/layout/layout';
import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { Button } from '@/app/components/ui/primitives/button';
import { Text } from '@/app/components/ui/typography/text';
import {
  useExecuteApprovedDocumentWrite,
  useUpdateApprovalStatus,
} from '@/app/features/chat/hooks/mutations';
import { useAuth } from '@/app/hooks/use-convex-auth';
import { normalizeDocumentWriteMetadata } from '@/convex/approvals/types';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';
import { formatBytes } from '@/lib/utils/format/number';

interface DocumentWriteApprovalCardProps {
  approvalId: Id<'approvals'>;
  organizationId: string;
  status: 'pending' | 'approved' | 'rejected';
  metadata: DocumentWriteMetadata;
  executedAt?: number;
  executionError?: string;
  className?: string;
}

function DocumentWriteApprovalCardComponent({
  approvalId,
  status,
  metadata: rawMetadata,
  executedAt,
  executionError,
  className,
}: DocumentWriteApprovalCardProps) {
  const { t } = useT('documentWriteApproval');
  const { user } = useAuth();
  const [isApproving, setIsApproving] = useState(false);
  const [isRejecting, setIsRejecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { mutateAsync: updateApprovalStatus } = useUpdateApprovalStatus();
  const { mutateAsync: executeDocumentWrite } =
    useExecuteApprovedDocumentWrite();

  const metadata = useMemo(
    () => normalizeDocumentWriteMetadata(rawMetadata),
    [rawMetadata],
  );
  const files = metadata.files;
  const isBatch = files.length > 1;

  const isPending = status === 'pending';
  const isProcessing = isApproving || isRejecting;

  const handleApprove = async () => {
    if (!user?.userId) {
      setError(t('errorNotAuthenticated'));
      return;
    }
    setIsApproving(true);
    setError(null);
    try {
      await updateApprovalStatus({
        approvalId,
        status: 'approved',
      });
      await executeDocumentWrite({ approvalId });
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorSaveFailed'));
      console.error('Failed to approve document write:', err);
    } finally {
      setIsApproving(false);
    }
  };

  const handleReject = async () => {
    if (!user?.userId) {
      setError(t('errorNotAuthenticated'));
      return;
    }
    setIsRejecting(true);
    setError(null);
    try {
      await updateApprovalStatus({
        approvalId,
        status: 'rejected',
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorRejectFailed'));
      console.error('Failed to reject document write:', err);
    } finally {
      setIsRejecting(false);
    }
  };

  const successCount = files.filter((f) => f.createdDocumentId).length;
  const failedCount = files.filter((f) => f.executionError).length;

  return (
    <div
      className={cn(
        'rounded-xl border border-border p-4 bg-card max-w-md overflow-hidden',
        className,
      )}
    >
      {/* Header */}
      <HStack gap={2} align="center" className="mb-2">
        <FileText className="text-primary size-4 shrink-0" />
        <Text as="div" variant="label">
          {isBatch
            ? t('cardTitleWithCount', { count: files.length })
            : t('cardTitle')}
        </Text>
      </HStack>

      {/* File list */}
      <Stack
        gap={1}
        className={cn('mb-3 pl-6', isBatch && 'max-h-48 overflow-y-auto')}
      >
        {files.map((file) => (
          <div key={file.fileId} className="flex min-w-0 items-start gap-2">
            {/* Per-file status icon (only after execution) */}
            {status === 'approved' && executedAt && (
              <span className="mt-0.5 shrink-0">
                {file.createdDocumentId && !file.executionError ? (
                  <CheckCircle className="size-3 text-green-600" />
                ) : file.executionError ? (
                  <XCircle className="text-destructive size-3" />
                ) : null}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <Text as="div" variant="label" className="truncate">
                {file.title}
              </Text>
              <HStack gap={2} className="flex-wrap">
                <Text as="span" variant="caption" className="truncate">
                  {file.fileName}
                </Text>
                <Badge variant="outline" className="shrink-0 text-xs">
                  {file.mimeType}
                </Badge>
                <Text as="span" variant="caption" className="shrink-0">
                  {formatBytes(file.fileSize)}
                </Text>
              </HStack>
              {file.executionError && (
                <Text
                  as="div"
                  variant="caption"
                  className="text-destructive mt-0.5"
                >
                  {file.executionError}
                </Text>
              )}
            </div>
          </div>
        ))}
      </Stack>

      {/* Folder path */}
      {metadata.folderPath && (
        <HStack gap={1} className="text-muted-foreground mb-3">
          <FolderOpen className="size-3 shrink-0" />
          <Text as="span" variant="caption">
            {metadata.folderPath}
          </Text>
        </HStack>
      )}

      {/* Batch success summary */}
      {status === 'approved' && executedAt && isBatch && !executionError && (
        <HStack gap={1} className="mb-3 text-xs text-green-600">
          <CheckCircle className="size-3" />
          {t('savedSuccessfully')}
        </HStack>
      )}

      {/* Single file success */}
      {status === 'approved' && executedAt && !isBatch && !executionError && (
        <HStack gap={1} className="mb-3 text-xs text-green-600">
          <CheckCircle className="size-3" />
          {t('savedSuccessfully')}
        </HStack>
      )}

      {/* Partial success (batch) */}
      {status === 'approved' &&
        executedAt &&
        isBatch &&
        failedCount > 0 &&
        successCount > 0 && (
          <HStack gap={1} className="mb-3 text-xs text-amber-600">
            <CheckCircle className="size-3" />
            {t('savedPartially', {
              success: successCount,
              total: files.length,
            })}
          </HStack>
        )}

      {/* Execution error (single file) */}
      {status === 'approved' && executionError && !isBatch && (
        <HStack
          gap={1}
          align="start"
          className="text-destructive mb-3 text-xs wrap-break-word"
        >
          <XCircle className="size-3 shrink-0" />
          <Text as="span" className="min-w-0">
            {executionError}
          </Text>
        </HStack>
      )}

      {/* All failed (batch) */}
      {status === 'approved' &&
        executedAt &&
        isBatch &&
        failedCount === files.length && (
          <HStack
            gap={1}
            align="start"
            className="text-destructive mb-3 text-xs wrap-break-word"
          >
            <XCircle className="size-3 shrink-0" />
            <Text as="span" className="min-w-0">
              {t('allFilesFailed', { count: files.length })}
            </Text>
          </HStack>
        )}

      {/* Temporary UI error */}
      {error && (
        <HStack
          gap={1}
          align="start"
          className="text-destructive mb-3 text-xs wrap-break-word"
        >
          <XCircle className="size-3 shrink-0" />
          <Text as="span" className="min-w-0">
            {error}
          </Text>
        </HStack>
      )}

      {/* Action buttons */}
      {isPending && (
        <ActionRow gap={2}>
          <Tooltip
            content={isBatch ? t('approveTooltipBatch') : t('approveTooltip')}
          >
            <Button
              size="sm"
              variant="primary"
              onClick={handleApprove}
              disabled={isProcessing}
              className="flex-1"
            >
              {isApproving && <Loader2 className="mr-1 size-4 animate-spin" />}
              {t('approve')}
            </Button>
          </Tooltip>

          <Tooltip
            content={isBatch ? t('rejectTooltipBatch') : t('rejectTooltip')}
          >
            <Button
              size="sm"
              variant="secondary"
              onClick={handleReject}
              disabled={isProcessing}
              className="flex-1"
            >
              {isRejecting && <Loader2 className="mr-1 size-4 animate-spin" />}
              {t('reject')}
            </Button>
          </Tooltip>
        </ActionRow>
      )}

      {/* Resolved status */}
      {!isPending && (
        <HStack justify="between" align="center" className="mt-2">
          <Text as="div" variant="caption">
            {status === 'approved' && failedCount > 0 && successCount > 0
              ? t('statusApprovedPartial')
              : status === 'approved' && executionError
                ? t('statusApprovedFailed')
                : status === 'approved'
                  ? t('statusApprovedSuccess')
                  : t('statusRejected')}
          </Text>
          <Badge
            variant={status === 'approved' ? 'green' : 'destructive'}
            className="shrink-0 text-xs capitalize"
          >
            {status}
          </Badge>
        </HStack>
      )}
    </div>
  );
}

export const DocumentWriteApprovalCard = memo(
  DocumentWriteApprovalCardComponent,
  (prevProps, nextProps) => {
    return (
      prevProps.approvalId === nextProps.approvalId &&
      prevProps.status === nextProps.status &&
      prevProps.className === nextProps.className &&
      prevProps.executedAt === nextProps.executedAt &&
      prevProps.executionError === nextProps.executionError &&
      prevProps.organizationId === nextProps.organizationId &&
      JSON.stringify(prevProps.metadata) === JSON.stringify(nextProps.metadata)
    );
  },
);
