'use client';

import { Link } from '@tanstack/react-router';
import { useMutation, useAction } from 'convex/react';
import {
  CheckCircle,
  XCircle,
  Loader2,
  Workflow,
  ChevronDown,
  ChevronRight,
  ExternalLink,
} from 'lucide-react';
import { memo, useState } from 'react';

import { Badge } from '@/app/components/ui/feedback/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/app/components/ui/overlays/tooltip';
import { Button } from '@/app/components/ui/primitives/button';
import { useAuth } from '@/app/hooks/use-convex-auth';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import { WorkflowCreationMetadata } from '@/convex/approvals/types';
import { cn } from '@/lib/utils/cn';

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
        'border rounded-lg p-4 bg-card shadow-sm max-w-md',
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

        {showSteps && (
          <div className="bg-muted/50 space-y-1.5 rounded-md p-2">
            {metadata.stepsConfig.map((step, index) => (
              <div key={step.stepSlug} className="flex items-center gap-2">
                <span className="text-muted-foreground w-4 text-xs">
                  {index + 1}.
                </span>
                <Badge
                  variant={getStepTypeBadgeVariant(step.stepType)}
                  className="py-0 text-[10px]"
                >
                  {step.stepType}
                </Badge>
                <span className="flex-1 truncate text-xs">{step.name}</span>
              </div>
            ))}
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
        <div className="text-destructive mb-3 flex items-center gap-1 text-xs">
          <XCircle className="size-3" />
          {executionError}
        </div>
      )}

      {/* Error Message (temporary UI error) */}
      {error && (
        <div className="text-destructive mb-3 flex items-center gap-1 text-xs">
          <XCircle className="size-3" />
          {error}
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
