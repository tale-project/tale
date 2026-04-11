'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { Input } from '@/app/components/ui/forms/input';
import { Select } from '@/app/components/ui/forms/select';
import { Switch } from '@/app/components/ui/forms/switch';
import { Stack } from '@/app/components/ui/layout/layout';
import { PageSection } from '@/app/components/ui/layout/page-section';
import { Button } from '@/app/components/ui/primitives/button';
import { Text } from '@/app/components/ui/typography/text';
import { useAbility } from '@/app/hooks/use-ability';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import {
  retentionPolicyConfigSchema,
  type RetentionPolicyConfig,
} from '@/lib/shared/schemas/governance';
import { isRecord } from '@/lib/utils/type-guards';

import { useUpsertGovernancePolicy } from '../hooks/mutations';
import { useGovernancePolicy } from '../hooks/queries';

interface RetentionPolicyEditorProps {
  organizationId: string;
}

type RetentionScope = 'all' | 'upload' | 'agent';

function parseConfig(raw: unknown): RetentionPolicyConfig {
  const obj = isRecord(raw) ? raw : {};
  const result = retentionPolicyConfigSchema.safeParse(obj);
  if (result.success) return result.data;
  return { enabled: false, retentionDays: 90 };
}

function isRetentionScope(v: string): v is RetentionScope {
  return v === 'all' || v === 'upload' || v === 'agent';
}

export function RetentionPolicyEditor({
  organizationId,
}: RetentionPolicyEditorProps) {
  const { t } = useT('governance');
  const { toast } = useToast();
  const ability = useAbility();

  const { data: policy, isLoading } = useGovernancePolicy(
    organizationId,
    'retention_policy',
  );
  const upsertMutation = useUpsertGovernancePolicy();

  const savedConfig = useMemo(() => parseConfig(policy?.config), [policy]);

  const [enabled, setEnabled] = useState(false);
  const [retentionDays, setRetentionDays] = useState('90');
  const [scope, setScope] = useState<RetentionScope>('all');
  const [batchSize, setBatchSize] = useState('100');

  useEffect(() => {
    setEnabled(savedConfig.enabled);
    setRetentionDays(String(savedConfig.retentionDays));
    setScope(savedConfig.scope ?? 'all');
    setBatchSize(String(savedConfig.batchSize ?? 100));
  }, [savedConfig]);

  const cannotManage = ability.cannot('write', 'orgSettings');

  const scopeOptions = useMemo(
    () => [
      { value: 'all', label: t('retentionPolicy.scopeAll') },
      { value: 'upload', label: t('retentionPolicy.scopeUpload') },
      { value: 'agent', label: t('retentionPolicy.scopeAgent') },
    ],
    [t],
  );

  const handleSave = useCallback(async () => {
    const days = Number(retentionDays);
    if (Number.isNaN(days) || days < 0) return;

    const config: RetentionPolicyConfig = {
      enabled,
      retentionDays: days,
      scope,
    };

    const batch = Number(batchSize);
    if (!Number.isNaN(batch) && batch > 0) {
      config.batchSize = batch;
    }

    try {
      await upsertMutation.mutateAsync({
        organizationId,
        policyType: 'retention_policy',
        config,
      });
      toast({ title: t('retentionPolicy.saved'), variant: 'success' });
    } catch {
      toast({
        title: t('retentionPolicy.saveFailed'),
        variant: 'destructive',
      });
    }
  }, [
    organizationId,
    enabled,
    retentionDays,
    scope,
    batchSize,
    upsertMutation,
    toast,
    t,
  ]);

  const handleToggleEnabled = useCallback((checked: boolean) => {
    setEnabled(checked);
  }, []);

  if (isLoading) {
    return null;
  }

  return (
    <PageSection
      title={t('retentionPolicy.title')}
      description={t('retentionPolicy.description')}
      action={
        <Switch
          label={t('retentionPolicy.enabled')}
          checked={enabled}
          onCheckedChange={handleToggleEnabled}
          disabled={cannotManage || upsertMutation.isPending}
        />
      }
    >
      <Stack gap={6} className="max-w-2xl">
        {enabled && (
          <div
            role="alert"
            className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
          >
            {t('retentionPolicy.warning')}
          </div>
        )}

        <Stack gap={4}>
          <div>
            <Input
              label={t('retentionPolicy.retentionDays')}
              type="number"
              value={retentionDays}
              onChange={(e) => setRetentionDays(e.target.value)}
              disabled={cannotManage || !enabled}
              size="sm"
              min={1}
              step={1}
            />
            <Text variant="muted" className="mt-1 text-xs">
              {t('retentionPolicy.retentionDaysHint')}
            </Text>
          </div>

          <div>
            <Select
              label={t('retentionPolicy.scope')}
              options={scopeOptions}
              value={scope}
              onValueChange={(v) => {
                if (isRetentionScope(v)) setScope(v);
              }}
              disabled={cannotManage || !enabled}
              size="sm"
            />
          </div>

          <div>
            <Input
              label={t('retentionPolicy.batchSize')}
              type="number"
              value={batchSize}
              onChange={(e) => setBatchSize(e.target.value)}
              disabled={cannotManage || !enabled}
              size="sm"
              min={1}
              step={1}
            />
            <Text variant="muted" className="mt-1 text-xs">
              {t('retentionPolicy.batchSizeHint')}
            </Text>
          </div>
        </Stack>

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
      </Stack>
    </PageSection>
  );
}
