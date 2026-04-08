'use client';

import {
  ArrowLeft,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Database,
  Globe,
  Loader2,
  MessageSquareText,
  Send,
} from 'lucide-react';
import { memo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { Badge } from '@/app/components/ui/feedback/badge';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { ActionRow } from '@/app/components/ui/layout/action-row';
import { HStack, Stack } from '@/app/components/ui/layout/layout';
import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { Button } from '@/app/components/ui/primitives/button';
import { Text } from '@/app/components/ui/typography/text';
import {
  useExecuteApprovedIntegrationOperation,
  useUpdateApprovalStatus,
} from '@/app/features/chat/hooks/mutations';
import { useAuth } from '@/app/hooks/use-convex-auth';
import { Id } from '@/convex/_generated/dataModel';
import { IntegrationOperationMetadata } from '@/convex/approvals/types';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { ImagePreviewDialog } from './message-bubble/image-preview-dialog';
import { markdownWrapperStyles } from './message-bubble/markdown-renderer';

function ParameterImagePreview({ src, alt }: { src: string; alt: string }) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="ring-border focus:ring-ring mt-1 inline-block cursor-pointer overflow-hidden rounded border-none bg-transparent p-0 ring-1 transition-opacity hover:opacity-90 focus:ring-2 focus:outline-none"
      >
        <img src={src} alt={alt} className="block h-16 w-auto object-contain" />
      </button>
      <ImagePreviewDialog
        isOpen={isOpen}
        onOpenChange={setIsOpen}
        src={src}
        alt={alt}
      />
    </>
  );
}

interface IntegrationApprovalCardProps {
  approvalId: Id<'approvals'>;
  organizationId: string;
  status: 'pending' | 'executing' | 'completed' | 'rejected';
  metadata: IntegrationOperationMetadata;
  executedAt?: number;
  executionError?: string;
  className?: string;
  /** Send a message as the user in the chat (triggers agent response) */
  onSendMessage?: (message: string) => void;
}

/**
 * Card component for displaying integration operation approvals in chat
 */
