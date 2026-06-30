'use client';

import { ActionRow } from '@tale/ui/action-row';
import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { HStack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { ConvexError } from 'convex/values';
import { ClipboardList, Loader2, XCircle } from 'lucide-react';
import { memo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import {
  useApprovePlan,
  useRejectPlan,
} from '@/app/features/chat/hooks/mutations';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import type { PlanApprovalMetadata } from '@/convex/approvals/types';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';
import { isRecord } from '@/lib/utils/type-utils';

import { ApprovalCard } from './approval-card';
import { markdownWrapperStyles } from './message-bubble/markdown-renderer';

// Beyond this many rendered lines the tail collapses behind "show more". The
// full plan is ALWAYS reachable — the user can't approve what they can't read.
const COLLAPSE_THRESHOLD_CHARS = 2_400;

interface PlanApprovalCardProps {
  approvalId: Id<'approvals'>;
  organizationId: string;
  threadId: string;
  status: 'pending' | 'executing' | 'completed' | 'rejected';
  metadata: PlanApprovalMetadata;
  className?: string;
}

function errorCode(err: unknown): string | undefined {
  if (err instanceof ConvexError && isRecord(err.data)) {
    const code = err.data.code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

/**
 * Inline plan-approval card (plan/act workflow): renders the agent's proposed
 * plan IN FULL as markdown with approve/reject actions. Approving flips the
 * thread to act mode and starts the execution turn; the user can instead just
 * keep typing below — the next message is another planning turn and a newer
 * plan supersedes this card.
 */
function PlanApprovalCardComponent({
  approvalId,
  organizationId,
  threadId,
  status,
  metadata,
  className,
}: PlanApprovalCardProps) {
  const { t } = useT('planApproval');
  const { t: tCommon } = useT('approvalCommon');
  const [isApproving, setIsApproving] = useState(false);
  const [isRejecting, setIsRejecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const { mutateAsync: approvePlan } = useApprovePlan();
  const { mutateAsync: rejectPlan } = useRejectPlan();
  // Shared subscription with the chat surface (same query+args dedupes).
  const { data: meta } = useConvexQuery(api.threads.queries.getThreadMeta, {
    threadId,
    organizationId,
  });
  const isGenerating = meta?.isGenerating === true;

  const isPending = status === 'pending';
  const isProcessing = isApproving || isRejecting;
  const superseded = typeof metadata.supersededBy === 'string';

  const collapsible = metadata.plan.length > COLLAPSE_THRESHOLD_CHARS;
  const shownPlan =
    collapsible && !expanded
      ? `${metadata.plan.slice(0, COLLAPSE_THRESHOLD_CHARS)}…`
      : metadata.plan;

  const handleApprove = async () => {
    setIsApproving(true);
    setError(null);
    try {
      await approvePlan({ approvalId, organizationId });
    } catch (err) {
      const code = errorCode(err);
      setError(
        code === 'TURN_RUNNING'
          ? t('errorTurnRunning')
          : code === 'ALREADY_RESOLVED'
            ? t('errorAlreadyResolved')
            : t('errorApproveFailed'),
      );
      console.error('Failed to approve plan:', err);
    } finally {
      setIsApproving(false);
    }
  };

  const handleReject = async () => {
    setIsRejecting(true);
    setError(null);
    try {
      await rejectPlan({ approvalId, organizationId });
    } catch (err) {
      const code = errorCode(err);
      setError(
        code === 'ALREADY_RESOLVED'
          ? t('errorAlreadyResolved')
          : t('errorRejectFailed'),
      );
      console.error('Failed to reject plan:', err);
    } finally {
      setIsRejecting(false);
    }
  };

  return (
    <ApprovalCard maxWidth="2xl" className={className}>
      <HStack gap={2} align="center" className="mb-2">
        <ClipboardList className="text-primary size-4 shrink-0" />
        <Text as="div" variant="label">
          {t('cardTitle')}
        </Text>
      </HStack>

      {/* The plan itself — full markdown, never just a summary. */}
      <div className={cn(markdownWrapperStyles, 'mb-1 max-w-none text-sm')}>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{shownPlan}</ReactMarkdown>
      </div>
      {collapsible && (
        <Button
          variant="ghost"
          className="mb-2 px-2 text-xs"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? t('showLess') : t('showMore')}
        </Button>
      )}

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

      {isPending && (
        <>
          <ActionRow gap={2} className="mt-2">
            <Tooltip
              content={
                isGenerating ? t('errorTurnRunning') : t('approveTooltip')
              }
            >
              <Button
                variant="primary"
                onClick={handleApprove}
                disabled={isProcessing || isGenerating}
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
                variant="secondary"
                onClick={handleReject}
                disabled={isProcessing || isGenerating}
                className="flex-1"
              >
                {isRejecting && (
                  <Loader2 className="mr-1 size-4 animate-spin" />
                )}
                {t('reject')}
              </Button>
            </Tooltip>
          </ActionRow>
          <Text as="div" variant="caption" className="mt-2">
            {t('keepTypingHint')}
          </Text>
        </>
      )}

      {!isPending && (
        <HStack justify="between" align="center" className="mt-2">
          <Text as="div" variant="caption">
            {status === 'completed'
              ? t('statusApproved')
              : superseded
                ? t('statusSuperseded')
                : t('statusRejected')}
          </Text>
          <Badge
            variant={status === 'completed' ? 'green' : 'destructive'}
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

export const PlanApprovalCard = memo(
  PlanApprovalCardComponent,
  (prevProps, nextProps) =>
    prevProps.approvalId === nextProps.approvalId &&
    prevProps.status === nextProps.status &&
    prevProps.className === nextProps.className &&
    prevProps.threadId === nextProps.threadId &&
    prevProps.organizationId === nextProps.organizationId &&
    JSON.stringify(prevProps.metadata) === JSON.stringify(nextProps.metadata),
);
