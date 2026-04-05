'use client';

import {
  ArrowLeft,
  Check,
  Copy,
  XCircle,
  Loader2,
  MessageCircleQuestion,
  MessageSquareText,
  Send,
  Square,
} from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import type { Id } from '@/convex/_generated/dataModel';
import type { HumanInputRequestMetadata } from '@/lib/shared/schemas/approvals';

import { Badge } from '@/app/components/ui/feedback/badge';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { HStack, Stack } from '@/app/components/ui/layout/layout';
import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { Button } from '@/app/components/ui/primitives/button';
import { Text } from '@/app/components/ui/typography/text';
import { useCopyButton } from '@/app/hooks/use-copy';
import { useFormatDate } from '@/app/hooks/use-format-date';
import { useT } from '@/lib/i18n/client';
import { FEEDBACK_KEY } from '@/lib/shared/schemas/approvals';
import { cn } from '@/lib/utils/cn';
import { stripLeadingPunctuation } from '@/lib/utils/text';
import { getString, isRecord } from '@/lib/utils/type-guards';

import { useChatLayout } from '../context/chat-layout-context';
import { useSubmitHumanInputResponse } from '../hooks/mutations';
import { useEffectiveAgent } from '../hooks/use-effective-agent';
import { useCancelExecution } from '../hooks/use-execution-status';
import { HumanInputFields } from './human-input-fields';
import { markdownWrapperStyles } from './message-bubble/markdown-renderer';

interface HumanInputRequestCardProps {
  approvalId: Id<'approvals'>;
  organizationId: string;
  status: 'pending' | 'executing' | 'completed' | 'rejected';
  metadata: HumanInputRequestMetadata;
  isWorkflowContext?: boolean;
  wfExecutionId?: Id<'wfExecutions'>;
  className?: string;
  onResponseSubmitted?: () => void;
}

