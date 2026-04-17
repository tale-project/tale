'use client';

import { useCallback, useMemo, useRef, useState } from 'react';

import { Skeleton } from '@/app/components/ui/feedback/skeleton';
import { Input } from '@/app/components/ui/forms/input';
import { Switch } from '@/app/components/ui/forms/switch';
import { Stack } from '@/app/components/ui/layout/layout';
import { PageSection } from '@/app/components/ui/layout/page-section';
import { Button } from '@/app/components/ui/primitives/button';
import { Text } from '@/app/components/ui/typography/text';
import { useAbility } from '@/app/hooks/use-ability';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import {
  DEFAULT_TWO_FACTOR_POLICY,
  twoFactorPolicyConfigSchema,
  type TwoFactorPolicyConfig,
} from '@/lib/shared/schemas/governance';
import { cn } from '@/lib/utils/cn';
import { isRecord } from '@/lib/utils/type-guards';

import { useUpsertGovernancePolicy } from '../hooks/mutations';
import { useGovernancePolicy } from '../hooks/queries';

interface TwoFactorPolicyEditorProps {
  organizationId: string;
}

function parseConfig(raw: unknown): TwoFactorPolicyConfig {
  const obj = isRecord(raw) ? raw : {};
  const result = twoFactorPolicyConfigSchema.safeParse(obj);
  if (result.success) return result.data;
  return { ...DEFAULT_TWO_FACTOR_POLICY };
}

export function TwoFactorPolicyEditor({
  organizationId,
}: TwoFactorPolicyEditorProps) {
  const { t } = useT('governance');
  const { toast } = useToast();
  const ability = useAbility();

  const { data: policy, isLoading } = useGovernancePolicy(
    organizationId,
    'two_factor_policy',
  );
  const upsertMutation = useUpsertGovernancePolicy();

  const savedConfig = useMemo(() => parseConfig(policy?.config), [policy]);

  const initializedRef = useRef(false);
  const [enforced, setEnforced] = useState(false);
  const [gracePeriodDays, setGracePeriodDays] = useState('');
  const [exemptSsoUsers, setExemptSsoUsers] = useState(true);

  if (!isLoading && !initializedRef.current) {
    initializedRef.current = true;
    setEnforced(savedConfig.enforced);
    setGracePeriodDays(String(savedConfig.gracePeriodDays));
    setExemptSsoUsers(savedConfig.exemptSsoUsers);
  }

  const cannotManage = ability.cannot('write', 'orgSettings');

  const isDirty = useMemo(() => {
    if (enforced !== savedConfig.enforced) return true;
    if (exemptSsoUsers !== savedConfig.exemptSsoUsers) return true;
    if (gracePeriodDays !== String(savedConfig.gracePeriodDays)) return true;
    return false;
  }, [enforced, gracePeriodDays, exemptSsoUsers, savedConfig]);

  const handleSave = useCallback(async () => {
    const days = Number(gracePeriodDays);
    if (!Number.isInteger(days) || days < 0 || days > 30) {
      toast({
        title: t('twoFactorPolicy.invalidGrace'),
        variant: 'destructive',
      });
      return;
    }
    try {
      await upsertMutation.mutateAsync({
        organizationId,
        policyType: 'two_factor_policy',
        config: {
          enforced,
          gracePeriodDays: days,
          exemptSsoUsers,
        } satisfies TwoFactorPolicyConfig,
      });
      toast({ title: t('twoFactorPolicy.saved'), variant: 'success' });
    } catch {
      toast({
        title: t('twoFactorPolicy.saveFailed'),
        variant: 'destructive',
      });
    }
  }, [
    enforced,
    gracePeriodDays,
    exemptSsoUsers,
    organizationId,
    upsertMutation,
    toast,
    t,
  ]);

  if (isLoading || !initializedRef.current) {
    return (
      <div aria-busy="true" className="space-y-3 py-4">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-72" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  return (
    <PageSection
      title={t('twoFactorPolicy.title')}
      description={t('twoFactorPolicy.description')}
      action={
        <Switch
          label={t('twoFactorPolicy.enforced')}
          checked={enforced}
          onCheckedChange={setEnforced}
          disabled={cannotManage || upsertMutation.isPending}
        />
      }
    >
      <Stack gap={6} className="max-w-2xl">
        {!enforced && (
          <Text variant="muted" className="text-sm">
            {t('twoFactorPolicy.policyDisabledHint')}
          </Text>
        )}

        <div
          className={cn(
            'flex flex-col gap-6 transition-opacity duration-200',
            !enforced && 'pointer-events-none opacity-50',
          )}
        >
          <Stack gap={4}>
            <Input
              label={t('twoFactorPolicy.gracePeriodDays')}
              type="number"
              value={gracePeriodDays}
              onChange={(e) => setGracePeriodDays(e.target.value)}
              disabled={cannotManage || !enforced}
              size="sm"
              min={0}
              max={30}
              step={1}
            />
            <Text variant="muted" className="text-xs">
              {t('twoFactorPolicy.gracePeriodDaysHint')}
            </Text>

            <Switch
              label={t('twoFactorPolicy.exemptSsoUsers')}
              description={t('twoFactorPolicy.exemptSsoUsersHint')}
              checked={exemptSsoUsers}
              onCheckedChange={setExemptSsoUsers}
              disabled={cannotManage || !enforced}
            />
          </Stack>

          {isDirty && (
            <Button
              onClick={handleSave}
              disabled={cannotManage || upsertMutation.isPending}
              size="sm"
              className="self-start"
            >
              {upsertMutation.isPending
                ? t('systemPrompt.saving')
                : t('systemPrompt.save')}
            </Button>
          )}
        </div>
      </Stack>
    </PageSection>
  );
}
