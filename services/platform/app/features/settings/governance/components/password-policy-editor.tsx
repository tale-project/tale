'use client';

import { useCallback, useMemo, useRef, useState } from 'react';

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

  const initializedRef = useRef(false);
  const [minLength, setMinLength] = useState('');
  const [requireUpper, setRequireUpper] = useState(false);
  const [requireLower, setRequireLower] = useState(false);
  const [requireDigit, setRequireDigit] = useState(false);
  const [requireSpecial, setRequireSpecial] = useState(false);
  const [rotationEnabled, setRotationEnabled] = useState(false);
  const [rotationDays, setRotationDays] = useState('90');

  if (!isLoading && !initializedRef.current) {
    initializedRef.current = true;
    setMinLength(String(savedConfig.minLength));
    setRequireUpper(savedConfig.requireUpper);
    setRequireLower(savedConfig.requireLower);
    setRequireDigit(savedConfig.requireDigit);
    setRequireSpecial(savedConfig.requireSpecial);
    setRotationEnabled(savedConfig.rotationDays > 0);
    setRotationDays(
      savedConfig.rotationDays > 0 ? String(savedConfig.rotationDays) : '90',
    );
  }

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
      toast({
        title: t('toastSavedTitle'),
        description: t('passwordPolicy.saved'),
        variant: 'success',
      });
    } catch (e) {
      console.error(e);
      toast({
        title: t('toastSaveFailedTitle'),
        description: t('passwordPolicy.saveFailed'),
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

  const skeleton = (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="flex max-w-2xl flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-3.5 w-32" />
          <Skeleton className="h-8 w-full rounded-md" />
          <Skeleton className="mt-0.5 h-3 w-56 max-w-full" />
        </div>

        <div className="flex flex-col gap-5">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="size-4 rounded-sm" />
              <Skeleton className="h-3.5 w-48" />
            </div>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <Skeleton className="h-3.5 w-40" />
          <Skeleton className="h-[1.15rem] w-8 rounded-full" />
        </div>
        {rotationEnabled && (
          <div className="flex flex-col gap-1.5">
            <Skeleton className="h-3.5 w-32" />
            <Skeleton className="h-8 w-full rounded-md" />
            <Skeleton className="mt-0.5 h-3 w-56 max-w-full" />
          </div>
        )}
        <Skeleton className="h-8 w-20 rounded-md" />
      </div>
    </div>
  );

  if (isLoading || !initializedRef.current) {
    return <div aria-busy="true">{skeleton}</div>;
  }

  return (
    <PageSection
      title={t('passwordPolicy.title')}
      description={t('passwordPolicy.description')}
    >
      <Stack gap={6} className="max-w-2xl">
        <Stack gap={4}>
          <div>
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
            <Text variant="muted" className="mt-1 text-xs">
              {t('passwordPolicy.minLengthHint')}
            </Text>
          </div>

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
          {rotationEnabled && (
            <div>
              <Input
                label={t('passwordPolicy.rotationDays')}
                type="number"
                value={rotationDays}
                onChange={(e) => setRotationDays(e.target.value)}
                disabled={cannotManage}
                size="sm"
                min={1}
                max={3650}
                step={1}
              />
              <Text variant="muted" className="mt-1 text-xs">
                {t('passwordPolicy.rotationDaysHint')}
              </Text>
            </div>
          )}
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
