'use client';

import { useLocale } from '@tale/ui/i18n/locale-provider';
import { Stack } from '@tale/ui/layout';
import { Popover } from '@tale/ui/popover';
import { Text } from '@tale/ui/text';
import {
  AlertCircle,
  CheckCircle2,
  CirclePause,
  Loader2,
  XCircle,
} from 'lucide-react';

import { JsonViewer } from '@/app/components/ui/data-display/json-viewer';
import type { ExecutionNodeStatus } from '@/convex/workflows/executions/get_execution_step_statuses';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';
import { formatDuration } from '@/lib/utils/format/number';

import {
  useNodeExecutionStatus,
  useViewedExecution,
} from './execution-status-context';

const STATUS_ICONS: Record<
  ExecutionNodeStatus,
  { Icon: typeof Loader2; className: string }
> = {
  running: {
    Icon: Loader2,
    className:
      'animate-spin motion-reduce:animate-none text-blue-600 dark:text-blue-400',
  },
  success: {
    Icon: CheckCircle2,
    className: 'text-emerald-600 dark:text-emerald-400',
  },
  failed: { Icon: AlertCircle, className: 'text-destructive' },
  waiting: {
    Icon: CirclePause,
    className: 'text-amber-600 dark:text-amber-400',
  },
  canceled: { Icon: XCircle, className: 'text-muted-foreground' },
};

interface NodeExecutionStatusBadgeProps {
  stepSlug: string;
  className?: string;
}

/**
 * Per-node execution status badge for the workflow canvas (#1487). Renders
 * nothing unless an execution is being viewed AND this node appears in its
 * journal. Clicking opens a popover with timing, attempts, error and a capped
 * output preview. Positioned by the caller (absolute top-right of the card);
 * deliberately a sibling of the card `<button>` — nesting would be invalid
 * HTML and would swallow the card's open-step click.
 */
export function NodeExecutionStatusBadge({
  stepSlug,
  className,
}: NodeExecutionStatusBadgeProps) {
  const { t } = useT('automations');
  const { locale } = useLocale();
  const nodeStatus = useNodeExecutionStatus(stepSlug);
  const { execution } = useViewedExecution();

  if (!nodeStatus) return null;

  const { Icon, className: iconClassName } = STATUS_ICONS[nodeStatus.status];
  const statusLabel = t(`steps.execution.status.${nodeStatus.status}`);
  const durationMs =
    nodeStatus.completedAt !== undefined && nodeStatus.startedAt !== undefined
      ? nodeStatus.completedAt - nodeStatus.startedAt
      : undefined;
  const isCurrentLoopStep =
    execution?.loopProgress && execution.currentStepSlug === stepSlug
      ? execution.loopProgress
      : undefined;

  return (
    <Popover
      align="end"
      contentClassName="w-80 max-w-80 max-h-96 overflow-y-auto p-3"
      trigger={
        <button
          type="button"
          aria-label={t('steps.execution.nodeBadgeLabel', {
            status: statusLabel,
          })}
          className={cn(
            'bg-background ring-border flex size-6 cursor-pointer items-center justify-center rounded-full shadow-sm ring-1',
            className,
          )}
          onClick={(event) => event.stopPropagation()}
        >
          <Icon className={cn('size-4', iconClassName)} aria-hidden="true" />
        </button>
      }
    >
      <Stack gap={2}>
        <Text as="span" variant="label">
          {statusLabel}
        </Text>

        {durationMs !== undefined && durationMs >= 0 && (
          <Text className="text-muted-foreground text-xs">
            {t('steps.execution.duration', {
              duration: formatDuration(durationMs, locale),
            })}
          </Text>
        )}

        {nodeStatus.attempts > 1 && (
          <Text className="text-muted-foreground text-xs">
            {t('steps.execution.attempts', { count: nodeStatus.attempts })}
          </Text>
        )}

        {isCurrentLoopStep && (
          <Text className="text-muted-foreground text-xs">
            {t('steps.execution.loopProgress', {
              current: isCurrentLoopStep.current,
              total: isCurrentLoopStep.total,
            })}
          </Text>
        )}

        {nodeStatus.error && (
          <Stack gap={1}>
            <Text variant="label-sm">{t('steps.execution.error')}</Text>
            <Text
              variant="error-sm"
              className="break-words whitespace-pre-line"
            >
              {nodeStatus.error}
            </Text>
          </Stack>
        )}

        {nodeStatus.outputUnavailable && (
          <Text className="text-muted-foreground text-xs">
            {t('steps.execution.outputUnavailable')}
          </Text>
        )}

        {nodeStatus.outputPreview !== undefined && (
          <Stack gap={1}>
            <Text variant="label-sm">{t('steps.execution.output')}</Text>
            {nodeStatus.outputTruncated && (
              <Text className="text-muted-foreground text-xs">
                {t('steps.execution.outputTruncated')}
              </Text>
            )}
            <JsonViewer
              data={nodeStatus.outputPreview}
              collapsed={1}
              className="rounded-md border"
            />
          </Stack>
        )}
      </Stack>
    </Popover>
  );
}