function HumanInputRequestCardComponent({
  approvalId,
  organizationId,
  status,
  metadata,
  isWorkflowContext,
  wfExecutionId,
  className,
  onResponseSubmitted,
}: HumanInputRequestCardProps) {
  const { t } = useT('humanInputRequest');
  const { t: tCommon } = useT('approvalCommon');
  const { formatDate } = useFormatDate();
  const [error, setError] = useState<string | null>(null);
  const [formValues, setFormValues] = useState<
    Record<string, string | string[]>
  >({});

  const { selectedModelOverrides } = useChatLayout();
  const { agent: effectiveAgent } = useEffectiveAgent(organizationId);
  const modelId = useMemo(
    () =>
      effectiveAgent?.name
        ? selectedModelOverrides[effectiveAgent.name]
        : undefined,
    [effectiveAgent?.name, selectedModelOverrides],
  );

  const { mutate: submitResponse, isPending: isSubmitting } =
    useSubmitHumanInputResponse();
  const { mutateAsync: cancelExecution } = useCancelExecution();
  const [isCancelling, setIsCancelling] = useState(false);

  const handleCancel = useCallback(async () => {
    if (!wfExecutionId) return;
    setIsCancelling(true);
    setError(null);
    try {
      await cancelExecution({
        executionId: wfExecutionId,
      });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : tCommon('errorSubmitFailed'),
      );
      console.error('Failed to cancel execution:', err);
    } finally {
      setIsCancelling(false);
    }
  }, [wfExecutionId, cancelExecution, tCommon]);

  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackText, setFeedbackText] = useState('');

  const handleSubmitFeedback = useCallback(() => {
    if (!feedbackText.trim()) {
      setError(t('errorFeedbackRequired'));
      return;
    }
    setError(null);
    const response = JSON.stringify({ [FEEDBACK_KEY]: feedbackText.trim() });
    submitResponse(
      { approvalId, response, modelId },
      {
        onSuccess: () => {
          if (!isWorkflowContext) {
            onResponseSubmitted?.();
          }
        },
        onError: (err) => {
          setError(
            err instanceof Error ? err.message : tCommon('errorSubmitFailed'),
          );
          console.error('Failed to submit feedback:', err);
        },
      },
    );
  }, [
    t,
    tCommon,
    feedbackText,
    isWorkflowContext,
    approvalId,
    modelId,
    submitResponse,
    onResponseSubmitted,
  ]);

  const copyText = useMemo(() => {
    const fields = metadata.fields ?? [];
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
    return `${metadata.question}\n\n${lines.join('\n')}`;
  }, [metadata.question, metadata.fields]);

  const { copied: isCopied, onClick: handleCopyQuestions } =
    useCopyButton(copyText);

  const isPending = status === 'pending';

  const handleSubmit = useCallback(() => {
    const fields = metadata.fields ?? [];

    // Validate required fields
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

    const response = JSON.stringify(formValues);

    submitResponse(
      { approvalId, response, modelId },
      {
        onSuccess: () => {
          if (!isWorkflowContext) {
            onResponseSubmitted?.();
          }
        },
        onError: (err) => {
          setError(
            err instanceof Error ? err.message : tCommon('errorSubmitFailed'),
          );
          console.error('Failed to submit response:', err);
        },
      },
    );
  }, [
    t,
    tCommon,
    metadata.fields,
    formValues,
    isWorkflowContext,
    approvalId,
    modelId,
    submitResponse,
    onResponseSubmitted,
  ]);

  const renderResponse = () => {
    if (!metadata.response) return null;

    const { value, respondedBy, timestamp } = metadata.response;

    let displayContent: React.ReactNode;
    if (typeof value === 'string') {
      try {
        const parsed: unknown = JSON.parse(value);
        if (isRecord(parsed)) {
          const feedbackVal = getString(parsed, FEEDBACK_KEY);
          if (feedbackVal !== undefined) {
            displayContent = (
              <Text as="div" variant="label" className="italic">
                {feedbackVal}
              </Text>
            );
          } else {
            displayContent = (
              <Stack gap={1}>
                {Object.entries(parsed).map(([key, val]) => (
                  <div key={key} className="flex gap-2 text-sm">
                    <Text as="span" className="text-muted-foreground shrink-0">
                      {key}:
                    </Text>
                    <Text as="span">
                      {Array.isArray(val) ? val.join(', ') : String(val)}
                    </Text>
                  </div>
                ))}
              </Stack>
            );
          }
        } else {
          displayContent = (
            <Text as="div" variant="label">
              {value}
            </Text>
          );
        }
      } catch (e) {
        console.error('Failed to parse human input response JSON:', e);
        displayContent = (
          <Text as="div" variant="label">
            {value}
          </Text>
        );
      }
    } else {
      displayContent = (
        <Text as="div" variant="label">
          {value.join(', ')}
        </Text>
      );
    }

    return (
      <Stack gap={2} className="bg-muted/50 rounded-lg p-4">
        {displayContent}
        <Text as="div" variant="caption">
          {t('respondedByAt', {
            name: respondedBy,
            date: formatDate(new Date(timestamp), 'long'),
          })}
        </Text>
      </Stack>
    );
  };

  return (
    <div
      className={cn(
        'rounded-xl border border-border p-5 bg-card w-full max-w-xl',
        className,
      )}
    >
      {/* Header */}
      <HStack gap={3} align="center" justify="between" className="mb-4">
        <HStack gap={3}>
          <MessageCircleQuestion className="text-primary size-5 shrink-0" />
          <div className="text-base font-semibold">{t('questionTitle')}</div>
        </HStack>
        <Tooltip content={t('copyQuestions')}>
          <button
            type="button"
            onClick={handleCopyQuestions}
            aria-label={t('copyQuestions')}
            className="text-muted-foreground hover:text-foreground shrink-0 cursor-pointer p-1 transition-colors"
          >
            {isCopied ? (
              <Check className="size-4 text-green-500" />
            ) : (
              <Copy className="size-4" />
            )}
          </button>
        </Tooltip>
      </HStack>

      {/* Question */}
      <div className="mb-4">
        <div
          className={cn(
            markdownWrapperStyles,
            'max-w-none text-sm leading-relaxed',
          )}
        >
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {stripLeadingPunctuation(metadata.question)}
          </ReactMarkdown>
        </div>
        {metadata.context && (
          <div
            className={cn(
              markdownWrapperStyles,
              'text-muted-foreground mt-2 max-w-none text-xs',
            )}
          >
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {metadata.context}
            </ReactMarkdown>
          </div>
        )}
      </div>

      {/* Input or Response */}
      {isPending ? (
        <Stack gap={4}>
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
                  onClick={() => setShowFeedback(false)}
                  disabled={isSubmitting}
                  className="flex-1"
                >
                  <ArrowLeft className="mr-2 size-4" />
                  {t('backToForm')}
                </Button>
                <Button
                  variant="secondary"
                  onClick={handleSubmitFeedback}
                  disabled={isSubmitting || isCancelling}
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
                fields={metadata.fields ?? []}
                disabled={isSubmitting}
                formValues={formValues}
                onFormValuesChange={setFormValues}
              />
              <Button
                onClick={handleSubmit}
                disabled={isSubmitting || isCancelling}
                className="w-full"
              >
                {isSubmitting ? (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                ) : (
                  <Send className="mr-2 size-4" />
                )}
                {t('submit')}
              </Button>
              <button
                type="button"
                onClick={() => setShowFeedback(true)}
                className="text-muted-foreground hover:text-foreground flex cursor-pointer items-center justify-center gap-1.5 text-xs transition-colors"
              >
                <MessageSquareText className="size-3.5" />
                {t('pushback')}
              </button>
            </>
          )}

          {/* Error Message */}
          {error && (
            <HStack role="alert" className="text-destructive gap-1.5 text-xs">
              <XCircle className="size-3.5" aria-hidden="true" />
              {error}
            </HStack>
          )}
        </Stack>
      ) : (
        renderResponse()
      )}

      {/* Footer: stop workflow link + status badge */}
      {(wfExecutionId && isPending) || !isPending ? (
        <HStack justify="end" align="center" gap={2} className="mt-2">
          {wfExecutionId && isPending && (
            <Tooltip content={t('stopWorkflowTooltip')}>
              <button
                type="button"
                onClick={handleCancel}
                disabled={isCancelling}
                aria-busy={isCancelling}
                aria-label={t('stopWorkflow')}
                className="text-muted-foreground hover:text-destructive flex cursor-pointer items-center gap-1 text-xs transition-colors disabled:opacity-50"
              >
                {isCancelling ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <Square className="size-3 fill-current" />
                )}
                {t('stopWorkflow')}
              </button>
            </Tooltip>
          )}
          {!isPending && (
            <Badge
              variant={
                status === 'completed'
                  ? 'green'
                  : status === 'executing'
                    ? 'blue'
                    : 'destructive'
              }
              className="shrink-0 text-xs capitalize"
            >
              {status === 'completed'
                ? t('statusResponded')
                : status === 'executing'
                  ? t('statusProcessing')
                  : status}
            </Badge>
          )}
        </HStack>
      ) : null}
    </div>
  );
}

export const HumanInputRequestCard = memo(
  HumanInputRequestCardComponent,
  (prevProps, nextProps) => {
    return (
      prevProps.approvalId === nextProps.approvalId &&
      prevProps.organizationId === nextProps.organizationId &&
      prevProps.status === nextProps.status &&
      prevProps.metadata === nextProps.metadata &&
      prevProps.isWorkflowContext === nextProps.isWorkflowContext &&
      prevProps.wfExecutionId === nextProps.wfExecutionId &&
      prevProps.className === nextProps.className &&
      prevProps.onResponseSubmitted === nextProps.onResponseSubmitted
    );
  },
);
