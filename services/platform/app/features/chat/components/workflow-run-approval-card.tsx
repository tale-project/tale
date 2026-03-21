'use client';

import { Link } from '@tanstack/react-router';
import {
  CheckCircle,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Loader2,
  MessageCircleQuestion,
  Play,
  Send,
  Square,
  XCircle,
} from 'lucide-react';
import { memo, useCallback, useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import type { Id } from '@/convex/_generated/dataModel';
import type { WorkflowRunMetadata } from '@/convex/approvals/types';

import { Badge } from '@/app/components/ui/feedback/badge';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { ActionRow } from '@/app/components/ui/layout/action-row';
import { HStack, Stack } from '@/app/components/ui/layout/layout';
import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { Button } from '@/app/components/ui/primitives/button';
import { Text } from '@/app/components/ui/typography/text';
import {
  useExecuteApprovedWorkflowRun,
  useUpdateApprovalStatus,
} from '@/app/features/chat/hooks/mutations';
import { useSubmitHumanInputResponse } from '@/app/features/chat/hooks/mutations';
import {
  useCancelExecution,
  useExecutionStatus,
  useWorkflowHumanInputApproval,
} from '@/app/features/chat/hooks/use-execution-status';
import { useAuth } from '@/app/hooks/use-convex-auth';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';
import { stripLeadingPunctuation } from '@/lib/utils/text';

import { markdownWrapperStyles } from './message-bubble/markdown-renderer';

interface WorkflowRunApprovalCardProps {
  approvalId: Id<'approvals'>;
  organizationId: string;
  status: 'pending' | 'executing' | 'completed' | 'rejected';
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
  let str: string;
  if (typeof output === 'string') {
    str = output;
  } else {
    try {
      str = JSON.stringify(output, null, 2);
    } catch {
      str = '[Complex object]';
    }
  }
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
  const { t: tCommon } = useT('approvalCommon');
  const { user } = useAuth();
  const [isApproving, setIsApproving] = useState(false);
  const [isRejecting, setIsRejecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showParams, setShowParams] = useState(false);
  const [showOutput, setShowOutput] = useState(false);
  const [elapsed, setElapsed] = useState('');

  const { mutateAsync: updateApprovalStatus } = useUpdateApprovalStatus();
  const { mutateAsync: executeApprovedRun } = useExecuteApprovedWorkflowRun();
  const { mutateAsync: cancelExecution } = useCancelExecution();
  const [isCancelling, setIsCancelling] = useState(false);

  const executionId =
    (status === 'executing' || status === 'completed') && metadata.executionId
      ? // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- metadata.executionId is a string from Convex approval doc; cast to branded Id type required by the query
        (metadata.executionId as Id<'wfExecutions'>)
      : undefined;
  const { data: executionStatus } = useExecutionStatus(executionId);

  const isRunning =
    executionStatus?.status === 'pending' ||
    executionStatus?.status === 'running';

  // Human input request for paused workflow
  const waitingForApprovalId =
    executionStatus?.status === 'running' && executionStatus?.waitingFor
      ? executionStatus.waitingFor
      : undefined;
  const { data: humanInputApproval } =
    useWorkflowHumanInputApproval(waitingForApprovalId);
  const isWaitingForHumanInput = !!waitingForApprovalId && !!humanInputApproval;

  const { mutate: submitHumanInput, isPending: isSubmittingHumanInput } =
    useSubmitHumanInputResponse();
  const [humanInputValue, setHumanInputValue] = useState('');
  const [humanInputSelected, setHumanInputSelected] = useState<string>('');
  const [humanInputMulti, setHumanInputMulti] = useState<string[]>([]);

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
      setError(tCommon('errorNotAuthenticated'));
      return;
    }
    setIsApproving(true);
    setError(null);
    try {
      await updateApprovalStatus({
        approvalId,
        status: 'executing',
      });
      await executeApprovedRun({
        approvalId,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorRunFailed'));
      console.error('Failed to approve workflow run:', err);
    } finally {
      setIsApproving(false);
    }
  };

  const handleReject = async () => {
    if (!user?.userId) {
      setError(tCommon('errorNotAuthenticated'));
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
      setError(
        err instanceof Error ? err.message : tCommon('errorRejectFailed'),
      );
      console.error('Failed to reject workflow run:', err);
    } finally {
      setIsRejecting(false);
    }
  };

  const handleCancel = async () => {
    if (!executionId) return;
    setIsCancelling(true);
    setError(null);
    try {
      await cancelExecution({ executionId });
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorStopFailed'));
      console.error('Failed to cancel execution:', err);
    } finally {
      setIsCancelling(false);
    }
  };

  return (
    <div
      className={cn(
        'rounded-xl border border-border p-4 bg-card max-w-md overflow-hidden',
        className,
      )}
    >
      {/* Header */}
      <HStack gap={2} align="start" justify="between" className="mb-3">
        <HStack gap={2}>
          <Play className="text-primary size-4 shrink-0" />
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
      </HStack>

      {/* Parameters Preview */}
      {paramEntries.length > 0 && (
        <Stack gap={2} className="mb-3">
          <button
            type="button"
            onClick={() => setShowParams(!showParams)}
            className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs transition-colors"
            aria-expanded={showParams}
            aria-label={showParams ? t('hideParameters') : t('showParameters')}
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
                <div
                  key={key}
                  className="flex items-baseline gap-1.5 text-[11px]"
                >
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

      {/* Human Input Request (paused workflow waiting for user response) */}
      {isWaitingForHumanInput && humanInputApproval && (
        <WorkflowHumanInputSection
          approval={humanInputApproval}
          inputValue={humanInputValue}
          onInputChange={setHumanInputValue}
          selectedValue={humanInputSelected}
          onSelectedChange={setHumanInputSelected}
          multiValues={humanInputMulti}
          onMultiChange={setHumanInputMulti}
          isSubmitting={isSubmittingHumanInput}
          onSubmit={(response) => {
            submitHumanInput(
              {
                // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- _id from query result is a string at runtime but typed as Id<'approvals'> by Convex
                approvalId: humanInputApproval._id as Id<'approvals'>,
                response,
              },
              {
                onSuccess: () => {
                  // Defer clear so the Convex subscription hides the form first,
                  // then clear state invisibly for the next human input request
                  setTimeout(() => {
                    setHumanInputValue('');
                    setHumanInputSelected('');
                    setHumanInputMulti([]);
                  }, 500);
                },
                onError: (err) => {
                  setError(
                    err instanceof Error
                      ? err.message
                      : tCommon('errorSubmitFailed'),
                  );
                },
              },
            );
          }}
        />
      )}

      {/* Live Execution Status */}
      {(status === 'executing' || status === 'completed') &&
        executionId &&
        !isWaitingForHumanInput && (
          <Stack gap={1} className="mb-3" role="status" aria-live="polite">
            {isRunning && (
              <>
                <HStack gap={1} justify="between" className="text-xs">
                  <HStack gap={1} className="text-primary">
                    <Loader2 className="size-3 animate-spin" />
                    {executionStatus?.currentStepName
                      ? executionStatus.loopProgress
                        ? t('executionRunningStepWithProgress', {
                            step: executionStatus.currentStepName,
                            current: executionStatus.loopProgress.current,
                            total: executionStatus.loopProgress.total,
                          })
                        : t('executionRunningStep', {
                            step: executionStatus.currentStepName,
                          })
                      : t('executionRunning')}
                  </HStack>
                  <Tooltip content={t('stopTooltip')}>
                    <button
                      type="button"
                      onClick={handleCancel}
                      disabled={isCancelling}
                      aria-busy={isCancelling}
                      aria-label={t('stopExecution')}
                      className="text-muted-foreground hover:text-destructive flex cursor-pointer items-center gap-1 text-xs transition-colors disabled:opacity-50"
                    >
                      {isCancelling ? (
                        <Loader2 className="size-3 animate-spin" />
                      ) : (
                        <Square className="size-3 fill-current" />
                      )}
                      {t('stopExecution')}
                    </button>
                  </Tooltip>
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
                      aria-label={
                        showOutput ? t('hideOutput') : t('showOutput')
                      }
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
      {(status === 'executing' || status === 'completed') &&
        !executionId &&
        executionError && (
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
              variant="primary"
              onClick={handleApprove}
              disabled={isProcessing}
              aria-busy={isApproving}
              aria-label={t('approve')}
              className="flex-1"
            >
              {isApproving && <Loader2 className="mr-1 size-4 animate-spin" />}
              {t('approve')}
            </Button>
          </Tooltip>

          <Tooltip content={t('rejectTooltip')}>
            <Button
              size="sm"
              variant="secondary"
              onClick={handleReject}
              disabled={isProcessing}
              aria-busy={isRejecting}
              aria-label={tCommon('reject')}
              className="flex-1"
            >
              {isRejecting && <Loader2 className="mr-1 size-4 animate-spin" />}
              {tCommon('reject')}
            </Button>
          </Tooltip>
        </ActionRow>
      )}

      {/* Status badge */}
      {status !== 'pending' && (
        <HStack
          justify={status === 'rejected' ? 'between' : 'end'}
          align="center"
          className="mt-2"
        >
          {status === 'rejected' && (
            <Text as="div" variant="caption">
              {t('statusRejected')}
            </Text>
          )}
          <HStack gap={2} align="center">
            {isWaitingForHumanInput && (
              <Tooltip content={t('stopTooltip')}>
                <button
                  type="button"
                  onClick={handleCancel}
                  disabled={isCancelling}
                  aria-busy={isCancelling}
                  aria-label={t('stopExecution')}
                  className="text-muted-foreground hover:text-destructive flex cursor-pointer items-center gap-1 text-xs transition-colors disabled:opacity-50"
                >
                  {isCancelling ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <Square className="size-3 fill-current" />
                  )}
                  {t('stopExecution')}
                </button>
              </Tooltip>
            )}
            <Badge
              variant={
                status === 'completed'
                  ? 'green'
                  : status === 'executing'
                    ? 'blue'
                    : 'destructive'
              }
              className="shrink-0 text-xs"
            >
              {status === 'executing'
                ? t('statusExecuting')
                : status === 'completed'
                  ? t('statusCompleted')
                  : t('statusRejected')}
            </Badge>
          </HStack>
        </HStack>
      )}
    </div>
  );
}

interface WorkflowHumanInputSectionProps {
  approval: {
    _id: string;
    metadata?: Record<string, unknown> | null;
  };
  inputValue: string;
  onInputChange: (value: string) => void;
  selectedValue: string;
  onSelectedChange: (value: string) => void;
  multiValues: string[];
  onMultiChange: (values: string[]) => void;
  isSubmitting: boolean;
  onSubmit: (response: string | string[]) => void;
}

function WorkflowHumanInputSection({
  approval,
  inputValue,
  onInputChange,
  selectedValue,
  onSelectedChange,
  multiValues,
  onMultiChange,
  isSubmitting,
  onSubmit,
}: WorkflowHumanInputSectionProps) {
  const { t } = useT('workflowRunApproval');
  const meta = approval.metadata ?? {};
  const question =
    typeof meta.question === 'string'
      ? stripLeadingPunctuation(meta.question)
      : '';
  const context = typeof meta.context === 'string' ? meta.context : undefined;
  const format = typeof meta.format === 'string' ? meta.format : 'text_input';
  const rawOptions = Array.isArray(meta.options) ? meta.options : [];
  const options = rawOptions.filter(
    (opt): opt is { label: string; value?: string; description?: string } =>
      typeof opt === 'object' &&
      opt !== null &&
      'label' in opt &&
      typeof opt.label === 'string',
  );

  const getOptionValue = (opt: { label: string; value?: string }) =>
    opt.value ?? opt.label;

  const handleSubmit = useCallback(() => {
    switch (format) {
      case 'text_input':
        if (inputValue.trim()) onSubmit(inputValue.trim());
        break;
      case 'single_select':
      case 'yes_no':
        if (selectedValue) onSubmit(selectedValue);
        break;
      case 'multi_select':
        if (multiValues.length > 0) onSubmit(multiValues);
        break;
    }
  }, [format, inputValue, selectedValue, multiValues, onSubmit]);

  return (
    <Stack gap={3} className="mb-3">
      <HStack gap={2} align="start">
        <MessageCircleQuestion className="text-primary mt-0.5 size-4 shrink-0" />
        <div
          className={cn(
            markdownWrapperStyles,
            'max-w-none text-sm font-medium',
          )}
        >
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{question}</ReactMarkdown>
        </div>
      </HStack>
      {context && (
        <div
          className={cn(
            markdownWrapperStyles,
            'text-muted-foreground max-w-none text-xs',
          )}
        >
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{context}</ReactMarkdown>
        </div>
      )}

      {format === 'text_input' && (
        <Textarea
          value={inputValue}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
            onInputChange(e.target.value)
          }
          placeholder={t('humanInputPlaceholder')}
          className="min-h-[80px] text-sm"
          disabled={isSubmitting}
        />
      )}

      {(format === 'single_select' || format === 'yes_no') &&
        options.map((opt) => {
          const val = getOptionValue(opt);
          return (
            <button
              key={val}
              type="button"
              role="radio"
              aria-checked={selectedValue === val}
              className={cn(
                'flex items-start gap-3 rounded-lg border p-3 text-left transition-all',
                selectedValue === val
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-primary/50 hover:bg-muted/30',
              )}
              onClick={() => onSelectedChange(val)}
              disabled={isSubmitting}
            >
              <div
                aria-hidden="true"
                className={cn(
                  'mt-0.5 size-4 shrink-0 rounded-full border-2',
                  selectedValue === val
                    ? 'border-primary bg-primary'
                    : 'border-muted-foreground',
                )}
              />
              <div className="flex-1">
                <Text as="span" variant="label" className="text-sm">
                  {opt.label}
                </Text>
                {opt.description && (
                  <Text as="div" variant="caption" className="mt-0.5 text-xs">
                    {opt.description}
                  </Text>
                )}
              </div>
            </button>
          );
        })}

      {format === 'multi_select' &&
        options.map((opt) => {
          const val = getOptionValue(opt);
          const isChecked = multiValues.includes(val);
          return (
            <button
              key={val}
              type="button"
              aria-pressed={isChecked}
              className={cn(
                'flex items-start gap-3 rounded-lg border p-3 text-left transition-all',
                isChecked
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-primary/50 hover:bg-muted/30',
              )}
              onClick={() =>
                onMultiChange(
                  isChecked
                    ? multiValues.filter((v) => v !== val)
                    : [...multiValues, val],
                )
              }
              disabled={isSubmitting}
            >
              <div
                aria-hidden="true"
                className={cn(
                  'mt-0.5 size-4 shrink-0 rounded border',
                  isChecked
                    ? 'border-primary bg-primary'
                    : 'border-muted-foreground',
                )}
              />
              <div className="flex-1">
                <Text as="span" variant="label" className="text-sm">
                  {opt.label}
                </Text>
                {opt.description && (
                  <Text as="div" variant="caption" className="mt-0.5 text-xs">
                    {opt.description}
                  </Text>
                )}
              </div>
            </button>
          );
        })}

      <Button
        onClick={handleSubmit}
        disabled={isSubmitting}
        size="sm"
        className="w-full"
      >
        {isSubmitting ? (
          <Loader2 className="mr-2 size-4 animate-spin" />
        ) : (
          <Send className="mr-2 size-4" />
        )}
        {t('submitResponse')}
      </Button>
    </Stack>
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
