'use client';

import { Button } from '@tale/ui/button';
import { Skeleton } from '@tale/ui/skeleton';
import { useCallback, useMemo, useRef, useState } from 'react';

import { Input } from '@/app/components/ui/forms/input';
import { Switch } from '@/app/components/ui/forms/switch';
import { PageSection } from '@/app/components/ui/layout/page-section';
import { Text } from '@/app/components/ui/typography/text';
import { useAbility } from '@/app/hooks/use-ability';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import {
  DEFAULT_DSAR_GOVERNANCE,
  type DsarGovernanceConfig,
  dsarGovernanceConfigSchema,
} from '@/lib/shared/schemas/governance';
import { isRecord } from '@/lib/utils/type-guards';

import { useUpsertGovernancePolicy } from '../hooks/mutations';
import { useGovernancePolicy } from '../hooks/queries';

interface DsarPolicyEditorProps {
  organizationId: string;
}

function parseConfig(raw: unknown): DsarGovernanceConfig {
  const obj = isRecord(raw) ? raw : {};
  const result = dsarGovernanceConfigSchema.safeParse(obj);
  return result.success ? result.data : DEFAULT_DSAR_GOVERNANCE;
}

export function DsarPolicyEditor({ organizationId }: DsarPolicyEditorProps) {
  const { t } = useT('governance');
  const { toast } = useToast();
  const ability = useAbility();

  const { data: policy, isLoading } = useGovernancePolicy(
    organizationId,
    'dsar_governance',
  );
  const upsertMutation = useUpsertGovernancePolicy();

  const savedConfig = useMemo(() => parseConfig(policy?.config), [policy]);

  const initializedRef = useRef(false);
  const [coolingOffHours, setCoolingOffHours] = useState('24');
  const [requireDualApproval, setRequireDualApproval] = useState(false);
  const [dailyLimitPerAdmin, setDailyLimitPerAdmin] = useState('5');

  if (!isLoading && !initializedRef.current) {
    initializedRef.current = true;
    setCoolingOffHours(String(savedConfig.coolingOffHours));
    setRequireDualApproval(savedConfig.requireDualApproval);
    setDailyLimitPerAdmin(String(savedConfig.dailyLimitPerAdmin));
  }

  const cannotManage = ability.cannot('write', 'orgSettings');

  const isDirty = useMemo(() => {
    if (Number(coolingOffHours) !== savedConfig.coolingOffHours) return true;
    if (requireDualApproval !== savedConfig.requireDualApproval) return true;
    if (Number(dailyLimitPerAdmin) !== savedConfig.dailyLimitPerAdmin)
      return true;
    return false;
  }, [coolingOffHours, requireDualApproval, dailyLimitPerAdmin, savedConfig]);

  const handleSave = useCallback(async () => {
    const hours = Number(coolingOffHours);
    if (!Number.isInteger(hours) || hours < 0 || hours > 72) {
      toast({
        title: t('dsarPolicy.invalidCoolingOffHours'),
        variant: 'destructive',
      });
      return;
    }
    const limit = Number(dailyLimitPerAdmin);
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
      toast({
        title: t('dsarPolicy.invalidDailyLimit'),
        variant: 'destructive',
      });
      return;
    }
    try {
      await upsertMutation.mutateAsync({
        organizationId,
        policyType: 'dsar_governance',
        config: {
          coolingOffHours: hours,
          requireDualApproval,
          dailyLimitPerAdmin: limit,
        } satisfies DsarGovernanceConfig,
      });
      toast({
        title: t('toastSavedTitle'),
        description: t('dsarPolicy.saved'),
        variant: 'success',
      });
    } catch (e) {
      console.error(e);
      toast({
        title: t('toastSaveFailedTitle'),
        description: t('dsarPolicy.saveFailed'),
        variant: 'destructive',
      });
    }
  }, [
    coolingOffHours,
    requireDualApproval,
    dailyLimitPerAdmin,
    organizationId,
    upsertMutation,
    toast,
    t,
  ]);

  if (isLoading) {
    return (
      <PageSection
        title={t('dsarPolicy.title')}
        description={t('dsarPolicy.description')}
      >
        <div className="flex max-w-2xl flex-col gap-4">
          <Skeleton className="h-8 w-full rounded-md" />
          <Skeleton className="h-8 w-full rounded-md" />
          <Skeleton className="h-8 w-full rounded-md" />
        </div>
      </PageSection>
    );
  }

  return (
    <PageSection
      title={t('dsarPolicy.title')}
      description={t('dsarPolicy.description')}
    >
      <div className="flex max-w-2xl flex-col gap-5">
        <Input
          id="dsar-policy-cooling-off"
          type="number"
          min={0}
          max={72}
          step={1}
          label={t('dsarPolicy.coolingOffHours.label')}
          description={t('dsarPolicy.coolingOffHours.description')}
          value={coolingOffHours}
          onChange={(e) => setCoolingOffHours(e.target.value)}
          disabled={cannotManage}
        />

        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <Text as="span" className="text-sm font-medium">
              {t('dsarPolicy.requireDualApproval.label')}
            </Text>
            <Text as="span" variant="muted" className="text-xs">
              {t('dsarPolicy.requireDualApproval.description')}
            </Text>
          </div>
          <Switch
            checked={requireDualApproval}
            onCheckedChange={setRequireDualApproval}
            disabled={cannotManage}
            aria-label={t('dsarPolicy.requireDualApproval.label')}
          />
        </div>

        <Input
          id="dsar-policy-daily-limit"
          type="number"
          min={1}
          max={50}
          step={1}
          label={t('dsarPolicy.dailyLimitPerAdmin.label')}
          description={t('dsarPolicy.dailyLimitPerAdmin.description')}
          value={dailyLimitPerAdmin}
          onChange={(e) => setDailyLimitPerAdmin(e.target.value)}
          disabled={cannotManage}
        />

        <div>
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={() => void handleSave()}
            disabled={cannotManage || !isDirty || upsertMutation.isPending}
          >
            {t('common.actions.save')}
          </Button>
        </div>
      </div>
    </PageSection>
  );
}