function IntegrationApprovalCardComponent({
  approvalId,
  status,
  metadata,
  executedAt,
  executionError,
  className,
  onSendMessage,
}: IntegrationApprovalCardProps) {
  const { t } = useT('integrationApproval');
  const { t: tCommon } = useT('approvalCommon');
  const { user } = useAuth();
  const [isApproving, setIsApproving] = useState(false);
  const [isRejecting, setIsRejecting] = useState(false);
  const [isSendingFeedback, setIsSendingFeedback] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackText, setFeedbackText] = useState('');

  const { mutateAsync: updateApprovalStatus } = useUpdateApprovalStatus();
  const { mutateAsync: executeApprovedOperation } =
    useExecuteApprovedIntegrationOperation();

  const isPending = status === 'pending';
  const isProcessing = isApproving || isRejecting || isSendingFeedback;

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
      await executeApprovedOperation({
        approvalId,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorApproveFailed'));
      console.error('Failed to approve:', err);
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
      console.error('Failed to reject:', err);
    } finally {
      setIsRejecting(false);
    }
  };

  const [isExpanded, setIsExpanded] = useState(false);

  // Check if a value looks like an image URL (storage URL or common image extensions)
  const isImageUrl = (key: string, value: unknown): boolean => {
    if (typeof value !== 'string') return false;
    const lowerKey = key.toLowerCase();
    const lowerVal = value.toLowerCase();
    const isImageKey =
      lowerKey === 'image' ||
      lowerKey === 'image_url' ||
      lowerKey === 'imageurl' ||
      lowerKey.endsWith('_image');
    const isUrl = value.startsWith('http://') || value.startsWith('https://');
    const hasImageExt =
      /\.(png|jpe?g|gif|webp|svg)(\?|$)/i.test(lowerVal) ||
      lowerVal.includes('/api/storage/');
    return isUrl && (isImageKey || hasImageExt);
  };

  // Format parameters for display
  const formatParameters = (params: Record<string, unknown>) => {
    const entries = Object.entries(params).filter(
      ([_, v]) => v !== undefined && v !== null,
    );
    if (entries.length === 0) return null;
    const visible = isExpanded ? entries : entries.slice(0, 3);
    return visible.map(([key, value]) => (
      <Text as="div" key={key} variant="caption" className="wrap-break-word">
        <Text as="span" variant="label-sm">
          {key}:
        </Text>{' '}
        {isImageUrl(key, value) ? (
          <ParameterImagePreview src={value as string} alt={key} />
        ) : (
          <span>
            {typeof value === 'string'
              ? value
              : typeof value === 'number' || typeof value === 'boolean'
                ? String(value)
                : JSON.stringify(value)}
          </span>
        )}
      </Text>
    ));
  };

  const IntegrationIcon = metadata.integrationType === 'sql' ? Database : Globe;

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
          <IntegrationIcon className="text-muted-foreground size-4 shrink-0" />
          <div>
            <Text as="div" variant="label">
              {metadata.operationTitle}
            </Text>
            <Text as="div" variant="caption">
              {metadata.integrationName}
            </Text>
          </div>
        </HStack>
      </HStack>

      {/* Operation Details */}
      <Stack gap={2} className="mb-3">
        <HStack gap={2}>
          <Badge variant="outline" className="text-xs">
            {metadata.operationType === 'write' ? (
              <AlertTriangle className="mr-1 size-3" />
            ) : null}
            {metadata.operationType}
          </Badge>
          <Text as="span" variant="code" className="text-muted-foreground">
            {metadata.operationName}
          </Text>
        </HStack>

        {/* Parameters Preview */}
        {metadata.parameters && Object.keys(metadata.parameters).length > 0 && (
          <div className="bg-muted/50 space-y-0.5 rounded-md p-2">
            {formatParameters(metadata.parameters)}
            {Object.keys(metadata.parameters).length > 3 && (
              <button
                type="button"
                onClick={() => setIsExpanded((prev) => !prev)}
                className="text-muted-foreground hover:text-foreground cursor-pointer text-xs transition-colors"
              >
                {isExpanded
                  ? t('showLess')
                  : t('moreParameters', {
                      count: Object.keys(metadata.parameters).length - 3,
                    })}
              </button>
            )}
          </div>
        )}

        {/* Estimated Impact */}
        {metadata.estimatedImpact && (
          <div
            className={cn(
              markdownWrapperStyles,
              'text-muted-foreground max-w-none text-xs italic',
            )}
          >
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {metadata.estimatedImpact}
            </ReactMarkdown>
          </div>
        )}
      </Stack>

      {/* Execution Result (if approved and executed) */}
      {(status === 'executing' || status === 'completed') &&
        executedAt &&
        !executionError && (
          <HStack gap={1} className="mb-3 text-xs text-green-600">
            <CheckCircle className="size-3" />
            {t('executedSuccessfully')}
          </HStack>
        )}

      {/* Execution Error (persisted from backend) */}
      {(status === 'executing' || status === 'completed') && executionError && (
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
        >
          <XCircle className="size-3 shrink-0" />
          <Text as="span" className="min-w-0">
            {error}
          </Text>
        </HStack>
      )}

      {/* Action Buttons / Feedback */}
      {isPending && (
        <Stack gap={2}>
          {showFeedback ? (
            <>
              <Textarea
                value={feedbackText}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                  setFeedbackText(e.target.value)
                }
                placeholder={t('feedbackPlaceholder')}
                className="min-h-[60px] text-sm"
                disabled={isProcessing}
                autoFocus
              />
              <ActionRow gap={2}>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setShowFeedback(false)}
                  disabled={isProcessing}
                  className="flex-1"
                >
                  <ArrowLeft className="mr-1 size-3.5" />
                  {t('backToActions')}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={async () => {
                    if (feedbackText.trim()) {
                      setIsSendingFeedback(true);
                      setError(null);
                      try {
                        const feedback = feedbackText.trim();
                        await updateApprovalStatus({
                          approvalId,
                          status: 'rejected',
                          comments: feedback,
                          triggerAgentResponse: true,
                        });
                        setFeedbackText('');
                        setShowFeedback(false);
                        onSendMessage?.(feedback);
                      } catch (err) {
                        setError(
                          err instanceof Error
                            ? err.message
                            : t('errorApproveFailed'),
                        );
                      } finally {
                        setIsSendingFeedback(false);
                      }
                    }
                  }}
                  disabled={isProcessing || !feedbackText.trim()}
                  className="flex-1"
                >
                  {isSendingFeedback ? (
                    <Loader2 className="mr-1 size-3.5 animate-spin" />
                  ) : (
                    <Send className="mr-1 size-3.5" />
                  )}
                  {t('sendFeedback')}
                </Button>
              </ActionRow>
            </>
          ) : (
            <>
              <ActionRow gap={2}>
                <Tooltip content={t('approveTooltip')}>
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={handleApprove}
                    disabled={isProcessing}
                    className="flex-1"
                  >
                    {isApproving && (
                      <Loader2 className="mr-1 size-4 animate-spin" />
                    )}
                    {t('approve')}
                  </Button>
                </Tooltip>

                <Tooltip content={t('rejectTooltip')}>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={handleReject}
                    disabled={isProcessing}
                    className="flex-1"
                  >
                    {isRejecting && (
                      <Loader2 className="mr-1 size-4 animate-spin" />
                    )}
                    {t('reject')}
                  </Button>
                </Tooltip>
              </ActionRow>
              <button
                type="button"
                onClick={() => setShowFeedback(true)}
                className="text-muted-foreground hover:text-foreground flex cursor-pointer items-center justify-center gap-1.5 text-xs transition-colors"
              >
                <MessageSquareText className="size-3.5" />
                {t('suggestChanges')}
              </button>
            </>
          )}
        </Stack>
      )}

      {/* Status message for resolved approvals */}
      {!isPending && (
        <HStack justify="between" align="center" className="mt-2">
          <Text as="div" variant="caption">
            {status === 'executing'
              ? t('statusExecuting')
              : status === 'completed' && executionError
                ? t('statusCompletedFailed')
                : status === 'completed'
                  ? t('statusCompletedSuccess')
                  : t('statusRejected')}
          </Text>
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
            {status}
          </Badge>
        </HStack>
      )}
    </div>
  );
}

// Memoize to prevent unnecessary re-renders
export const IntegrationApprovalCard = memo(
  IntegrationApprovalCardComponent,
  (prevProps, nextProps) => {
    return (
      prevProps.approvalId === nextProps.approvalId &&
      prevProps.status === nextProps.status &&
      prevProps.className === nextProps.className &&
      prevProps.executedAt === nextProps.executedAt &&
      prevProps.executionError === nextProps.executionError &&
      prevProps.onSendMessage === nextProps.onSendMessage &&
      prevProps.metadata === nextProps.metadata &&
      prevProps.organizationId === nextProps.organizationId
    );
  },
);
