'use client';

import { Link } from '@tanstack/react-router';
import {
  Check,
  CheckCircle,
  XCircle,
  Loader2,
  PenLine,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
} from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { Badge } from '@/app/components/ui/feedback/badge';
import { ActionRow } from '@/app/components/ui/layout/action-row';
import { HStack, Stack } from '@/app/components/ui/layout/layout';
import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { Button } from '@/app/components/ui/primitives/button';
import { Text } from '@/app/components/ui/typography/text';
import {
  useExecuteApprovedWorkflowUpdate,
  useUpdateApprovalStatus,
} from '@/app/features/chat/hooks/mutations';
import { useAuth } from '@/app/hooks/use-convex-auth';
import { useCopyButton } from '@/app/hooks/use-copy';
import { Id } from '@/convex/_generated/dataModel';
import { WorkflowUpdateMetadata } from '@/convex/approvals/types';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';
import { isRecord } from '@/lib/utils/type-guards';
import { slugToUrlParam } from '@/lib/utils/workflow-slug';

interface WorkflowUpdateApprovalCardProps {
  approvalId: Id<'approvals'>;
  organizationId: string;
  status: 'pending' | 'executing' | 'completed' | 'rejected';
  metadata: WorkflowUpdateMetadata;
  executedAt?: number;
  executionError?: string;
  className?: string;
}

const getStepTypeBadgeVariant = (
  stepType: string,
): 'blue' | 'green' | 'orange' | 'yellow' | 'outline' => {
  switch (stepType) {
    case 'start':
    case 'trigger':
      return 'blue';
    case 'llm':
      return 'yellow';
    case 'action':
      return 'green';
    case 'condition':
      return 'orange';
    case 'loop':
      return 'blue';
    default:
      return 'outline';
  }
};

