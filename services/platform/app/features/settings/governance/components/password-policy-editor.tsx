'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { Skeleton } from '@/app/components/ui/feedback/skeleton';
import { Checkbox } from '@/app/components/ui/forms/checkbox';
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
  DEFAULT_PASSWORD_POLICY,
  type PasswordPolicyConfig,
  passwordPolicyConfigSchema,
} from '@/lib/shared/schemas/governance';
import { cn } from '@/lib/utils/cn';
import { isRecord } from '@/lib/utils/type-guards';

import { useUpsertGovernancePolicy } from '../hooks/mutations';
import { useGovernancePolicy } from '../hooks/queries';

interface PasswordPolicyEditorProps {
  organizationId: string;
}

function parseConfig(raw: unknown): PasswordPolicyConfig {
  const obj = isRecord(raw) ? raw : {};
  const result = passwordPolicyConfigSchema.safeParse(obj);
  return result.success ? result.data : DEFAULT_PASSWORD_POLICY;
}

export function PasswordPolicyEditor({
  organizationId,
}: PasswordPolicyEditorProps) {
  const { t } = useT('governance');
  const { toast } = useToast();
  const ability = useAbility();

  const { data: policy, isLoading } = useGovernancePolicy(
    organizationId,
    'password_policy',
  );
  const upsertMutation = useUpsertGovernancePolicy();

  const savedConfig = useMemo(() => parseConfig(policy?.config), [policy]);

  const [minLength, setMinLength] = useState(
    String(DEFAULT_PASSWORD_POLICY.minLength),
  );
  const [requireUpper, setRequireUpper] = useState(
    DEFAULT_PASSWORD_POLICY.requireUpper,
  );
  const [requireLower, setRequireLower] = useState(
    DEFAULT_PASSWORD_POLICY.requireLower,
  );
  const [requireDigit, setRequireDigit] = useState(
    DEFAULT_PASSWORD_POLICY.requireDigit,
  );
  const [requireSpecial, setRequireSpecial] = useState(
    DEFAULT_PASSWORD_POLICY.requireSpecial,
  );
  const [rotationEnabled, setRotationEnabled] = useState(false);
  const [rotationDays, setRotationDays] = useState('90');

  useEffect(() => {
    setMinLength(String(savedConfig.minLength));
    setRequireUpper(savedConfig.requireUpper);
    setRequireLower(savedConfig.requireLower);
    setRequireDigit(savedConfig.requireDigit);
    setRequireSpecial(savedConfig.requireSpecial);
    setRotationEnabled(savedConfig.rotationDays > 0);
    setRotationDays(
      savedConfig.rotationDays > 0 ? String(savedConfig.rotationDays) : '90',
    );
  }, [savedConfig]);

  const cannotManage = ability.cannot('write', 'orgSettings');

  const currentRotationDays = rotationEnabled ? Number(rotationDays) : 0;

  const isDirty = useMemo(() => {
    if (Number(minLength) !== savedConfig.minLength) return true;
    if (requireUpper !== savedConfig.requireUpper) return true;
    if (requireLower !== savedConfig.requireLower) return true;
    if (requireDigit !== savedConfig.requireDigit) return true;
    if (requireSpecial !== savedConfig.requireSpecial) return true;
    if (currentRotationDays !== savedConfig.rotationDays) return true;
    return false;
  }, [
    minLength,
    requireUpper,
    requireLower,
    requireDigit,
    requireSpecial,
    currentRotationDays,
    savedConfig,
  ]);

  const handleSave = useCallback(async () => {
    const len = Number(minLength);
    if (!Number.isInteger(len) || len < 6 || len > 128) {
      toast({
        title: t('passwordPolicy.invalidMinLength'),
        variant: 'destructive',
      });
      return;
    }
    if (rotationEnabled) {
      const days = Number(rotationDays);
      if (!Number.isInteger(days) || days < 1 || days > 3650) {
        toast({
          title: t('passwordPolicy.invalidRotationDays'),
          variant: 'destructive',
        });
        return;
      }
    }
    try {
      await upsertMutation.mutateAsync({
        organizationId,
        policyType: 'password_policy',
        config: {
          minLength: len,
          requireUpper,
          requireLower,
          requireDigit,
          requireSpecial,
          rotationDays: rotationEnabled ? Number(rotationDays) : 0,
        } satisfies PasswordPolicyConfig,
      });
      toast({ title: t('passwordPolicy.saved'), variant: 'success' });
    } catch (e) {
      console.error(e);
      toast({
        title: t('passwordPolicy.saveFailed'),
        variant: 'destructive',
      });
    }
  }, [
    minLength,
    requireUpper,
    requireLower,
    requireDigit,
    requireSpecial,
    rotationEnabled,
    rotationDays,
    organizationId,
    upsertMutation,
    toast,
    t,
  ]);

  if (isLoading) {
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
      title={t('passwordPolicy.title')}
      description={t('passwordPolicy.description')}
    >
      <Stack gap={6} className="max-w-2xl">
        <Stack gap={4}>
          <Input
            label={t('passwordPolicy.minLength')}
            type="number"
            value={minLength}
            onChange={(e) => setMinLength(e.target.value)}
            disabled={cannotManage}
            size="sm"
            min={6}
            max={128}
            step={1}
          />
          <Text variant="muted" className="text-xs">
            {t('passwordPolicy.minLengthHint')}
          </Text>

          <Checkbox
            label={t('passwordPolicy.requireUpper')}
            checked={requireUpper}
            onCheckedChange={(v) => setRequireUpper(Boolean(v))}
            disabled={cannotManage}
          />
          <Checkbox
            label={t('passwordPolicy.requireLower')}
            checked={requireLower}
            onCheckedChange={(v) => setRequireLower(Boolean(v))}
            disabled={cannotManage}
          />
          <Checkbox
            label={t('passwordPolicy.requireDigit')}
            checked={requireDigit}
            onCheckedChange={(v) => setRequireDigit(Boolean(v))}
            disabled={cannotManage}
          />
          <Checkbox
            label={t('passwordPolicy.requireSpecial')}
            checked={requireSpecial}
            onCheckedChange={(v) => setRequireSpecial(Boolean(v))}
            disabled={cannotManage}
          />

          <Switch
            label={t('passwordPolicy.rotationEnabled')}
            checked={rotationEnabled}
            onCheckedChange={setRotationEnabled}
            disabled={cannotManage || upsertMutation.isPending}
          />
          <div
            className={cn(
              'transition-opacity duration-200',
              !rotationEnabled && 'pointer-events-none opacity-50',
            )}
          >
            <Input
              label={t('passwordPolicy.rotationDays')}
              type="number"
              value={rotationDays}
              onChange={(e) => setRotationDays(e.target.value)}
              disabled={cannotManage || !rotationEnabled}
              size="sm"
              min={1}
              max={3650}
              step={1}
            />
            <Text variant="muted" className="text-xs">
              {t('passwordPolicy.rotationDaysHint')}
            </Text>
          </div>
        </Stack>

        <Button
          onClick={handleSave}
          disabled={cannotManage || upsertMutation.isPending || !isDirty}
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
