'use client';

import {
  CheckCircle,
  ChevronDown,
  ChevronRight,
  Loader2,
  Play,
  XCircle,
} from 'lucide-react';
import { memo, useState } from 'react';

import { Badge } from '@/app/components/ui/feedback/badge';
import { ActionRow } from '@/app/components/ui/layout/action-row';
import { HStack, Stack } from '@/app/components/ui/layout/layout';
import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { Button } from '@/app/components/ui/primitives/button';
import { Text } from '@/app/components/ui/typography/text';
import { useExecuteApprovedWorkflowRun } from '@/app/features/approvals/hooks/actions';
import { useUpdateApprovalStatus } from '@/app/features/approvals/hooks/mutations';
import { useAuth } from '@/app/hooks/use-convex-auth';
import { Id } from '@/convex/_generated/dataModel';
import { WorkflowRunMetadata } from '@/convex/approvals/types';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

interface WorkflowRunApprovalCardProps {
  approvalId: Id<'approvals'>;
  organizationId: string;
  status: 'pending' | 'approved' | 'rejected';
  metadata: WorkflowRunMetadata;
  executedAt?: number;
  executionError?: string;
  className?: string;
}

function WorkflowRunApprovalCardComponent({
  approvalId,
  status,
  metadata,
  executedAt,
  executionError,
  className,
}: WorkflowRunApprovalCardProps) {
  const { t } = useT('workflowRunApproval');
  const { user } = useAuth();
  const [isApproving, setIsApproving] = useState(false);
  const [isRejecting, setIsRejecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showParams, setShowParams] = useState(false);

  const { mutateAsync: updateApprovalStatus } = useUpdateApprovalStatus();
  const { mutateAsync: executeApprovedRun } = useExecuteApprovedWorkflowRun();

  const isPending = status === 'pending';
  const isProcessing = isApproving || isRejecting;

  const paramEntries = metadata.parameters
    ? Object.entries(metadata.parameters).filter(
        ([, v]) => v !== undefined && v !== null,
      )
    : [];

  const handleApprove = async () => {
    if (!user?.userId) {
      setError('User not authenticated');
      return;
    }
    setIsApproving(true);
    setError(null);
    try {
      await updateApprovalStatus({
        approvalId,
        status: 'approved',
      });
      await executeApprovedRun({
        approvalId,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to run workflow');
      console.error('Failed to approve workflow run:', err);
    } finally {
      setIsApproving(false);
    }
  };

  const handleReject = async () => {
    if (!user?.userId) {
      setError('User not authenticated');
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
      setError(err instanceof Error ? err.message : 'Failed to reject');
      console.error('Failed to reject workflow run:', err);
    } finally {
      setIsRejecting(false);
    }
  };

  return (
    <div
      className={cn(
        'border rounded-lg p-4 bg-card shadow-sm max-w-md overflow-hidden',
        status === 'approved' && 'border-success/30 bg-success/5',
        status === 'rejected' && 'border-destructive/30 bg-destructive/5',
        status === 'pending' && 'border-primary/30 bg-primary/5',
        className,
      )}
    >
      {/* Header */}
      <HStack gap={2} align="start" justify="between" className="mb-3">
        <HStack gap={2}>
          <div className="bg-primary/10 rounded-md p-1.5">
            <Play className="text-primary size-4" />
          </div>
          <div>
            <Text as="div" variant="label">
              {metadata.workflowName}
            </Text>
            {metadata.workflowDescription && (
              <Text as="div" variant="caption" className="line-clamp-2">
                {metadata.workflowDescription}
              </Text>
            )}
          </div>
        </HStack>
        <Badge
          variant={
            status === 'approved'
              ? 'green'
              : status === 'rejected'
                ? 'destructive'
                : 'blue'
          }
          className="text-xs capitalize"
        >
          {status}
        </Badge>
      </HStack>

      {/* Parameters Preview */}
      {paramEntries.length > 0 && (
        <Stack gap={2} className="mb-3">
          <button
            type="button"
            onClick={() => setShowParams(!showParams)}
            className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs transition-colors"
            aria-expanded={showParams}
          >
            {showParams ? (
              <ChevronDown className="size-3" />
            ) : (
              <ChevronRight className="size-3" />
            )}
            {showParams ? t('hideParameters') : t('showParameters')}
          </button>

          {showParams && (
            <div className="bg-muted/50 space-y-0.5 rounded-md p-2">
              {paramEntries.map(([key, value]) => (
                <div key={key} className="flex gap-1.5 text-[11px]">
                  <Text as="span" className="text-muted-foreground shrink-0">
                    {key}:
                  </Text>
                  <Text
                    as="span"
                    className="min-w-0 font-mono text-[10px] break-all"
                  >
                    {typeof value === 'string' ? value : JSON.stringify(value)}
                  </Text>
                </div>
              ))}
            </div>
          )}
        </Stack>
      )}

      {/* Execution Result */}
      {status === 'approved' && executedAt && !executionError && (
        <HStack gap={1} className="mb-3 text-xs text-green-600">
          <CheckCircle className="size-3" />
          {t('statusApprovedSuccess')}
        </HStack>
      )}

      {/* Execution Error (persisted from backend) */}
      {status === 'approved' && executionError && (
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

      {/* Error Message (temporary UI error) */}
      {error && (
        <HStack
          gap={1}
          align="start"
          className="text-destructive mb-3 text-xs wrap-break-word"
          aria-live="polite"
        >
          <XCircle className="size-3 shrink-0" />
          <Text as="span" className="min-w-0">
            {error}
          </Text>
        </HStack>
      )}

      {/* Action Buttons */}
      {isPending && (
        <ActionRow gap={2}>
          <Tooltip content={t('approveTooltip')}>
            <Button
              size="sm"
              variant="success"
              onClick={handleApprove}
              disabled={isProcessing}
              aria-busy={isApproving}
              aria-label={t('approve')}
              className="flex-1"
            >
              {isApproving ? (
                <Loader2 className="mr-1 size-4 animate-spin" />
              ) : (
                <Play className="mr-1 size-4" />
              )}
              {t('approve')}
            </Button>
          </Tooltip>

          <Tooltip content={t('rejectTooltip')}>
            <Button
              size="sm"
              variant="destructive"
              onClick={handleReject}
              disabled={isProcessing}
              aria-busy={isRejecting}
              aria-label={t('reject')}
              className="flex-1"
            >
              {isRejecting ? (
                <Loader2 className="mr-1 size-4 animate-spin" />
              ) : (
                <XCircle className="mr-1 size-4" />
              )}
              {t('reject')}
            </Button>
          </Tooltip>
        </ActionRow>
      )}

      {/* Status message for resolved approvals */}
      {!isPending && (
        <Text as="div" variant="caption">
          {status === 'approved' && executionError
            ? t('statusApprovedFailed')
            : status === 'approved'
              ? t('statusApprovedSuccess')
              : t('statusRejected')}
        </Text>
      )}
    </div>
  );
}

export const WorkflowRunApprovalCard = memo(
  WorkflowRunApprovalCardComponent,
  (prevProps, nextProps) => {
    return (
      prevProps.approvalId === nextProps.approvalId &&
      prevProps.organizationId === nextProps.organizationId &&
      prevProps.status === nextProps.status &&
      prevProps.className === nextProps.className &&
      prevProps.executedAt === nextProps.executedAt &&
      prevProps.executionError === nextProps.executionError
    );
  },
);
