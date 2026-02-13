'use client';

import {
  CheckCircle,
  XCircle,
  AlertTriangle,
  Database,
  Globe,
  Loader2,
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
import { useExecuteApprovedIntegrationOperation } from '@/app/features/approvals/hooks/actions';
import { useUpdateApprovalStatus } from '@/app/features/approvals/hooks/mutations';
import { useAuth } from '@/app/hooks/use-convex-auth';
import { Id } from '@/convex/_generated/dataModel';
import { IntegrationOperationMetadata } from '@/convex/approvals/types';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

interface IntegrationApprovalCardProps {
  approvalId: Id<'approvals'>;
  organizationId: string;
  status: 'pending' | 'approved' | 'rejected';
  metadata: IntegrationOperationMetadata;
  executedAt?: number;
  executionError?: string;
  className?: string;
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
}: IntegrationApprovalCardProps) {
  const { t } = useT('integrationApproval');
  const { user } = useAuth();
  const [isApproving, setIsApproving] = useState(false);
  const [isRejecting, setIsRejecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { mutateAsync: updateApprovalStatus } = useUpdateApprovalStatus();
  const { mutateAsync: executeApprovedOperation } =
    useExecuteApprovedIntegrationOperation();

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
      await executeApprovedOperation({
        approvalId,
      });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to approve operation',
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
      setError(
        err instanceof Error ? err.message : 'Failed to reject operation',
      );
      console.error('Failed to reject:', err);
    } finally {
      setIsRejecting(false);
    }
  };

  const [isExpanded, setIsExpanded] = useState(false);

  // Format parameters for display
  const formatParameters = (params: Record<string, unknown>) => {
    const entries = Object.entries(params).filter(
      ([_, v]) => v !== undefined && v !== null,
    );
    if (entries.length === 0) return null;
    const visible = isExpanded ? entries : entries.slice(0, 3);
    return visible.map(([key, value]) => (
      <div key={key} className="text-muted-foreground text-xs break-words">
        <span className="font-medium">{key}:</span>{' '}
        <span>
          {typeof value === 'string'
            ? value
            : typeof value === 'number' || typeof value === 'boolean'
              ? String(value)
              : JSON.stringify(value)}
        </span>
      </div>
    ));
  };

  const IntegrationIcon = metadata.integrationType === 'sql' ? Database : Globe;

  return (
    <div
      className={cn(
        'border rounded-lg p-4 bg-card shadow-sm max-w-md overflow-hidden',
        status === 'approved' && 'border-success/30 bg-success/5',
        status === 'rejected' && 'border-destructive/30 bg-destructive/5',
        status === 'pending' && 'border-warning/30 bg-warning/5',
        className,
      )}
    >
      {/* Header */}
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="bg-muted rounded-md p-1.5">
            <IntegrationIcon className="text-muted-foreground size-4" />
          </div>
          <div>
            <div className="text-sm font-medium">{metadata.operationTitle}</div>
            <div className="text-muted-foreground text-xs">
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
          className="text-xs capitalize"
        >
          {status}
        </Badge>
      </div>

      {/* Operation Details */}
      <div className="mb-3 space-y-2">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs">
            {metadata.operationType === 'write' ? (
              <AlertTriangle className="mr-1 size-3" />
            ) : null}
            {metadata.operationType}
          </Badge>
          <span className="text-muted-foreground font-mono text-xs">
            {metadata.operationName}
          </span>
        </div>

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
          <div className="text-muted-foreground text-xs break-words italic">
            {metadata.estimatedImpact}
          </div>
        )}
      </div>

      {/* Execution Result (if approved and executed) */}
      {status === 'approved' && executedAt && !executionError && (
        <div className="mb-3 flex items-center gap-1 text-xs text-green-600">
          <CheckCircle className="size-3" />
          {t('executedSuccessfully')}
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
                  {t('approve')}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('approveTooltip')}</TooltipContent>
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
                  {t('reject')}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('rejectTooltip')}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      )}

      {/* Status message for resolved approvals */}
      {!isPending && (
        <div className="text-muted-foreground text-xs">
          {status === 'approved' && executionError
            ? t('statusApprovedFailed')
            : status === 'approved'
              ? t('statusApprovedSuccess')
              : t('statusRejected')}
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
      prevProps.className === nextProps.className &&
      prevProps.executedAt === nextProps.executedAt &&
      prevProps.executionError === nextProps.executionError
    );
  },
);
