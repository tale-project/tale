'use client';

import { memo, useState } from 'react';
import { useMutation, useAction } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import { WorkflowCreationMetadata } from '@/convex/model/approvals/types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  CheckCircle,
  XCircle,
  Loader2,
  Workflow,
  ChevronDown,
  ChevronRight,
  ExternalLink,
} from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import Link from 'next/link';
import { useParams } from 'next/navigation';

interface WorkflowCreationApprovalCardProps {
  approvalId: Id<'approvals'>;
  status: 'pending' | 'approved' | 'rejected';
  metadata: WorkflowCreationMetadata;
  executedAt?: number;
  executionError?: string;
  className?: string;
}

/**
 * Card component for displaying workflow creation approvals in chat
 */
function WorkflowCreationApprovalCardComponent({
  approvalId,
  status,
  metadata,
  executedAt,
  executionError,
  className,
}: WorkflowCreationApprovalCardProps) {
  const params = useParams();
  const dashboardId = params.id as string;

  const [isApproving, setIsApproving] = useState(false);
  const [isRejecting, setIsRejecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSteps, setShowSteps] = useState(false);

  // No optimistic update: approval triggers external workflow creation action with
  // side effects that cannot be safely rolled back if the mutation fails.
  const updateApprovalStatus = useMutation(api.approvals.updateApprovalStatusPublic);
  const executeApprovedWorkflow = useAction(
    api.approvals.executeApprovedWorkflowCreation
  );

  const isPending = status === 'pending';
  const isProcessing = isApproving || isRejecting;

  const handleApprove = async () => {
    setIsApproving(true);
    setError(null);
    try {
      // Execute the approved workflow creation (handles status update + execution)
      await executeApprovedWorkflow({
        approvalId,
        approvedBy: 'user', // TODO: Get actual user ID from auth context
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create workflow');
      console.error('Failed to approve:', err);
    } finally {
      setIsApproving(false);
    }
  };

  const handleReject = async () => {
    setIsRejecting(true);
    setError(null);
    try {
      await updateApprovalStatus({
        approvalId,
        status: 'rejected',
        approvedBy: 'user', // TODO: Get actual user ID
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reject');
      console.error('Failed to reject:', err);
    } finally {
      setIsRejecting(false);
    }
  };

  // Get step type badge color
  const getStepTypeBadgeVariant = (stepType: string): 'blue' | 'green' | 'orange' | 'yellow' | 'outline' => {
    switch (stepType) {
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

  return (
    <div
      className={cn(
        'border rounded-lg p-4 bg-card shadow-sm max-w-md',
        status === 'approved' && 'border-success/30 bg-success/5',
        status === 'rejected' && 'border-destructive/30 bg-destructive/5',
        status === 'pending' && 'border-primary/30 bg-primary/5',
        className
      )}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-md bg-primary/10">
            <Workflow className="size-4 text-primary" />
          </div>
          <div>
            <div className="font-medium text-sm">{metadata.workflowName}</div>
            {metadata.workflowDescription && (
              <div className="text-xs text-muted-foreground line-clamp-2">
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
          className="capitalize text-xs"
        >
          {status}
        </Badge>
      </div>

      {/* Workflow Steps Preview */}
      <div className="space-y-2 mb-3">
        <button
          type="button"
          onClick={() => setShowSteps(!showSteps)}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {showSteps ? (
            <ChevronDown className="size-3" />
          ) : (
            <ChevronRight className="size-3" />
          )}
          {metadata.stepsConfig.length} steps
        </button>

        {showSteps && (
          <div className="bg-muted/50 rounded-md p-2 space-y-1.5">
            {metadata.stepsConfig.map((step, index) => (
              <div key={step.stepSlug} className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground w-4">
                  {index + 1}.
                </span>
                <Badge
                  variant={getStepTypeBadgeVariant(step.stepType)}
                  className="text-[10px] py-0"
                >
                  {step.stepType}
                </Badge>
                <span className="text-xs truncate flex-1">{step.name}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Execution Result (if approved and executed) */}
      {status === 'approved' && executedAt && !executionError && (
        <div className="mb-3 space-y-1">
          <div className="text-xs text-green-600 flex items-center gap-1">
            <CheckCircle className="size-3" />
            Workflow created successfully
          </div>
          {metadata.createdWorkflowId && (
            <Link
              href={`/dashboard/${dashboardId}/automations/${metadata.createdWorkflowId}`}
              className="text-xs text-primary hover:underline flex items-center gap-1"
            >
              View workflow
              <ExternalLink className="size-3" />
            </Link>
          )}
        </div>
      )}

      {/* Execution Error (persisted from backend) */}
      {status === 'approved' && executionError && (
        <div className="text-xs text-destructive mb-3 flex items-center gap-1">
          <XCircle className="size-3" />
          {executionError}
        </div>
      )}

      {/* Error Message (temporary UI error) */}
      {error && (
        <div className="text-xs text-destructive mb-3 flex items-center gap-1">
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
                    <Loader2 className="size-4 animate-spin mr-1" />
                  ) : (
                    <CheckCircle className="size-4 mr-1" />
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
                    <Loader2 className="size-4 animate-spin mr-1" />
                  ) : (
                    <XCircle className="size-4 mr-1" />
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
        <div className="text-xs text-muted-foreground">
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
      prevProps.status === nextProps.status &&
      prevProps.className === nextProps.className &&
      prevProps.executedAt === nextProps.executedAt &&
      prevProps.executionError === nextProps.executionError
    );
  }
);