function WorkflowUpdateApprovalCardComponent({
  approvalId,
  organizationId,
  status,
  metadata,
  executedAt,
  executionError,
  className,
}: WorkflowUpdateApprovalCardProps) {
  const { t } = useT('workflowUpdateApproval');
  const { t: tCommon } = useT('approvalCommon');
  const { user } = useAuth();
  const [isApproving, setIsApproving] = useState(false);
  const [isRejecting, setIsRejecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(false);

  const configJson = useMemo(() => {
    if (metadata.updateType === 'full_save') {
      return JSON.stringify(
        {
          workflowConfig: metadata.workflowConfig,
          stepsConfig: metadata.stepsConfig,
        },
        null,
        2,
      );
    }
    if (metadata.updateType === 'multi_step_patch') {
      return JSON.stringify(
        {
          steps: metadata.steps?.map((s) => ({
            stepSlug: s.stepSlug,
            stepName: s.stepName,
            updates: s.stepUpdates,
          })),
        },
        null,
        2,
      );
    }
    return JSON.stringify(
      {
        stepSlug: metadata.stepSlug,
        stepName: metadata.stepName,
        updates: metadata.stepUpdates,
      },
      null,
      2,
    );
  }, [metadata]);
  const { copied, onClick: handleCopy } = useCopyButton(configJson);

  const { mutateAsync: updateApprovalStatus } = useUpdateApprovalStatus();
  const { mutateAsync: executeApprovedUpdate } =
    useExecuteApprovedWorkflowUpdate();

  const isPending = status === 'pending';
  const isProcessing = isApproving || isRejecting;

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
      await executeApprovedUpdate({
        approvalId,
      });
      window.dispatchEvent(new CustomEvent('workflow-updated'));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorApplyFailed'));
      console.error('Failed to approve workflow update:', err);
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
      console.error('Failed to reject workflow update:', err);
    } finally {
      setIsRejecting(false);
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
      <HStack gap={2} align="start" justify="between" className="mb-2">
        <HStack gap={2}>
          <PenLine className="text-primary size-4 shrink-0" />
          <div>
            <Text as="div" variant="label">
              {metadata.workflowName}
            </Text>
            <Badge variant="outline" className="mt-0.5 text-[10px]">
              {metadata.updateType === 'full_save'
                ? t('badgeFullSave')
                : metadata.updateType === 'multi_step_patch'
                  ? t('badgeMultiStep', { count: metadata.steps?.length ?? 0 })
                  : t('badgeStepPatch')}
            </Badge>
          </div>
        </HStack>
      </HStack>

      {/* Details list */}
      <div className="text-muted-foreground mb-3 space-y-0.5 text-xs">
        <div className="flex gap-1.5">
          <span className="shrink-0">{t('versionLabel')}</span>
          <span className="font-mono">{metadata.workflowVersion}</span>
        </div>
        <div className="flex gap-1.5">
          <span className="shrink-0">{t('slugLabel')}</span>
          <span className="font-mono">{metadata.workflowSlug}</span>
        </div>
      </div>

      {/* Update Summary */}
      <div className="bg-muted/50 mb-3 rounded-md px-3 py-2">
        <div className="prose prose-sm dark:prose-invert prose-p:my-0.5 prose-ul:my-0.5 prose-li:my-0 max-w-none text-sm">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {metadata.updateSummary}
          </ReactMarkdown>
        </div>
      </div>

      {/* Details (collapsible) */}
      <Stack gap={2} className="mb-3">
        <HStack gap={2}>
          <button
            type="button"
            onClick={() => setShowDetails(!showDetails)}
            className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs transition-colors"
          >
            {showDetails ? (
              <ChevronDown className="size-3" />
            ) : (
              <ChevronRight className="size-3" />
            )}
            {metadata.updateType === 'full_save'
              ? `${metadata.stepsConfig?.length ?? 0} steps`
              : metadata.updateType === 'multi_step_patch'
                ? `${metadata.steps?.length ?? 0} steps`
                : `Step: ${metadata.stepName ?? 'unknown'}`}
          </button>
          <Tooltip
            content={copied ? tCommon('copied') : tCommon('copyConfiguration')}
          >
            <button
              type="button"
              onClick={handleCopy}
              className="text-muted-foreground hover:text-foreground transition-colors"
              aria-label={t('copyAriaLabel')}
            >
              {copied ? (
                <Check className="size-3" />
              ) : (
                <Copy className="size-3" />
              )}
            </button>
          </Tooltip>
        </HStack>

        {showDetails &&
          metadata.updateType === 'full_save' &&
          metadata.stepsConfig && (
            <div className="bg-muted/50 space-y-0.5 rounded-md p-2">
              {metadata.stepsConfig.map((step, index) => (
                <HStack
                  key={step.stepSlug}
                  gap={2}
                  className="rounded px-1 py-0.5"
                >
                  <Text as="span" variant="caption" className="w-4 shrink-0">
                    {index + 1}.
                  </Text>
                  <Badge
                    variant={getStepTypeBadgeVariant(step.stepType)}
                    className="py-0 text-[10px]"
                  >
                    {step.stepType}
                  </Badge>
                  <Text
                    as="span"
                    variant="body-sm"
                    truncate
                    className="flex-1 text-left"
                  >
                    {step.name}
                  </Text>
                </HStack>
              ))}
            </div>
          )}

        {showDetails &&
          metadata.updateType === 'multi_step_patch' &&
          metadata.steps && (
            <div className="bg-muted/50 space-y-1.5 rounded-md p-2">
              {metadata.steps.map((step) => (
                <div key={step.stepSlug} className="space-y-0.5">
                  <Text as="div" variant="label" className="text-[11px]">
                    {step.stepName}
                  </Text>
                  <div className="text-muted-foreground pl-2 text-[10px]">
                    {Object.keys(step.stepUpdates).join(', ')}
                  </div>
                </div>
              ))}
            </div>
          )}

        {showDetails &&
          metadata.updateType === 'step_patch' &&
          metadata.stepUpdates && (
            <div className="bg-muted/50 space-y-1 rounded-md p-2">
              {Object.entries(metadata.stepUpdates).map(([key, value]) => (
                <div key={key} className="flex gap-1.5 text-[11px]">
                  <Text as="span" className="text-muted-foreground shrink-0">
                    {key}:
                  </Text>
                  <Text
                    as="span"
                    className="min-w-0 font-mono text-[10px] break-all"
                  >
                    {isRecord(value) ? JSON.stringify(value) : String(value)}
                  </Text>
                </div>
              ))}
            </div>
          )}
      </Stack>

      {/* Execution Result */}
      {(status === 'executing' || status === 'completed') &&
        executedAt &&
        !executionError && (
          <Stack gap={1} className="mb-3">
            <HStack gap={1} className="text-xs text-green-600">
              <CheckCircle className="size-3" />
              {t('updatedSuccessfully')}
            </HStack>
            <Link
              to="/dashboard/$id/automations/$amId"
              params={{
                id: organizationId,
                amId: slugToUrlParam(metadata.workflowSlug),
              }}
              className="text-primary flex items-center gap-1 text-xs hover:underline"
            >
              {tCommon('viewWorkflow')}
              <ExternalLink className="size-3" />
            </Link>
          </Stack>
        )}

      {/* Execution Error */}
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

      {/* Action Buttons */}
      {isPending && (
        <ActionRow gap={2}>
          <Tooltip content={t('approveTooltip')}>
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

          <Tooltip content={t('rejectTooltip')}>
            <Button
              size="sm"
              variant="secondary"
              onClick={handleReject}
              disabled={isProcessing}
              className="flex-1"
            >
              {isRejecting && <Loader2 className="mr-1 size-4 animate-spin" />}
              {tCommon('reject')}
            </Button>
          </Tooltip>
        </ActionRow>
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

export const WorkflowUpdateApprovalCard = memo(
  WorkflowUpdateApprovalCardComponent,
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
