'use client';

import { Link } from '@tanstack/react-router';
import {
  CheckCircle,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Loader2,
  Play,
  XCircle,
} from 'lucide-react';
import { memo, useEffect, useState } from 'react';

import type { Id } from '@/convex/_generated/dataModel';
import type { WorkflowRunMetadata } from '@/convex/approvals/types';

import { Badge } from '@/app/components/ui/feedback/badge';
import { ActionRow } from '@/app/components/ui/layout/action-row';
import { HStack, Stack } from '@/app/components/ui/layout/layout';
import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { Button } from '@/app/components/ui/primitives/button';
import { Text } from '@/app/components/ui/typography/text';
import { useExecuteApprovedWorkflowRun } from '@/app/features/approvals/hooks/actions';
import { useUpdateApprovalStatus } from '@/app/features/approvals/hooks/mutations';
import { useExecutionStatus } from '@/app/features/chat/hooks/use-execution-status';
import { useAuth } from '@/app/hooks/use-convex-auth';
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

function formatElapsed(startMs: number) {
  const elapsed = Math.floor((Date.now() - startMs) / 1000);
  if (elapsed < 60) return `${elapsed}s`;
  const minutes = Math.floor(elapsed / 60);
  if (minutes < 60) return `${minutes}m ${elapsed % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function formatOutputPreview(output: unknown) {
  if (output === null || output === undefined) return null;
  const str =
    typeof output === 'string' ? output : JSON.stringify(output, null, 2);
  return str.length > 300 ? `${str.slice(0, 300)}…` : str;
}

function WorkflowRunApprovalCardComponent({
  approvalId,
  organizationId,
  status,
  metadata,
  executionError,
  className,
}: WorkflowRunApprovalCardProps) {
  const { t } = useT('workflowRunApproval');
  const { user } = useAuth();
  const [isApproving, setIsApproving] = useState(false);
  const [isRejecting, setIsRejecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showParams, setShowParams] = useState(false);
  const [showOutput, setShowOutput] = useState(false);
  const [elapsed, setElapsed] = useState('');

  const { mutateAsync: updateApprovalStatus } = useUpdateApprovalStatus();
  const { mutateAsync: executeApprovedRun } = useExecuteApprovedWorkflowRun();

  const executionId =
    status === 'approved' && metadata.executionId
      ? // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- metadata.executionId is a string from Convex approval doc; cast to branded Id type required by the query
        (metadata.executionId as Id<'wfExecutions'>)
      : undefined;
  const { data: executionStatus } = useExecutionStatus(executionId);

  const isRunning =
    executionStatus?.status === 'pending' ||
    executionStatus?.status === 'running';

  useEffect(() => {
    if (!isRunning || !executionStatus?.startedAt) return;
    setElapsed(formatElapsed(executionStatus.startedAt));
    const interval = setInterval(() => {
      setElapsed(formatElapsed(executionStatus.startedAt));
    }, 1000);
    return () => clearInterval(interval);
  }, [isRunning, executionStatus?.startedAt]);

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

      {/* Live Execution Status */}
      {status === 'approved' && executionId && (
        <Stack gap={1} className="mb-3" aria-live="polite">
          {isRunning && (
            <>
              <HStack gap={1} className="text-primary text-xs">
                <Loader2 className="size-3 animate-spin" />
                {executionStatus?.currentStepSlug
                  ? t('executionRunningStep', {
                      step: executionStatus.currentStepSlug,
                    })
                  : t('executionRunning')}
              </HStack>
              {elapsed && (
                <Text as="div" variant="caption">
                  {t('executionElapsed', { duration: elapsed })}
                </Text>
              )}
            </>
          )}

          {executionStatus?.status === 'completed' && (
            <>
              <HStack gap={1} className="text-xs text-green-600">
                <CheckCircle className="size-3" />
                {t('executionCompleted')}
              </HStack>
              {executionStatus.output != null && (
                <>
                  <button
                    type="button"
                    onClick={() => setShowOutput(!showOutput)}
                    className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs transition-colors"
                    aria-expanded={showOutput}
                  >
                    {showOutput ? (
                      <ChevronDown className="size-3" />
                    ) : (
                      <ChevronRight className="size-3" />
                    )}
                    {showOutput ? t('hideOutput') : t('showOutput')}
                  </button>
                  {showOutput && (
                    <pre className="bg-muted/50 max-h-40 overflow-auto rounded-md p-2 font-mono text-[10px] break-all whitespace-pre-wrap">
                      {formatOutputPreview(executionStatus.output)}
                    </pre>
                  )}
                </>
              )}
            </>
          )}

          {executionStatus?.status === 'failed' && (
            <HStack
              gap={1}
              align="start"
              className="text-destructive text-xs wrap-break-word"
            >
              <XCircle className="size-3 shrink-0" />
              <Text as="span" className="min-w-0">
                {executionStatus.error || t('executionFailed')}
              </Text>
            </HStack>
          )}

          {(executionStatus?.status === 'completed' ||
            executionStatus?.status === 'failed') && (
            <Link
              to="/dashboard/$id/automations/$amId/executions"
              params={{
                id: organizationId,
                amId: metadata.workflowId,
              }}
              className="text-primary flex items-center gap-1 text-xs hover:underline"
            >
              {t('viewDetails')}
              <ExternalLink className="size-3" />
            </Link>
          )}
        </Stack>
      )}

      {/* Execution startup error (no executionId — workflow failed to start) */}
      {status === 'approved' && !executionId && executionError && (
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

      {/* Status message for rejected approvals */}
      {status === 'rejected' && (
        <Text as="div" variant="caption">
          {t('statusRejected')}
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
