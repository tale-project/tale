'use client';

import { Link } from '@tanstack/react-router';
import {
  Check,
  CheckCircle,
  XCircle,
  Loader2,
  Workflow,
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
  useExecuteApprovedWorkflowCreation,
  useUpdateApprovalStatus,
} from '@/app/features/chat/hooks/mutations';
import { useAuth } from '@/app/hooks/use-convex-auth';
import { useCopyButton } from '@/app/hooks/use-copy';
import { Id } from '@/convex/_generated/dataModel';
import { WorkflowCreationMetadata } from '@/convex/approvals/types';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';
import { isRecord } from '@/lib/utils/type-guards';
import { slugToUrlParam } from '@/lib/utils/workflow-slug';

import { markdownWrapperStyles } from './message-bubble/markdown-renderer';

interface WorkflowCreationApprovalCardProps {
  approvalId: Id<'approvals'>;
  organizationId: string;
  status: 'pending' | 'executing' | 'completed' | 'rejected';
  metadata: WorkflowCreationMetadata;
  executedAt?: number;
  executionError?: string;
  className?: string;
}

// Pure helper function - moved outside component to avoid recreation on each render
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

interface ConfigEntry {
  label: string;
  value: string;
  mono?: boolean;
}

function getStepConfigEntries(
  stepType: string,
  config: Record<string, unknown>,
  nextSteps: Record<string, string>,
): ConfigEntry[] {
  const entries: ConfigEntry[] = [];
  const str = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v));

  switch (stepType) {
    case 'start':
    case 'trigger': {
      const inputSchema = config.inputSchema;
      if (isRecord(inputSchema) && 'properties' in inputSchema) {
        const props = inputSchema.properties;
        if (isRecord(props)) {
          for (const [key, val] of Object.entries(props)) {
            const prop = isRecord(val) ? val : {};
            entries.push({
              label: key,
              value: [prop.type, prop.description].filter(Boolean).join(' — '),
            });
          }
        }
      }
      break;
    }

    case 'action': {
      const type = typeof config.type === 'string' ? config.type : undefined;
      if (type) entries.push({ label: 'Type', value: type });

      const params = isRecord(config.parameters)
        ? config.parameters
        : undefined;
      if (params) {
        if (type === 'integration') {
          if (params.name)
            entries.push({ label: 'Integration', value: str(params.name) });
          if (params.operation)
            entries.push({ label: 'Operation', value: str(params.operation) });
          const inner = isRecord(params.params) ? params.params : undefined;
          if (inner) {
            for (const [key, val] of Object.entries(inner)) {
              entries.push({
                label: key,
                value: str(val),
                mono: typeof val === 'string' && val.includes('{{'),
              });
            }
          }
        } else if (type === 'set_variables') {
          const variables = Array.isArray(params.variables)
            ? params.variables
            : [];
          for (const v of variables) {
            if (
              typeof v === 'object' &&
              v !== null &&
              'name' in v &&
              'value' in v
            ) {
              entries.push({
                label: str(v.name),
                value: str(v.value),
                mono: true,
              });
            }
          }
        } else {
          for (const [key, val] of Object.entries(params)) {
            entries.push({
              label: key,
              value: str(val),
              mono: typeof val === 'string' && val.includes('{{'),
            });
          }
        }
      }
      break;
    }

    case 'condition': {
      if (typeof config.expression === 'string') {
        entries.push({
          label: 'Expression',
          value: config.expression,
          mono: true,
        });
      }
      if (typeof config.description === 'string') {
        entries.push({ label: 'Description', value: config.description });
      }
      break;
    }

    case 'llm': {
      if (typeof config.systemPrompt === 'string')
        entries.push({ label: 'System prompt', value: config.systemPrompt });
      if (typeof config.userPrompt === 'string')
        entries.push({
          label: 'User prompt',
          value: config.userPrompt,
          mono: true,
        });
      if (Array.isArray(config.tools))
        entries.push({ label: 'Tools', value: config.tools.join(', ') });
      if (typeof config.outputFormat === 'string')
        entries.push({ label: 'Output', value: config.outputFormat });
      break;
    }

    case 'loop': {
      if (typeof config.items === 'string')
        entries.push({ label: 'Items', value: config.items, mono: true });
      if (typeof config.itemVariable === 'string')
        entries.push({ label: 'Item variable', value: config.itemVariable });
      if (typeof config.maxIterations === 'number')
        entries.push({
          label: 'Max iterations',
          value: String(config.maxIterations),
        });
      if (typeof config.continueOnError === 'boolean')
        entries.push({
          label: 'Continue on error',
          value: String(config.continueOnError),
        });
      break;
    }

    case 'output': {
      const mapping = isRecord(config.mapping)
        ? config.mapping
        : isRecord(config.outputMapping)
          ? config.outputMapping
          : undefined;
      if (mapping) {
        for (const [key, val] of Object.entries(mapping)) {
          entries.push({
            label: key,
            value: str(val),
            mono: true,
          });
        }
      }
      break;
    }
  }

  const nextStepEntries = Object.entries(nextSteps);
  if (nextStepEntries.length > 0) {
    entries.push({
      label: 'Next',
      value: nextStepEntries
        .map(([port, target]) => `${port} → ${target}`)
        .join(', '),
    });
  }

  return entries;
}

