'use client';

import { Button } from '@tale/ui/button';
import { PageSection } from '@tale/ui/page-section';
import { SkeletonBox, SkeletonText } from '@tale/ui/skeleton';
import { Skeletonize, useSkeleton } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';
import { Pencil } from 'lucide-react';
import { useMemo, useState } from 'react';

import { useAbility } from '@/app/hooks/use-ability';
import { useT } from '@/lib/i18n/client';
import {
  retentionPolicyConfigSchema,
  type RetentionPolicyConfig,
} from '@/lib/shared/schemas/governance';
import type { RetentionCategory } from '@/lib/shared/schemas/retention';
import { isRecord } from '@/lib/utils/type-guards';

import { useGovernancePolicy } from '../hooks/queries';
import type { CategoryBounds } from '../hooks/use-retention-bounds';
import { useRetentionBounds } from '../hooks/use-retention-bounds';
import { RetentionBoundsProposalBanner } from './retention-bounds-proposal-banner';
import { WIRE_MAPPING } from './retention-categories';
import { RetentionEditDrawer } from './retention-edit-drawer';
import { RetentionPendingBanner } from './retention-pending-banner';
import { RetentionPolicySummary } from './retention-policy-summary';

interface RetentionEditorProps {
  organizationId: string;
}

function parseRetentionConfig(policy: unknown): RetentionPolicyConfig {
  const config = isRecord(policy) ? policy : {};
  const result = retentionPolicyConfigSchema.safeParse(config);
  if (result.success) {
    return result.data;
  }
  return { documentsRetentionDays: 90 };
}

/**
 * Masked stand-in for `RetentionPolicySummary` shown while the policy loads.
 * Mirrors its bordered card + one `<dl>` row per category (driven by the same
 * `WIRE_MAPPING` the real summary maps over, so the masked and loaded row
 * counts can never drift) + the grace row + a block reserving the timeline's
 * height. Decorative — the enclosing `<Skeletonize>` owns the one status
 * announcement, so the rows here are plain masked text.
 */
function RetentionSummarySkeleton() {
  return (
    <div className="border-border flex flex-col gap-4 rounded-lg border p-4">
      <dl className="space-y-1 text-sm">
        {WIRE_MAPPING.map((wire) => (
          <div key={wire.id} className="flex gap-2">
            <dt className="w-44 shrink-0">
              <SkeletonText width="8rem" />
            </dt>
            <dd>
              <SkeletonText width="4rem" />
            </dd>
          </div>
        ))}
        <div className="flex gap-2 pt-1">
          <dt className="w-44 shrink-0">
            <SkeletonText width="9rem" />
          </dt>
          <dd>
            <SkeletonText width="2rem" />
          </dd>
        </div>
      </dl>
      <div className="border-border/50 border-t pt-4">
        {/* Reserve the three-step timeline's height so swapping to the live
            summary doesn't shift the rest of the page. */}
        <SkeletonBox className="h-12 w-full" />
      </div>
    </div>
  );
}

interface RetentionEditorViewProps {
  organizationId: string;
  config: RetentionPolicyConfig;
  bounds: Map<RetentionCategory, CategoryBounds>;
  retentionDisabled: boolean;
  cannotManage: boolean;
  drawerOpen: boolean;
  onDrawerOpenChange: (open: boolean) => void;
}

/**
 * Plain presentational view — no data/state hooks of its own. Rendered both
 * live (by the container) and as its own skeleton (the container wraps it in
 * `<Skeletonize>`), so the loading and loaded layouts are the SAME tree and
 * cannot drift.
 *
 * The conditional banners (`RetentionBoundsProposalBanner`,
 * `RetentionPendingBanner`) mount only when their async reads return data —
 * which never happens during the initial skeleton pass, so they render nothing
 * while loading. They stay ABOVE the summary in source order, so any later
 * mount only nudges layout below them. While loading, the summary region shows
 * `RetentionSummarySkeleton` (same card + row count) so the block reserves its
 * real height; the Edit action button auto-masks via `<Skeletonize>`.
 */
export function RetentionEditorView({
  organizationId,
  config,
  bounds,
  retentionDisabled,
  cannotManage,
  drawerOpen,
  onDrawerOpenChange,
}: RetentionEditorViewProps) {
  const { t } = useT('governance');
  const { t: tCommon } = useT('common');
  const loading = useSkeleton();

  return (
    <PageSection
      title={t('retentionPolicy.title', 'Retention policy')}
      description={t(
        'retentionPolicy.description',
        'Configure how long each data type is kept before deletion.',
      )}
      action={
        <Button
          variant="secondary"
          size="sm"
          icon={Pencil}
          disabled={cannotManage}
          onClick={() => onDrawerOpenChange(true)}
        >
          {tCommon('actions.edit')}
        </Button>
      }
    >
      {retentionDisabled && (
        <div className="border-warning bg-warning/10 rounded border p-3">
          <Text className="text-sm">
            {t(
              'retentionPolicy.envDisabled',
              'Retention is currently disabled by the operator (TALE_RETENTION_DISABLED=true). Cleanup will not run until the env flag is removed.',
            )}
          </Text>
        </div>
      )}

      <RetentionBoundsProposalBanner organizationId={organizationId} />
      <RetentionPendingBanner organizationId={organizationId} />

      {loading ? (
        <RetentionSummarySkeleton />
      ) : (
        <RetentionPolicySummary config={config} bounds={bounds} />
      )}

      <RetentionEditDrawer
        open={drawerOpen}
        onOpenChange={onDrawerOpenChange}
        savedConfig={config}
        bounds={bounds}
        organizationId={organizationId}
        cannotManage={cannotManage}
      />
    </PageSection>
  );
}

// =============================================================================
// Container — owns data fetching (policy + bounds), the drawer open state, and
// the loading state. Wraps the plain view in `<Skeletonize>` so the same tree
// renders the skeleton while the policy loads.
// =============================================================================
export function RetentionEditor({ organizationId }: RetentionEditorProps) {
  const { t } = useT('governance');
  const ability = useAbility();

  const { data: policy, isLoading } = useGovernancePolicy(
    organizationId,
    'retention_policy',
  );
  const { bounds, retentionDisabled } = useRetentionBounds(organizationId);

  const savedConfig = useMemo(
    () => parseRetentionConfig(policy?.config),
    [policy],
  );

  const cannotManage = ability.cannot('write', 'orgSettings');
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <Skeletonize
      loading={isLoading}
      label={t('retentionPolicy.title', 'Retention policy')}
    >
      <RetentionEditorView
        organizationId={organizationId}
        config={savedConfig}
        bounds={bounds}
        retentionDisabled={retentionDisabled}
        cannotManage={cannotManage}
        drawerOpen={drawerOpen}
        onDrawerOpenChange={setDrawerOpen}
      />
    </Skeletonize>
  );
}
