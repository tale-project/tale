'use client';

import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { HStack, Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import {
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  XCircle,
  Loader2,
  MessageCircleQuestion,
  MessageSquareText,
  Pencil,
  Send,
  Square,
} from 'lucide-react';
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { Textarea } from '@/app/components/ui/forms/textarea';
import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { mapExecutionError } from '@/app/features/operator/lib/map-execution-error';
import { useCopyButton } from '@/app/hooks/use-copy';
import { useFormatDate } from '@/app/hooks/use-format-date';
import { usePrefersReducedMotion } from '@/app/hooks/use-prefers-reduced-motion';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';
import type {
  HumanInputRequestMetadata,
  HumanInputResponse,
} from '@/lib/shared/schemas/approvals';
import { FEEDBACK_KEY } from '@/lib/shared/schemas/approvals';
import { cn } from '@/lib/utils/cn';
import { stripLeadingPunctuation } from '@/lib/utils/string';
import { getString, isRecord } from '@/lib/utils/type-utils';

import { useChatLayout } from '../context/chat-layout-context';
import {
  useEditHumanInputResponse,
  useSubmitHumanInputResponse,
} from '../hooks/mutations';
import { useEffectiveAgent } from '../hooks/use-effective-agent';
import { useCancelExecution } from '../hooks/use-execution-status';
import { mapHumanInputError } from '../lib/map-human-input-error';
import { ApprovalCard } from './approval-card';
import { HumanInputFields, countFilledTodoRows } from './human-input-fields';
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
  const { t: tShared } = useT('common');
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

  const { mutate: submitResponse, isPending: isSubmitPending } =
    useSubmitHumanInputResponse();
  const { mutate: editResponse, isPending: isEditPending } =
    useEditHumanInputResponse();
  const isSubmitting = isSubmitPending || isEditPending;
  const { mutateAsync: cancelExecution } = useCancelExecution();
  const [isCancelling, setIsCancelling] = useState(false);

  // Editing an already-submitted response (chat context only): re-opens the
  // form prefilled with the previous values; submitting stores the corrected
  // answer and re-triggers generation so the agent reconsiders.
  const [isEditing, setIsEditing] = useState(false);
  const canEditResponse =
    status === 'completed' &&
    !isWorkflowContext &&
    !wfExecutionId &&
    !!metadata.response;

  // Response versions: every edit appends the superseded answer to
  // `responseHistory`, so the card can flip through them like message
  // branches. The current response is always the LAST version; only it can
  // be edited (older ones are a read-only record).
  const versions = useMemo<HumanInputResponse[]>(() => {
    if (!metadata.response) return [];
    return [...(metadata.responseHistory ?? []), metadata.response];
  }, [metadata.responseHistory, metadata.response]);
  // null = latest. Reset when a new version lands (an edit was submitted).
  const [viewedVersionIdx, setViewedVersionIdx] = useState<number | null>(null);
  const latestResponseTimestamp = metadata.response?.timestamp;
  useEffect(() => {
    setViewedVersionIdx(null);
  }, [latestResponseTimestamp]);
  const versionCount = versions.length;
  const displayedVersionIdx = Math.min(
    viewedVersionIdx ?? versionCount - 1,
    versionCount - 1,
  );
  const displayedResponse =
    displayedVersionIdx >= 0 ? versions[displayedVersionIdx] : undefined;
  const isViewingLatestVersion = displayedVersionIdx === versionCount - 1;

  // Smooth the form ↔ response swap: a hard swap changes the card's height
  // in one frame and the content below jumps. FLIP the height instead —
  // capture the outgoing height during render (DOM still shows the old
  // state), then transition to the new height after commit.
  const prefersReducedMotion = usePrefersReducedMotion();
  const swapRef = useRef<HTMLDivElement>(null);
  const preSwapHeightRef = useRef<number | null>(null);
  const showForm = status === 'pending' || isEditing;
  const prevShowFormRef = useRef(showForm);
  if (prevShowFormRef.current !== showForm) {
    prevShowFormRef.current = showForm;
    preSwapHeightRef.current = swapRef.current?.offsetHeight ?? null;
  }
  useLayoutEffect(() => {
    const el = swapRef.current;
    const from = preSwapHeightRef.current;
    preSwapHeightRef.current = null;
    if (!el || from === null || prefersReducedMotion) return undefined;
    const to = el.offsetHeight;
    if (from === to) return undefined;
    el.style.height = `${from}px`;
    el.style.overflow = 'hidden';
    el.getBoundingClientRect(); // flush layout so the transition has a start value
    el.style.transition = 'height 250ms ease';
    el.style.height = `${to}px`;
    const finish = () => {
      el.style.height = '';
      el.style.overflow = '';
      el.style.transition = '';
    };
    const timer = setTimeout(finish, 300);
    return () => {
      clearTimeout(timer);
      finish();
    };
  }, [showForm, prefersReducedMotion]);

  const handleCancel = useCallback(async () => {
    if (!wfExecutionId) return;
    setIsCancelling(true);
    setError(null);
    try {
      await cancelExecution({
        executionId: wfExecutionId,
      });
    } catch (err) {
      // cancelExecution raises a structured code (not found / already settled);
      // map it instead of surfacing the raw ConvexError JSON blob.
      setError(mapExecutionError(err, tShared, tCommon('errorSubmitFailed')));
      console.error('Failed to cancel execution:', err);
    } finally {
      setIsCancelling(false);
    }
  }, [wfExecutionId, cancelExecution, tCommon, tShared]);

  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackText, setFeedbackText] = useState('');

  // Re-open the form prefilled with the previously submitted values.
  const handleStartEdit = useCallback(() => {
    const prev = metadata.response?.value;
    if (typeof prev === 'string') {
      try {
        const parsed: unknown = JSON.parse(prev);
        if (isRecord(parsed)) {
          const feedbackVal = getString(parsed, FEEDBACK_KEY);
          if (feedbackVal !== undefined) {
            setFeedbackText(feedbackVal);
            setShowFeedback(true);
          } else {
            const values: Record<string, string | string[]> = {};
            for (const [key, val] of Object.entries(parsed)) {
              if (typeof val === 'string') values[key] = val;
              else if (Array.isArray(val)) values[key] = val.map(String);
            }
            setFormValues(values);
            setShowFeedback(false);
          }
        }
      } catch (err) {
        console.warn('Could not prefill previous human-input response:', err);
      }
    }
    setError(null);
    setIsEditing(true);
  }, [metadata.response]);

  const handleCancelEdit = useCallback(() => {
    setIsEditing(false);
    setError(null);
  }, []);

  const handleSubmitFeedback = useCallback(() => {
    if (!feedbackText.trim()) {
      setError(t('errorFeedbackRequired'));
      return;
    }
    setError(null);
    const response = JSON.stringify({ [FEEDBACK_KEY]: feedbackText.trim() });
    // Optimistic resume signal — see handleSubmit. Fires before the round-trip so
    // the thinking line shows immediately; visual-only + safety-timeout guarded.
    // Edits signal only on success: the edit can be legitimately rejected
    // (e.g. a generation is still running), and the original answer stands.
    if (!isWorkflowContext && !isEditing) {
      onResponseSubmitted?.();
    }
    const respond = isEditing ? editResponse : submitResponse;
    respond(
      { approvalId, response, modelId },
      {
        onSuccess: () => {
          if (isEditing) {
            setIsEditing(false);
            if (!isWorkflowContext) onResponseSubmitted?.();
          }
        },
        onError: (err) => {
          setError(
            mapHumanInputError(err, t, tCommon, tCommon('errorSubmitFailed')),
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
    isEditing,
    approvalId,
    modelId,
    submitResponse,
    editResponse,
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
      } else if (field.type === 'todo_list') {
        // The TodoListFieldInput always seeds a row and serializes via
        // JSON.stringify, so `value` is a non-empty string even when every
        // row is blank — the generic "non-empty string" check below would
        // wrongly pass. Count the rows with real content instead.
        const filled =
          typeof value === 'string' ? countFilledTodoRows(value) : 0;
        const minItems =
          'minItems' in field && typeof field.minItems === 'number'
            ? field.minItems
            : 0;
        const threshold = Math.max(1, minItems);
        if (filled < threshold) {
          setError(
            threshold > 1
              ? t('errorTodoListMinItems', { count: threshold })
              : t('errorTodoListRequired'),
          );
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

    // Signal the resume OPTIMISTICALLY — before the mutation round-trip — so the
    // "Thinking…" line renders the instant the user submits, instead of only
    // after the server confirms (the round-trip is the visible lag the user
    // reported). The flag is visual-only and self-clears via its safety timeout
    // if the submit fails; the server is the authority for actually resuming.
    // Edits signal only on success — they can be legitimately rejected (e.g. a
    // generation is still running) and the original answer then stands.
    if (!isWorkflowContext && !isEditing) {
      onResponseSubmitted?.();
    }

    const respond = isEditing ? editResponse : submitResponse;
    respond(
      { approvalId, response, modelId },
      {
        onSuccess: () => {
          if (isEditing) {
            setIsEditing(false);
            if (!isWorkflowContext) onResponseSubmitted?.();
          }
        },
        onError: (err) => {
          setError(
            mapHumanInputError(err, t, tCommon, tCommon('errorSubmitFailed')),
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
    isEditing,
    approvalId,
    modelId,
    submitResponse,
    editResponse,
    onResponseSubmitted,
  ]);

  const renderResponse = () => {
    if (!displayedResponse) return null;

    const { value, respondedBy, timestamp } = displayedResponse;

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
              <Stack gap={2}>
                {Object.entries(parsed).map(([key, val]) => (
                  <div key={key} className="text-sm">
                    <Text as="div" className="text-muted-foreground">
                      {key}:
                    </Text>
                    <Text as="div" className="whitespace-pre-wrap">
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
        {(canEditResponse || versionCount > 1) && (
          <HStack gap={2} align="center" justify="between">
            {canEditResponse && isViewingLatestVersion ? (
              <button
                type="button"
                onClick={handleStartEdit}
                className="text-muted-foreground hover:text-foreground flex w-fit cursor-pointer items-center gap-1.5 text-xs transition-colors"
              >
                <Pencil className="size-3" aria-hidden="true" />
                {t('editResponse')}
              </button>
            ) : (
              <span />
            )}
            {versionCount > 1 && (
              <div className="flex items-center gap-0.5">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6"
                  onClick={() =>
                    setViewedVersionIdx(Math.max(0, displayedVersionIdx - 1))
                  }
                  disabled={displayedVersionIdx <= 0}
                  title={t('versionPrevious')}
                >
                  <ChevronLeft className="size-3.5" />
                </Button>
                <span className="text-muted-foreground min-w-[3ch] text-center text-xs tabular-nums">
                  {displayedVersionIdx + 1} / {versionCount}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6"
                  onClick={() =>
                    setViewedVersionIdx(
                      displayedVersionIdx + 1 >= versionCount - 1
                        ? null
                        : displayedVersionIdx + 1,
                    )
                  }
                  disabled={isViewingLatestVersion}
                  title={t('versionNext')}
                >
                  <ChevronRight className="size-3.5" />
                </Button>
              </div>
            )}
          </HStack>
        )}
      </Stack>
    );
  };

  return (
    <ApprovalCard maxWidth="xl" padding="lg" className={className}>
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

      {/* Input or Response (editing re-opens the form prefilled). The
          wrapper FLIP-animates the height across the swap — see the layout
          effect above. */}
      <div ref={swapRef}>
        {showForm ? (
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
                  className="min-h-[80px] text-base md:text-sm"
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
                {isEditing ? (
                  <HStack gap={2}>
                    <Button
                      variant="secondary"
                      onClick={handleCancelEdit}
                      disabled={isSubmitting}
                      className="flex-1"
                    >
                      {t('cancelEdit')}
                    </Button>
                    <Button
                      onClick={handleSubmit}
                      disabled={isSubmitting || isCancelling}
                      className="flex-1"
                    >
                      {isSubmitting ? (
                        <Loader2 className="mr-2 size-4 animate-spin" />
                      ) : (
                        <Send className="mr-2 size-4" />
                      )}
                      {t('updateResponse')}
                    </Button>
                  </HStack>
                ) : (
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
                )}
                {!isEditing && (
                  <button
                    type="button"
                    onClick={() => setShowFeedback(true)}
                    className="text-muted-foreground hover:text-foreground mt-2 flex cursor-pointer items-center justify-center gap-1.5 text-xs transition-colors"
                  >
                    <MessageSquareText className="size-3.5" />
                    {t('pushback')}
                  </button>
                )}
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
      </div>

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
              className="shrink-0 text-xs"
            >
              {status === 'completed'
                ? t('statusResponded')
                : status === 'executing'
                  ? t('statusProcessing')
                  : tCommon('statusRejected')}
            </Badge>
          )}
        </HStack>
      ) : null}
    </ApprovalCard>
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
