'use client';

import { Link } from '@tanstack/react-router';
import { useMutation, useAction } from 'convex/react';
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

import { Badge } from '@/app/components/ui/feedback/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/app/components/ui/overlays/tooltip';
import { Button } from '@/app/components/ui/primitives/button';
import { useAuth } from '@/app/hooks/use-convex-auth';
import { useCopyButton } from '@/app/hooks/use-copy';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import { WorkflowCreationMetadata } from '@/convex/approvals/types';
import { cn } from '@/lib/utils/cn';
import { isRecord } from '@/lib/utils/type-guards';

interface WorkflowCreationApprovalCardProps {
  approvalId: Id<'approvals'>;
  organizationId: string;
  status: 'pending' | 'approved' | 'rejected';
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

  // No optimistic update: approval triggers external workflow creation action with
  // side effects that cannot be safely rolled back if the mutation fails.
  const updateApprovalStatus = useMutation(
    api.approvals.mutations.updateApprovalStatus,
  );
  const executeApprovedWorkflow = useAction(
    api.approvals.actions.executeApprovedWorkflowCreation,
  );

  const isPending = status === 'pending';
  const isProcessing = isApproving || isRejecting;

  const handleApprove = async () => {
    if (!user?.userId) {
      setError('User not authenticated');
      return;
    }
    setIsApproving(true);
    setError(null);
    try {
      await updateApprovalStatus({
        approvalId,
        status: 'approved',
      });
      await executeApprovedWorkflow({
        approvalId,
      });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to create workflow',
      );
      console.error('Failed to approve:', err);
    } finally {
      setIsApproving(false);
    }
  };

  const handleReject = async () => {
    if (!user?.userId) {
      setError('User not authenticated');
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
      setError(err instanceof Error ? err.message : 'Failed to reject');
      console.error('Failed to reject:', err);
    } finally {
      setIsRejecting(false);
    }
  };

  return (
    <div
      className={cn(
        'border rounded-lg p-4 bg-card shadow-sm max-w-md overflow-hidden',
        status === 'approved' && 'border-success/30 bg-success/5',
        status === 'rejected' && 'border-destructive/30 bg-destructive/5',
        status === 'pending' && 'border-primary/30 bg-primary/5',
        className,
      )}
    >
      {/* Header */}
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="bg-primary/10 rounded-md p-1.5">
            <Workflow className="text-primary size-4" />
          </div>
          <div>
            <div className="text-sm font-medium">{metadata.workflowName}</div>
            {metadata.workflowDescription && (
              <div className="text-muted-foreground line-clamp-2 text-xs">
                {metadata.workflowDescription}
              </div>
            )}
          </div>
        </div>
        <Badge
          variant={
            status === 'approved'
              ? 'green'
              : status === 'rejected'
                ? 'destructive'
                : 'blue'
          }
          className="text-xs capitalize"
        >
          {status}
        </Badge>
      </div>

      {/* Workflow Steps Preview */}
      <div className="mb-3 space-y-2">
        <div className="flex items-center gap-2">
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
            {metadata.stepsConfig.length} steps
          </button>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  aria-label="Copy workflow configuration"
                >
                  {copied ? (
                    <Check className="size-3" />
                  ) : (
                    <Copy className="size-3" />
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent>
                {copied ? 'Copied!' : 'Copy configuration'}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>

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
                    <span className="text-muted-foreground w-4 shrink-0 text-xs">
                      {index + 1}.
                    </span>
                    <Badge
                      variant={getStepTypeBadgeVariant(step.stepType)}
                      className="py-0 text-[10px]"
                    >
                      {step.stepType}
                    </Badge>
                    <span className="flex-1 truncate text-left text-xs">
                      {step.name}
                    </span>
                  </button>

                  {isExpanded && configEntries.length > 0 && (
                    <div className="border-muted mt-0.5 mb-1 ml-7 space-y-0.5 border-l-2 pl-2">
                      {configEntries.map((entry, idx) => (
                        <div
                          key={`${entry.label}-${idx}`}
                          className="flex gap-1.5 text-[11px]"
                        >
                          <span className="text-muted-foreground shrink-0">
                            {entry.label}:
                          </span>
                          <span
                            className={cn(
                              'min-w-0 break-all',
                              entry.mono && 'font-mono text-[10px]',
                            )}
                          >
                            {entry.value}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Execution Result (if approved and executed) */}
      {status === 'approved' && executedAt && !executionError && (
        <div className="mb-3 space-y-1">
          <div className="flex items-center gap-1 text-xs text-green-600">
            <CheckCircle className="size-3" />
            Workflow created successfully
          </div>
          {metadata.createdWorkflowId && (
            <Link
              to="/dashboard/$id/automations/$amId"
              params={{ id: organizationId, amId: metadata.createdWorkflowId }}
              className="text-primary flex items-center gap-1 text-xs hover:underline"
            >
              View workflow
              <ExternalLink className="size-3" />
            </Link>
          )}
        </div>
      )}

      {/* Execution Error (persisted from backend) */}
      {status === 'approved' && executionError && (
        <div className="text-destructive mb-3 flex items-start gap-1 text-xs break-words">
          <XCircle className="size-3 shrink-0" />
          <span className="min-w-0">{executionError}</span>
        </div>
      )}

      {/* Error Message (temporary UI error) */}
      {error && (
        <div className="text-destructive mb-3 flex items-start gap-1 text-xs break-words">
          <XCircle className="size-3 shrink-0" />
          <span className="min-w-0">{error}</span>
        </div>
      )}

      {/* Action Buttons */}
      {isPending && (
        <div className="flex items-center gap-2">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="success"
                  onClick={handleApprove}
                  disabled={isProcessing}
                  className="flex-1"
                >
                  {isApproving ? (
                    <Loader2 className="mr-1 size-4 animate-spin" />
                  ) : (
                    <CheckCircle className="mr-1 size-4" />
                  )}
                  Create Workflow
                </Button>
              </TooltipTrigger>
              <TooltipContent>Approve and create this workflow</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={handleReject}
                  disabled={isProcessing}
                  className="flex-1"
                >
                  {isRejecting ? (
                    <Loader2 className="mr-1 size-4 animate-spin" />
                  ) : (
                    <XCircle className="mr-1 size-4" />
                  )}
                  Cancel
                </Button>
              </TooltipTrigger>
              <TooltipContent>Cancel workflow creation</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      )}

      {/* Status message for resolved approvals */}
      {!isPending && (
        <div className="text-muted-foreground text-xs">
          {status === 'approved' && executionError
            ? 'Workflow creation was approved but failed.'
            : status === 'approved'
              ? 'Workflow was created successfully.'
              : 'Workflow creation was cancelled.'}
        </div>
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
