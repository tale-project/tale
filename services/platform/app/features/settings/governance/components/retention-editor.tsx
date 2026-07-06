'use client';

import { Alert } from '@tale/ui/alert';
import { Button } from '@tale/ui/button';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { AlertTriangle, Pencil } from 'lucide-react';
import { useMemo, useState } from 'react';

import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { useAbility } from '@/app/hooks/use-ability';
import { useT } from '@/lib/i18n/client';
import {
  retentionPolicyConfigSchema,
  type RetentionPolicyConfig,
} from '@/lib/shared/schemas/governance';
import { isRecord } from '@/lib/utils/type-utils';

import { useGovernancePolicy } from '../hooks/queries';
import { useRetentionBounds } from '../hooks/use-retention-bounds';
import { RetentionBoundsProposalBanner } from './retention-bounds-proposal-banner';
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

// =============================================================================
// Single editor — owns data fetching (policy + bounds), the drawer open state,
// and the loading state. Renders the REAL `SettingsSection` once, always, wrapped
// in `<Skeletonize>` while the policy loads.
//
// The conditional banners (`RetentionBoundsProposalBanner`,
// `RetentionPendingBanner`) mount only when their async reads return data —
// which never happens during the initial skeleton pass, so they render nothing
// while loading. They stay ABOVE the summary in source order, so any later
// mount only nudges layout below them. While loading, `RetentionPolicySummary`
// renders the same card with its dynamic values masked (the enclosing
// `<Skeletonize>` drives the mask), so the block reserves its real height; the
// Edit action button auto-masks via `<Skeletonize>`.
// =============================================================================
export function RetentionEditor({ organizationId }: RetentionEditorProps) {
  const { t } = useT('governance');
  const { t: tCommon } = useT('common');
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
      <SettingsSection
        title={t('retentionPolicy.title', 'Retention policy')}
        description={t(
          'retentionPolicy.description',
          'Configure how long each data type is kept before deletion.',
        )}
        action={
          <Button
            variant="secondary"
            icon={Pencil}
            disabled={cannotManage}
            onClick={() => setDrawerOpen(true)}
          >
            {tCommon('actions.edit')}
          </Button>
        }
      >
        {retentionDisabled && (
          <Alert
            variant="warning"
            icon={AlertTriangle}
            description={t(
              'retentionPolicy.envDisabled',
              'Retention is currently disabled by the operator (TALE_RETENTION_DISABLED=true). Cleanup will not run until the env flag is removed.',
            )}
          />
        )}

        <RetentionBoundsProposalBanner organizationId={organizationId} />
        <RetentionPendingBanner organizationId={organizationId} />

        <RetentionPolicySummary config={savedConfig} bounds={bounds} />

        <RetentionEditDrawer
          open={drawerOpen}
          onOpenChange={setDrawerOpen}
          savedConfig={savedConfig}
          bounds={bounds}
          organizationId={organizationId}
          cannotManage={cannotManage}
        />
      </SettingsSection>
    </Skeletonize>
  );
}
