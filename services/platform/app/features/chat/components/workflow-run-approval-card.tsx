'use client';

import { Link } from '@tanstack/react-router';
import {
  ArrowLeft,
  Check,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  Loader2,
  MessageCircleQuestion,
  MessageSquareText,
  Play,
  Send,
  Square,
  XCircle,
} from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import type { Id } from '@/convex/_generated/dataModel';
import type { WorkflowRunMetadata } from '@/convex/approvals/types';
import type { HumanInputField } from '@/lib/shared/schemas/approvals';

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
import { useCopyButton } from '@/app/hooks/use-copy';
import { useT } from '@/lib/i18n/client';
import { FEEDBACK_KEY } from '@/lib/shared/schemas/approvals';
import { cn } from '@/lib/utils/cn';
import { stripLeadingPunctuation } from '@/lib/utils/text';

import { HumanInputFields } from './human-input-fields';
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
  const [humanInputFormValues, setHumanInputFormValues] = useState<
    Record<string, string | string[]>
  >({});

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
          formValues={humanInputFormValues}
          onFormValuesChange={setHumanInputFormValues}
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
                  setTimeout(() => {
                    setHumanInputFormValues({});
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
  formValues: Record<string, string | string[]>;
  onFormValuesChange: (values: Record<string, string | string[]>) => void;
  isSubmitting: boolean;
  onSubmit: (response: string) => void;
}

function WorkflowHumanInputSection({
  approval,
  formValues,
  onFormValuesChange,
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

  const rawFields = Array.isArray(meta.fields) ? meta.fields : [];
  const fields = rawFields.filter(
    (f): f is HumanInputField =>
      typeof f === 'object' &&
      f !== null &&
      'label' in f &&
      typeof f.label === 'string' &&
      'type' in f &&
      typeof f.type === 'string',
  );

  const copyText = useMemo(() => {
    const lines = fields.map((field) => {
      const parts = [`- ${field.label}`];
      if (field.description) parts.push(`  ${field.description}`);
      if ('options' in field && field.options) {
        for (const opt of field.options) {
          parts.push(
            `  - ${opt.label}${opt.description ? ` (${opt.description})` : ''}`,
          );
        }
      }
      return parts.join('\n');
    });
    return `${question}\n\n${lines.join('\n')}`;
  }, [question, fields]);

  const { copied: isCopied, onClick: handleCopyQuestions } =
    useCopyButton(copyText);

  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackText, setFeedbackText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback(() => {
    for (const field of fields) {
      if (!field.required) continue;
      const value = formValues[field.label];

      if (field.type === 'single_select' || field.type === 'yes_no') {
        if (!value || (typeof value === 'string' && !value.trim())) {
          setError(t('errorSelectRequired'));
          return;
        }
      } else if (field.type === 'multi_select') {
        if (!value || !Array.isArray(value) || value.length === 0) {
          setError(t('errorSelectRequired'));
          return;
        }
      } else {
        if (!value || (typeof value === 'string' && !value.trim())) {
          setError(t('errorFillRequiredFields'));
          return;
        }
      }
    }
    setError(null);
    onSubmit(JSON.stringify(formValues));
  }, [t, fields, formValues, onSubmit]);

  const handleSubmitFeedback = useCallback(() => {
    if (!feedbackText.trim()) {
      setError(t('errorFeedbackRequired'));
      return;
    }
    setError(null);
    onSubmit(JSON.stringify({ [FEEDBACK_KEY]: feedbackText.trim() }));
  }, [t, feedbackText, onSubmit]);

  return (
    <Stack gap={3} className="mb-3">
      <HStack gap={2} align="start" justify="between">
        <HStack gap={2} align="start" className="min-w-0 flex-1">
          <MessageCircleQuestion className="text-primary mt-0.5 size-4 shrink-0" />
          <div
            className={cn(
              markdownWrapperStyles,
              'max-w-none text-sm font-medium',
            )}
          >
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {question}
            </ReactMarkdown>
          </div>
        </HStack>
        <Tooltip content={t('copyQuestions')}>
          <button
            type="button"
            onClick={handleCopyQuestions}
            aria-label={t('copyQuestions')}
            className="text-muted-foreground hover:text-foreground shrink-0 cursor-pointer p-1 transition-colors"
          >
            {isCopied ? (
              <Check className="size-3.5 text-green-500" />
            ) : (
              <Copy className="size-3.5" />
            )}
          </button>
        </Tooltip>
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

      {showFeedback ? (
        <>
          <Textarea
            value={feedbackText}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
              setFeedbackText(e.target.value)
            }
            placeholder={t('pushbackPlaceholder')}
            aria-label={t('pushback')}
            className="min-h-[80px] text-sm"
            disabled={isSubmitting}
            autoFocus
          />
          <HStack gap={2}>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setShowFeedback(false)}
              disabled={isSubmitting}
              className="flex-1"
            >
              <ArrowLeft className="mr-2 size-4" />
              {t('backToForm')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleSubmitFeedback}
              disabled={isSubmitting}
              className="flex-1"
            >
              {isSubmitting ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Send className="mr-2 size-4" />
              )}
              {t('sendFeedback')}
            </Button>
          </HStack>
        </>
      ) : (
        <>
          <HumanInputFields
            fields={fields}
            disabled={isSubmitting}
            formValues={formValues}
            onFormValuesChange={onFormValuesChange}
          />
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
          <button
            type="button"
            onClick={() => setShowFeedback(true)}
            className="text-muted-foreground hover:text-foreground flex cursor-pointer items-center justify-center gap-1.5 text-xs transition-colors"
          >
            <MessageSquareText className="size-3" />
            {t('pushback')}
          </button>
        </>
      )}

      {error && (
        <HStack role="alert" className="text-destructive gap-1.5 text-xs">
          <XCircle className="size-3.5" aria-hidden="true" />
          {error}
        </HStack>
      )}
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
