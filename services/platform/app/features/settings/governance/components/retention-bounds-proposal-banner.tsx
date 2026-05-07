'use client';

import { Button } from '@tale/ui/button';
import { ShieldAlert } from 'lucide-react';
import { useState } from 'react';

import { Text } from '@/app/components/ui/typography/text';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

import {
  useApplyBoundsProposal,
  useRejectBoundsProposal,
} from '../hooks/mutations';
import { usePendingBoundsProposal } from '../hooks/queries';

interface Props {
  organizationId: string;
}

interface DiffEntry {
  category: string;
  field: 'min' | 'max';
  from: number;
  to: number;
  direction: 'tighten' | 'loosen';
}

interface ImpactEntry {
  category: string;
  field: string;
  current: number;
  willClampTo: number;
}

/**
 * Banner shown at the top of the retention editor when the operator's
 * current effective bounds (file × env) differ from this org's last
 * applied snapshot. Admin can [Apply] (cleanup picks up the new bounds
 * on its next run) or [Reject] (banner stays hidden until the file
 * changes again).
 *
 * The proposal does NOT take effect until the admin acts. Cleanup
 * keeps using the previously-agreed bounds in the meantime.
 */
export function RetentionBoundsProposalBanner({ organizationId }: Props) {
  const { t } = useT('governance');
  const { toast } = useToast();
  const proposal = usePendingBoundsProposal(organizationId);
  const apply = useApplyBoundsProposal();
  const reject = useRejectBoundsProposal();
  const [expanded, setExpanded] = useState(false);

  if (!proposal.data) return null;

  const {
    firstApply,
    proposedHash,
    diff,
    impactPreview,
  }: {
    firstApply: boolean;
    proposedHash: string;
    diff: DiffEntry[];
    impactPreview: ImpactEntry[];
  } = proposal.data;

  const tighteningCount = diff.filter((d) => d.direction === 'tighten').length;
  const totalCount = diff.length;

  const handleApply = async () => {
    try {
      await apply.mutateAsync({ organizationId, proposedHash });
      toast({
        title: t('toastSavedTitle'),
        description: t(
          'retentionPolicy.boundsProposal.appliedToast',
          'Bounds proposal applied. Cleanup will use new bounds on next run.',
        ),
        variant: 'success',
      });
    } catch (err) {
      toast({
        title: t('toastSaveFailedTitle'),
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      });
    }
  };

  const handleReject = async () => {
    try {
      await reject.mutateAsync({ organizationId, proposedHash });
      toast({
        title: t('toastSavedTitle'),
        description: t(
          'retentionPolicy.boundsProposal.rejectedToast',
          'Bounds proposal rejected. Cleanup continues with previous bounds.',
        ),
        variant: 'success',
      });
    } catch (err) {
      toast({
        title: t('toastSaveFailedTitle'),
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      });
    }
  };

  const titleKey = firstApply
    ? 'retentionPolicy.boundsProposal.firstApplyTitle'
    : 'retentionPolicy.boundsProposal.title';
  const titleFallback = firstApply
    ? 'Operator retention bounds need your initial approval.'
    : 'Operator has proposed retention bound changes.';

  return (
    <div className="border-warning bg-warning/10 flex flex-col gap-3 rounded border p-3">
      <div className="flex items-start gap-3">
        <ShieldAlert className="text-warning mt-0.5 h-4 w-4 shrink-0" />
        <div className="flex flex-1 flex-col gap-1">
          <Text className="text-sm font-medium">
            {t(titleKey, titleFallback)}
          </Text>
          {!firstApply && (
            <Text className="text-muted-foreground text-xs">
              {t(
                'retentionPolicy.boundsProposal.summary',
                '{tightened} of {total} change(s) tighten retention. Review before applying.',
                { tightened: tighteningCount, total: totalCount },
              )}
            </Text>
          )}
          {firstApply && (
            <Text className="text-muted-foreground text-xs">
              {t(
                'retentionPolicy.boundsProposal.firstApplyDescription',
                'No bounds have been applied for this organization yet. Review the operator config and Apply to start enforcing retention.',
              )}
            </Text>
          )}
        </div>
      </div>

      {!firstApply && (diff.length > 0 || impactPreview.length > 0) && (
        <div className="ml-7 flex flex-col gap-2">
          <button
            type="button"
            className="text-foreground/80 hover:text-foreground self-start text-xs underline"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded
              ? t('retentionPolicy.boundsProposal.hideDetails', 'Hide details')
              : t(
                  'retentionPolicy.boundsProposal.reviewLabel',
                  'Review changes',
                )}
          </button>
          {expanded && (
            <div className="flex flex-col gap-3 text-xs">
              {diff.length > 0 && (
                <div>
                  <Text className="font-medium">
                    {t(
                      'retentionPolicy.boundsProposal.diffHeading',
                      'Bound changes',
                    )}
                  </Text>
                  <ul className="text-muted-foreground mt-1 list-disc space-y-0.5 pl-4">
                    {diff.map((d) => (
                      <li key={`${d.category}.${d.field}`}>
                        {t(
                          'retentionPolicy.boundsProposal.diffRow',
                          '{category}: {field} {from} → {to} ({direction})',
                          {
                            category: d.category,
                            field: d.field,
                            from: d.from,
                            to: d.to,
                            direction: d.direction,
                          },
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {impactPreview.length > 0 && (
                <div>
                  <Text className="font-medium">
                    {t(
                      'retentionPolicy.boundsProposal.impactHeading',
                      'Impact on your stored values',
                    )}
                  </Text>
                  <ul className="text-muted-foreground mt-1 list-disc space-y-0.5 pl-4">
                    {impactPreview.map((i) => (
                      <li key={i.category}>
                        {t(
                          'retentionPolicy.boundsProposal.impactRow',
                          '{category}: {current} will clamp to {clamped}',
                          {
                            category: i.category,
                            current: i.current,
                            clamped: i.willClampTo,
                          },
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="ml-7 flex gap-2">
        <Button
          variant="primary"
          size="sm"
          onClick={handleApply}
          disabled={apply.isPending || reject.isPending}
        >
          {t('retentionPolicy.boundsProposal.applyLabel', 'Apply')}
        </Button>
        {!firstApply && (
          <Button
            variant="secondary"
            size="sm"
            onClick={handleReject}
            disabled={apply.isPending || reject.isPending}
          >
            {t('retentionPolicy.boundsProposal.rejectLabel', 'Reject')}
          </Button>
        )}
      </div>
    </div>
  );
}
