'use client';

import { Button } from '@tale/ui/button';
import { Loader2, ShieldAlert } from 'lucide-react';
import { lazy, Suspense, useState } from 'react';

import { Text } from '@/app/components/ui/typography/text';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

import {
  useApplyBoundsProposal,
  useRejectBoundsProposal,
} from '../hooks/mutations';
import { usePendingBoundsProposal } from '../hooks/queries';
import type { DiffEntry, ImpactEntry } from './retention-bounds-details-drawer';

// Lazy-load the details drawer — banner-only render path pays no
// overhead until the admin clicks [View details].
const RetentionBoundsDetailsDrawer = lazy(() =>
  import('./retention-bounds-details-drawer').then((m) => ({
    default: m.RetentionBoundsDetailsDrawer,
  })),
);

interface Props {
  organizationId: string;
}

/**
 * Banner shown at the top of the retention editor when the operator's
 * current effective bounds (file × env) differ from this org's last
 * applied snapshot. Admin can [Apply] (cleanup picks up the new bounds
 * on its next run), [Reject] (banner stays hidden until the file
 * changes again), or [View details] (slide-in drawer with full
 * per-field diff and per-category impact preview).
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
  const [drawerOpen, setDrawerOpen] = useState(false);

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

  const hasDetails = diff.length > 0 || impactPreview.length > 0;
  const inFlight = apply.isPending || reject.isPending;

  return (
    <div className="border-warning bg-warning/10 flex flex-col gap-3 rounded border p-3">
      <div className="flex items-start gap-3">
        <ShieldAlert className="text-warning mt-0.5 h-4 w-4 shrink-0" />
        <div className="flex flex-1 flex-col gap-1">
          <Text className="text-sm font-medium">
            {t(titleKey, titleFallback)}
          </Text>
          <Text className="text-muted-foreground text-xs">
            {firstApply
              ? t(
                  'retentionPolicy.boundsProposal.firstApplyDescription',
                  'No bounds have been applied for this organization yet. Review the operator config and Apply to start enforcing retention.',
                )
              : t(
                  'retentionPolicy.boundsProposal.summary',
                  '{tightened} of {total} change(s) tighten retention. Review before applying.',
                  { tightened: tighteningCount, total: totalCount },
                )}
          </Text>
          {/*
           * Show the diff preview inline on first-apply too — without
           * it the operator is asked to approve a black-box change.
           * Round-2 / M10.
           */}
        </div>
      </div>

      <div className="ml-7 flex flex-wrap gap-2">
        <Button
          variant="primary"
          size="sm"
          onClick={handleApply}
          disabled={inFlight}
        >
          {apply.isPending ? (
            <>
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              {t('retentionPolicy.boundsProposal.applyingLabel', 'Applying…')}
            </>
          ) : (
            t('retentionPolicy.boundsProposal.applyLabel', 'Apply')
          )}
        </Button>
        {!firstApply && (
          <Button
            variant="secondary"
            size="sm"
            onClick={handleReject}
            disabled={inFlight}
          >
            {reject.isPending ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                {t(
                  'retentionPolicy.boundsProposal.rejectingLabel',
                  'Rejecting…',
                )}
              </>
            ) : (
              t('retentionPolicy.boundsProposal.rejectLabel', 'Reject')
            )}
          </Button>
        )}
        {hasDetails && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setDrawerOpen(true)}
            disabled={inFlight}
          >
            {t('retentionPolicy.boundsProposal.detailsLabel', 'View details')}
          </Button>
        )}
      </div>

      {drawerOpen && (
        <Suspense fallback={null}>
          <RetentionBoundsDetailsDrawer
            open={drawerOpen}
            onOpenChange={setDrawerOpen}
            diff={diff}
            impactPreview={impactPreview}
          />
        </Suspense>
      )}
    </div>
  );
}
