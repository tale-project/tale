'use client';

import { memo, useState } from 'react';
import { useMutation, useAction } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
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
  AlertTriangle,
  Database,
  Globe,
  Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils/cn';

/**
 * Metadata for an integration operation approval
 */
interface IntegrationOperationMetadata {
  integrationId: string;
  integrationName: string;
  integrationType: 'sql' | 'rest_api';
  operationName: string;
  operationTitle: string;
  operationType: 'read' | 'write';
  parameters: Record<string, unknown>;
  previewData?: unknown[];
  estimatedImpact?: string;
  requestedAt: number;
  executedAt?: number;
  executionResult?: unknown;
}

interface IntegrationApprovalCardProps {
  approvalId: Id<'approvals'>;
  status: 'pending' | 'approved' | 'rejected';
  metadata: IntegrationOperationMetadata;
  className?: string;
}

/**
 * Card component for displaying integration operation approvals in chat
 */
function IntegrationApprovalCardComponent({
  approvalId,
  status,
  metadata,
  className,
}: IntegrationApprovalCardProps) {
  const [isApproving, setIsApproving] = useState(false);
  const [isRejecting, setIsRejecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateApprovalStatus = useMutation(api.approvals.updateApprovalStatusPublic);
  const executeApprovedOperation = useAction(
    api.approvals.executeApprovedIntegrationOperation
  );

  const isPending = status === 'pending';
  const isProcessing = isApproving || isRejecting;

  const handleApprove = async () => {
    setIsApproving(true);
    setError(null);
    try {
      // Execute the approved operation (handles status update + execution)
      await executeApprovedOperation({
        approvalId,
        approvedBy: 'user', // TODO: Get actual user ID from auth context
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to approve operation');
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
      setError(err instanceof Error ? err.message : 'Failed to reject operation');
      console.error('Failed to reject:', err);
    } finally {
      setIsRejecting(false);
    }
  };

  // Format parameters for display
  const formatParameters = (params: Record<string, unknown>) => {
    const entries = Object.entries(params).filter(([_, v]) => v !== undefined && v !== null);
    if (entries.length === 0) return null;
    return entries.slice(0, 3).map(([key, value]) => (
      <div key={key} className="text-xs text-muted-foreground truncate">
        <span className="font-medium">{key}:</span>{' '}
        <span>{typeof value === 'object' ? JSON.stringify(value) : String(value)}</span>
      </div>
    ));
  };

  const IntegrationIcon = metadata.integrationType === 'sql' ? Database : Globe;

  return (
    <div
      className={cn(
        'border rounded-lg p-4 bg-card shadow-sm max-w-md',
        status === 'approved' && 'border-green-200 bg-green-50/50',
        status === 'rejected' && 'border-red-200 bg-red-50/50',
        status === 'pending' && 'border-orange-200 bg-orange-50/50',
        className
      )}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-md bg-muted">
            <IntegrationIcon className="size-4 text-muted-foreground" />
          </div>
          <div>
            <div className="font-medium text-sm">{metadata.operationTitle}</div>
            <div className="text-xs text-muted-foreground">
              {metadata.integrationName}
            </div>
          </div>
        </div>
        <Badge
          variant={
            status === 'approved'
              ? 'green'
              : status === 'rejected'
                ? 'destructive'
                : 'orange'
          }
          className="capitalize text-xs"
        >
          {status}
        </Badge>
      </div>

      {/* Operation Details */}
      <div className="space-y-2 mb-3">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs">
            {metadata.operationType === 'write' ? (
              <AlertTriangle className="size-3 mr-1" />
            ) : null}
            {metadata.operationType}
          </Badge>
          <span className="text-xs text-muted-foreground font-mono">
            {metadata.operationName}
          </span>
        </div>

        {/* Parameters Preview */}
        {metadata.parameters && Object.keys(metadata.parameters).length > 0 && (
          <div className="bg-muted/50 rounded-md p-2 space-y-0.5">
            {formatParameters(metadata.parameters)}
            {Object.keys(metadata.parameters).length > 3 && (
              <div className="text-xs text-muted-foreground">
                +{Object.keys(metadata.parameters).length - 3} more
              </div>
            )}
          </div>
        )}

        {/* Estimated Impact */}
        {metadata.estimatedImpact && (
          <div className="text-xs text-muted-foreground italic">
            {metadata.estimatedImpact}
          </div>
        )}
      </div>

      {/* Execution Result (if approved and executed) */}
      {status === 'approved' && metadata.executedAt && (
        <div className="text-xs text-green-600 flex items-center gap-1 mb-3">
          <CheckCircle className="size-3" />
          Executed successfully
        </div>
      )}

      {/* Error Message */}
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
                  Approve
                </Button>
              </TooltipTrigger>
              <TooltipContent>Approve and execute this operation</TooltipContent>
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
                  Reject
                </Button>
              </TooltipTrigger>
              <TooltipContent>Reject this operation</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      )}

      {/* Status message for resolved approvals */}
      {!isPending && (
        <div className="text-xs text-muted-foreground">
          {status === 'approved'
            ? 'This operation was approved and executed.'
            : 'This operation was rejected.'}
        </div>
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
      prevProps.className === nextProps.className
    );
  }
);

export default IntegrationApprovalCard;
