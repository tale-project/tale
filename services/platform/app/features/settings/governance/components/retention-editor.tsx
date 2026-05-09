'use client';

import { Button } from '@tale/ui/button';
import { Skeleton } from '@tale/ui/skeleton';
import { Pencil } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';

import { PageSection } from '@/app/components/ui/layout/page-section';
import { Text } from '@/app/components/ui/typography/text';
import { useAbility } from '@/app/hooks/use-ability';
import { useT } from '@/lib/i18n/client';
import {
  retentionPolicyConfigSchema,
  type RetentionPolicyConfig,
} from '@/lib/shared/schemas/governance';
import { isRecord } from '@/lib/utils/type-guards';

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

function skeletonRow(): ReactNode {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex flex-col gap-1">
        <Skeleton className="h-5 w-44" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      <Skeleton className="h-8 w-24 rounded-md" />
    </div>
  );
}

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

  if (isLoading) {
    return (
      <div aria-busy="true" className="flex flex-col gap-6">
        {skeletonRow()}
        {skeletonRow()}
        {skeletonRow()}
      </div>
    );
  }

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
          onClick={() => setDrawerOpen(true)}
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

      <RetentionPolicySummary config={savedConfig} bounds={bounds} />

      <RetentionEditDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        savedConfig={savedConfig}
        bounds={bounds}
        organizationId={organizationId}
        cannotManage={cannotManage}
      />
    </PageSection>
  );
}
