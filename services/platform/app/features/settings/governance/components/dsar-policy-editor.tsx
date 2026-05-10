'use client';

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

/**
 * Auto-save on blur: each input commits its value to the server when it
 * loses focus (or when the Switch toggles, which has no blur). No "Save"
 * button — the three fields are infrequent governance knobs and an
 * explicit save step adds friction without a real upside.
 *
 * Validation: on commit we run the same Zod schema the server uses;
 * invalid values are rejected with a toast and the field reverts to
 * the last saved value.
 */
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

  const persist = useCallback(
    async (next: DsarGovernanceConfig) => {
      try {
        await upsertMutation.mutateAsync({
          organizationId,
          policyType: 'dsar_governance',
          config: next,
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
    },
    [organizationId, upsertMutation, toast, t],
  );

  const commitCoolingOffHours = useCallback(() => {
    const hours = Number(coolingOffHours);
    if (!Number.isInteger(hours) || hours < 0 || hours > 72) {
      toast({
        title: t('dsarPolicy.invalidCoolingOffHours'),
        variant: 'destructive',
      });
      // Revert visible value to last saved.
      setCoolingOffHours(String(savedConfig.coolingOffHours));
      return;
    }
    if (hours === savedConfig.coolingOffHours) return;
    void persist({
      coolingOffHours: hours,
      requireDualApproval,
      dailyLimitPerAdmin: savedConfig.dailyLimitPerAdmin,
    });
  }, [coolingOffHours, requireDualApproval, savedConfig, persist, toast, t]);

  const commitDailyLimit = useCallback(() => {
    const limit = Number(dailyLimitPerAdmin);
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
      toast({
        title: t('dsarPolicy.invalidDailyLimit'),
        variant: 'destructive',
      });
      setDailyLimitPerAdmin(String(savedConfig.dailyLimitPerAdmin));
      return;
    }
    if (limit === savedConfig.dailyLimitPerAdmin) return;
    void persist({
      coolingOffHours: savedConfig.coolingOffHours,
      requireDualApproval,
      dailyLimitPerAdmin: limit,
    });
  }, [dailyLimitPerAdmin, requireDualApproval, savedConfig, persist, toast, t]);

  const handleDualApprovalToggle = useCallback(
    (next: boolean) => {
      setRequireDualApproval(next);
      void persist({
        coolingOffHours: savedConfig.coolingOffHours,
        requireDualApproval: next,
        dailyLimitPerAdmin: savedConfig.dailyLimitPerAdmin,
      });
    },
    [savedConfig, persist],
  );

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
          onBlur={commitCoolingOffHours}
          disabled={cannotManage || upsertMutation.isPending}
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
            onCheckedChange={handleDualApprovalToggle}
            disabled={cannotManage || upsertMutation.isPending}
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
          onBlur={commitDailyLimit}
          disabled={cannotManage || upsertMutation.isPending}
        />
      </div>
    </PageSection>
  );
}
