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
  DEFAULT_LOGIN_BACKOFF_MS,
  DEFAULT_LOGIN_MAX_ATTEMPTS,
  DEFAULT_TRUSTED_PROXIES,
  loginPolicyConfigSchema,
  type LoginPolicyConfig,
} from '@/lib/shared/schemas/governance';
import { isRecord } from '@/lib/utils/type-guards';

import { useUpsertGovernancePolicy } from '../hooks/mutations';
import { useGovernancePolicy } from '../hooks/queries';

interface LoginPolicyEditorProps {
  organizationId: string;
}

function parseConfig(raw: unknown): LoginPolicyConfig {
  const obj = isRecord(raw) ? raw : {};
  const result = loginPolicyConfigSchema.safeParse(obj);
  if (result.success) return result.data;
  return {
    enabled: true,
    maxAttemptsBeforeLockout: DEFAULT_LOGIN_MAX_ATTEMPTS,
    backoffSchedule: [...DEFAULT_LOGIN_BACKOFF_MS],
    trustedProxies: [...DEFAULT_TRUSTED_PROXIES],
  };
}

function stringToProxyList(value: string): string[] | null {
  const parts = value
    .split(/[,\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;
  if (parts.length > 32) return null;
  return parts;
}

function scheduleToString(schedule: number[]): string {
  return schedule.map((ms) => Math.round(ms / 1000)).join(', ');
}

function stringToSchedule(value: string): number[] | null {
  const parts = value
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;
  const out: number[] = [];
  for (const p of parts) {
    const n = Number(p);
    if (!Number.isFinite(n) || n < 0) return null;
    out.push(Math.round(n * 1000));
  }
  return out;
}

export function LoginPolicyEditor({ organizationId }: LoginPolicyEditorProps) {
  const { t } = useT('governance');
  const { toast } = useToast();
  const ability = useAbility();

  const { data: policy, isLoading } = useGovernancePolicy(
    organizationId,
    'login_policy',
  );
  const upsertMutation = useUpsertGovernancePolicy();

  const savedConfig = useMemo(() => parseConfig(policy?.config), [policy]);

  const initializedRef = useRef(false);
  const [enabled, setEnabled] = useState(false);
  const [maxAttempts, setMaxAttempts] = useState('');
  const [scheduleSeconds, setScheduleSeconds] = useState('');
  const [trustedProxies, setTrustedProxies] = useState('');

  if (!isLoading && !initializedRef.current) {
    initializedRef.current = true;
    setEnabled(savedConfig.enabled);
    setMaxAttempts(String(savedConfig.maxAttemptsBeforeLockout));
    setScheduleSeconds(scheduleToString(savedConfig.backoffSchedule));
    setTrustedProxies(savedConfig.trustedProxies.join(', '));
  }

  const cannotManage = ability.cannot('write', 'orgSettings');

  // Dirty flag — compare the form state to the last-saved config. The
  // textual fields are compared as normalized strings (after parsing back)
  // so "1, 10" and "1,10" don't look dirty.
  const isDirty = useMemo(() => {
    if (enabled !== savedConfig.enabled) return true;
    if (maxAttempts !== String(savedConfig.maxAttemptsBeforeLockout))
      return true;
    const parsedSchedule = stringToSchedule(scheduleSeconds);
    if (
      !parsedSchedule ||
      parsedSchedule.length !== savedConfig.backoffSchedule.length ||
      parsedSchedule.some((v, i) => v !== savedConfig.backoffSchedule[i])
    ) {
      return true;
    }
    const parsedProxies = stringToProxyList(trustedProxies);
    if (
      !parsedProxies ||
      parsedProxies.length !== savedConfig.trustedProxies.length ||
      parsedProxies.some((v, i) => v !== savedConfig.trustedProxies[i])
    ) {
      return true;
    }
    return false;
  }, [enabled, maxAttempts, scheduleSeconds, trustedProxies, savedConfig]);

  const handleSave = useCallback(async () => {
    const attempts = Number(maxAttempts);
    if (!Number.isInteger(attempts) || attempts < 1 || attempts > 50) {
      toast({
        title: t('loginPolicy.invalidAttempts'),
        variant: 'destructive',
      });
      return;
    }
    const schedule = stringToSchedule(scheduleSeconds);
    if (!schedule || schedule.length === 0) {
      toast({
        title: t('loginPolicy.invalidSchedule'),
        variant: 'destructive',
      });
      return;
    }
    const proxies = stringToProxyList(trustedProxies);
    if (!proxies) {
      toast({
        title: t('loginPolicy.invalidProxies'),
        variant: 'destructive',
      });
      return;
    }
    try {
      await upsertMutation.mutateAsync({
        organizationId,
        policyType: 'login_policy',
        config: {
          enabled,
          maxAttemptsBeforeLockout: attempts,
          backoffSchedule: schedule,
          trustedProxies: proxies,
        } satisfies LoginPolicyConfig,
      });
      toast({
        title: t('toastSavedTitle'),
        description: t('loginPolicy.saved'),
        variant: 'success',
      });
    } catch {
      toast({
        title: t('toastSaveFailedTitle'),
        description: t('loginPolicy.saveFailed'),
        variant: 'destructive',
      });
    }
  }, [
    enabled,
    maxAttempts,
    scheduleSeconds,
    trustedProxies,
    organizationId,
    upsertMutation,
    toast,
    t,
  ]);

  const handleToggleEnabled = useCallback(
    async (next: boolean) => {
      setEnabled(next);
      try {
        await upsertMutation.mutateAsync({
          organizationId,
          policyType: 'login_policy',
          config: {
            ...savedConfig,
            enabled: next,
          } satisfies LoginPolicyConfig,
        });
      } catch {
        setEnabled(!next);
        toast({
          title: t('toastSaveFailedTitle'),
          description: t('loginPolicy.saveFailed'),
          variant: 'destructive',
        });
      }
    },
    [organizationId, savedConfig, upsertMutation, toast, t],
  );

  const skeleton = (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <Skeleton className="h-3.5 w-14" />
          <Skeleton className="h-[1.15rem] w-8 rounded-full" />
        </div>
      </div>
      {enabled && (
        <div className="flex max-w-2xl flex-col gap-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex flex-col gap-1.5">
              <Skeleton className="h-3.5 w-32" />
              <Skeleton className="h-8 w-full rounded-md" />
              <Skeleton className="mt-0.5 h-3 w-64 max-w-full" />
            </div>
          ))}
        </div>
      )}
    </div>
  );

  if (isLoading || !initializedRef.current) {
    return <div aria-busy="true">{skeleton}</div>;
  }

  return (
    <PageSection
      title={t('loginPolicy.title')}
      description={t('loginPolicy.description')}
      action={
        <Switch
          label={t('loginPolicy.enabled')}
          checked={enabled}
          onCheckedChange={handleToggleEnabled}
          disabled={cannotManage || upsertMutation.isPending}
        />
      }
    >
      <Stack gap={6} className="max-w-2xl">
        {enabled && (
          <Stack gap={4}>
            <div>
              <Input
                label={t('loginPolicy.maxAttempts')}
                type="number"
                value={maxAttempts}
                onChange={(e) => setMaxAttempts(e.target.value)}
                disabled={cannotManage}
                size="sm"
                min={1}
                max={50}
                step={1}
              />
              <Text variant="muted" className="mt-1 text-xs">
                {t('loginPolicy.maxAttemptsHint')}
              </Text>
            </div>

            <div>
              <Input
                label={t('loginPolicy.backoffSchedule')}
                value={scheduleSeconds}
                onChange={(e) => setScheduleSeconds(e.target.value)}
                placeholder="1, 10, 60, 600"
                disabled={cannotManage}
                size="sm"
              />
              <Text variant="muted" className="mt-1 text-xs">
                {t('loginPolicy.backoffScheduleHint')}
              </Text>
            </div>

            <div>
              <Input
                label={t('loginPolicy.trustedProxies')}
                value={trustedProxies}
                onChange={(e) => setTrustedProxies(e.target.value)}
                placeholder="loopback, uniquelocal, 10.0.0.0/8"
                disabled={cannotManage}
                size="sm"
              />
              <Text variant="muted" className="mt-1 text-xs">
                {t('loginPolicy.trustedProxiesHint')}
              </Text>
            </div>
          </Stack>
        )}

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
      </Stack>
    </PageSection>
  );
}
