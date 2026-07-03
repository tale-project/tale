'use client';

import { ActionRow } from '@tale/ui/action-row';
import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { HStack, Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import {
  BookOpen,
  CheckCircle,
  Loader2,
  RefreshCw,
  XCircle,
} from 'lucide-react';
import { memo, useState } from 'react';

import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import {
  useExecuteApprovedKnowledgeWrite,
  useUpdateApprovalStatus,
} from '@/app/features/chat/hooks/mutations';
import { useAuth } from '@/app/hooks/use-convex-auth';
import type { Id } from '@/convex/_generated/dataModel';
import type { KnowledgeWriteMetadata } from '@/convex/approvals/types';
import { useT } from '@/lib/i18n/client';

import { mapApprovalError } from '../lib/map-approval-error';
import { ApprovalCard } from './approval-card';

interface KnowledgeWriteApprovalCardProps {
  approvalId: Id<'approvals'>;
  organizationId: string;
  status: 'pending' | 'executing' | 'completed' | 'rejected';
  metadata: KnowledgeWriteMetadata;
  executedAt?: number;
  executionError?: string;
  className?: string;
}

function KnowledgeWriteApprovalCardComponent({
  approvalId,
  status,
  metadata,
  executedAt,
  executionError,
  className,
}: KnowledgeWriteApprovalCardProps) {
  const { t } = useT('knowledgeWriteApproval');
  const { t: tCommon } = useT('approvalCommon');
  const { user } = useAuth();
  const [isApproving, setIsApproving] = useState(false);
  const [isRejecting, setIsRejecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { mutateAsync: updateApprovalStatus } = useUpdateApprovalStatus();
  const { mutateAsync: executeKnowledgeWrite } =
    useExecuteApprovedKnowledgeWrite();

  const isPending = status === 'pending';
  const isProcessing = isApproving || isRejecting;
  const isReplacement = !!metadata.replacesEntryId;

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
      await executeKnowledgeWrite({ approvalId });
    } catch (err) {
      setError(mapApprovalError(err, tCommon, t('errorSaveFailed')));
      console.error('Failed to approve knowledge write:', err);
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
      setError(mapApprovalError(err, tCommon, tCommon('errorRejectFailed')));
      console.error('Failed to reject knowledge write:', err);
    } finally {
      setIsRejecting(false);
    }
  };

  return (
    <ApprovalCard className={className}>
      {/* Header */}
      <HStack gap={2} align="center" className="mb-2">
        <BookOpen className="text-primary size-4 shrink-0" />
        <Text as="div" variant="label">
          {isReplacement ? t('cardTitleReplace') : t('cardTitle')}
        </Text>
      </HStack>

      {/* Topic + content preview */}
      <Stack gap={2} className="mb-3 pl-6">
        <div className="min-w-0">
          <Text as="div" variant="caption">
            {t('topicLabel')}
          </Text>
          <Text as="div" variant="label" className="wrap-break-word">
            {metadata.topic}
          </Text>
        </div>
        <div className="min-w-0">
          <Text as="div" variant="caption">
            {t('contentLabel')}
          </Text>
          <Text
            as="div"
            className="bg-muted/50 mt-1 max-h-48 overflow-y-auto rounded-md p-2 text-sm wrap-break-word whitespace-pre-wrap"
          >
            {metadata.content}
          </Text>
        </div>
        {metadata.incorrectInfo && (
          <div className="min-w-0">
            <Text as="div" variant="caption">
              {t('incorrectInfoLabel')}
            </Text>
            <Text
              as="div"
              variant="caption"
              className="text-muted-foreground wrap-break-word line-through"
            >
              {metadata.incorrectInfo}
            </Text>
          </div>
        )}
      </Stack>

      {/* Replace notice */}
      {isReplacement && (
        <HStack gap={1} align="start" className="mb-3 pl-6 text-amber-600">
          <RefreshCw className="mt-0.5 size-3 shrink-0" />
          <Text as="span" variant="caption" className="min-w-0">
            {t('replaceNotice', {
              topic: metadata.replacesTopic ?? metadata.topic,
            })}
          </Text>
        </HStack>
      )}

      {/* Execution success */}
      {(status === 'executing' || status === 'completed') &&
        executedAt &&
        !executionError && (
          <HStack gap={1} className="mb-3 text-xs text-green-600">
            <CheckCircle className="size-3" />
            {t('savedSuccessfully')}
          </HStack>
        )}

      {/* Execution error */}
      {executionError && (
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
            content={
              isReplacement ? t('approveTooltipReplace') : t('approveTooltip')
            }
          >
            <Button
              variant="primary"
              onClick={handleApprove}
              disabled={isProcessing}
              className="flex-1"
            >
              {isApproving && <Loader2 className="mr-1 size-4 animate-spin" />}
              {t('approve')}
            </Button>
          </Tooltip>

          <Tooltip content={t('rejectTooltip')}>
            <Button
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
            {status === 'executing'
              ? t('statusExecuting')
              : status === 'completed' && executionError
                ? t('statusCompletedFailed')
                : status === 'completed'
                  ? t('statusCompletedSuccess')
                  : executionError
                    ? t('statusCompletedFailed')
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
            className="shrink-0 text-xs"
          >
            {status === 'completed'
              ? tCommon('statusCompleted')
              : status === 'executing'
                ? tCommon('statusExecuting')
                : status === 'rejected'
                  ? tCommon('statusRejected')
                  : tCommon('statusPending')}
          </Badge>
        </HStack>
      )}
    </ApprovalCard>
  );
}

export const KnowledgeWriteApprovalCard = memo(
  KnowledgeWriteApprovalCardComponent,
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