/**
 * Card component for displaying workflow creation approvals in chat
 */
function WorkflowCreationApprovalCardComponent({
  approvalId,
  organizationId,
  status,
  metadata,
  executedAt,
  executionError,
  className,
}: WorkflowCreationApprovalCardProps) {
  const { user } = useAuth();
  const { t } = useT('workflowCreationApproval');
  const { t: tCommon } = useT('approvalCommon');
  const [isApproving, setIsApproving] = useState(false);
  const [isRejecting, setIsRejecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSteps, setShowSteps] = useState(false);
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(
    () => new Set(),
  );

  const configJson = useMemo(
    () =>
      JSON.stringify(
        {
          workflowConfig: metadata.workflowConfig,
          stepsConfig: metadata.stepsConfig,
        },
        null,
        2,
      ),
    [metadata.workflowConfig, metadata.stepsConfig],
  );
  const { copied, onClick: handleCopy } = useCopyButton(configJson);

  const { mutateAsync: updateApprovalStatus } = useUpdateApprovalStatus();
  const { mutateAsync: executeApprovedWorkflow } =
    useExecuteApprovedWorkflowCreation();

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
      await executeApprovedWorkflow({
        approvalId,
      });
      window.dispatchEvent(new CustomEvent('workflow-updated'));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorCreateFailed'));
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
          <Workflow className="text-primary size-4 shrink-0" />
          <div>
            <Text as="div" variant="label">
              {metadata.workflowName}
            </Text>
            {metadata.workflowDescription && (
              <div
                className={cn(
                  markdownWrapperStyles,
                  'text-muted-foreground max-w-none text-xs line-clamp-2',
                )}
              >
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {metadata.workflowDescription}
                </ReactMarkdown>
              </div>
            )}
          </div>
        </HStack>
      </HStack>

      {/* Workflow Steps Preview */}
      <Stack gap={2} className="mb-3">
        <HStack gap={2}>
          <button
            type="button"
            onClick={() => setShowSteps(!showSteps)}
            className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs transition-colors"
          >
            {showSteps ? (
              <ChevronDown className="size-3" />
            ) : (
              <ChevronRight className="size-3" />
            )}
            {t('stepsCount', { count: metadata.stepsConfig.length })}
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

        {showSteps && (
          <div className="bg-muted/50 space-y-0.5 rounded-md p-2">
            {metadata.stepsConfig.map((step, index) => {
              const isExpanded = expandedSteps.has(step.stepSlug);
              const configEntries = isExpanded
                ? getStepConfigEntries(
                    step.stepType,
                    step.config,
                    step.nextSteps,
                  )
                : [];

              return (
                <div key={step.stepSlug}>
                  <button
                    type="button"
                    className="hover:bg-muted/80 flex w-full items-center gap-2 rounded px-1 py-0.5 transition-colors"
                    onClick={() => {
                      setExpandedSteps((prev) => {
                        const next = new Set(prev);
                        if (next.has(step.stepSlug)) {
                          next.delete(step.stepSlug);
                        } else {
                          next.add(step.stepSlug);
                        }
                        return next;
                      });
                    }}
                    aria-expanded={isExpanded}
                  >
                    <ChevronRight
                      className={cn(
                        'text-muted-foreground size-2.5 shrink-0 transition-transform duration-150',
                        isExpanded && 'rotate-90',
                      )}
                    />
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
                  </button>

                  {isExpanded && configEntries.length > 0 && (
                    <div className="border-muted mt-0.5 mb-1 ml-7 space-y-0.5 border-l-2 pl-2">
                      {configEntries.map((entry, idx) => (
                        <div
                          key={`${entry.label}-${idx}`}
                          className="flex gap-1.5 text-[11px]"
                        >
                          <Text
                            as="span"
                            className="text-muted-foreground shrink-0"
                          >
                            {entry.label}:
                          </Text>
                          <Text
                            as="span"
                            className={cn(
                              'min-w-0 break-all',
                              entry.mono && 'font-mono text-[10px]',
                            )}
                          >
                            {entry.value}
                          </Text>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Stack>

      {/* Execution Result (if approved and executed) */}
      {(status === 'executing' || status === 'completed') &&
        executedAt &&
        !executionError && (
          <Stack gap={1} className="mb-3">
            <HStack gap={1} className="text-xs text-green-600">
              <CheckCircle className="size-3" />
              {t('createdSuccessfully')}
            </HStack>
            {metadata.createdWorkflowSlug && (
              <Link
                to="/dashboard/$id/automations/$amId"
                params={{
                  id: organizationId,
                  amId: slugToUrlParam(metadata.createdWorkflowSlug ?? ''),
                }}
                className="text-primary flex items-center gap-1 text-xs hover:underline"
              >
                {tCommon('viewWorkflow')}
                <ExternalLink className="size-3" />
              </Link>
            )}
          </Stack>
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

// Memoize to prevent unnecessary re-renders
export const WorkflowCreationApprovalCard = memo(
  WorkflowCreationApprovalCardComponent,
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
