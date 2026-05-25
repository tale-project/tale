'use client';

import { HStack, Stack } from '@tale/ui/layout';
import { PageSection } from '@tale/ui/page-section';
import { Skeleton } from '@tale/ui/skeleton';
import { Text } from '@tale/ui/text';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { z } from 'zod';

import { EditorActions, useFormEditor } from '@/app/components/ui/editor';
import { Input } from '@/app/components/ui/forms/input';
import { Switch } from '@/app/components/ui/forms/switch';
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

interface LoginPolicyForm {
  maxAttempts: number;
  scheduleSeconds: string;
  trustedProxies: string;
}

const FORM_ID = 'governance-login-policy-form';

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
  const cannotManage = ability.cannot('write', 'orgSettings');

  // `enabled` is instant-save (a switch in the section header); the other
  // fields are batched through the EditorActions cluster at the bottom.
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    if (!isLoading) setEnabled(savedConfig.enabled);
  }, [isLoading, savedConfig]);

  const schema = useMemo(
    () =>
      z.object({
        maxAttempts: z
          .number()
          .int()
          .min(1, t('loginPolicy.invalidAttempts'))
          .max(50, t('loginPolicy.invalidAttempts')),
        scheduleSeconds: z
          .string()
          .refine((v) => stringToSchedule(v) !== null, {
            message: t('loginPolicy.invalidSchedule'),
          }),
        trustedProxies: z
          .string()
          .refine((v) => stringToProxyList(v) !== null, {
            message: t('loginPolicy.invalidProxies'),
          }),
      }),
    [t],
  );

  const data = useMemo<LoginPolicyForm | undefined>(() => {
    if (isLoading) return undefined;
    return {
      maxAttempts: savedConfig.maxAttemptsBeforeLockout,
      scheduleSeconds: scheduleToString(savedConfig.backoffSchedule),
      trustedProxies: savedConfig.trustedProxies.join(', '),
    };
  }, [isLoading, savedConfig]);

  const save = useCallback(
    async (values: LoginPolicyForm) => {
      const schedule = stringToSchedule(values.scheduleSeconds);
      const proxies = stringToProxyList(values.trustedProxies);
      if (!schedule || !proxies) {
        // Schema validation should have caught this; defensive guard only.
        throw new Error('VALIDATION_FAILED');
      }
      try {
        await upsertMutation.mutateAsync({
          organizationId,
          policyType: 'login_policy',
          config: {
            enabled,
            maxAttemptsBeforeLockout: values.maxAttempts,
            backoffSchedule: schedule,
            trustedProxies: proxies,
          } satisfies LoginPolicyConfig,
        });
        toast({
          title: t('toastSavedTitle'),
          description: t('loginPolicy.saved'),
          variant: 'success',
        });
      } catch (err) {
        toast({
          title: t('toastSaveFailedTitle'),
          description: t('loginPolicy.saveFailed'),
          variant: 'destructive',
        });
        throw err;
      }
    },
    [enabled, organizationId, t, toast, upsertMutation],
  );

  const editor = useFormEditor<LoginPolicyForm>({
    data,
    schema,
    save,
  });

  const {
    form: {
      register,
      handleSubmit,
      formState: { errors },
    },
  } = editor;

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
      } catch (err) {
        console.error('[loginPolicy toggle]', err);
        setEnabled(!next);
        toast({
          title: t('toastSaveFailedTitle'),
          description: t('loginPolicy.saveFailed'),
          variant: 'destructive',
        });
      }
    },
    [organizationId, savedConfig, t, toast, upsertMutation],
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

  if (isLoading) {
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
      <form id={FORM_ID} onSubmit={handleSubmit((values) => save(values))}>
        <fieldset
          disabled={cannotManage || editor.isLoading}
          className="contents"
        >
          <Stack gap={6} className="max-w-2xl">
            {enabled && (
              <Stack gap={4}>
                <div>
                  <Input
                    label={t('loginPolicy.maxAttempts')}
                    type="number"
                    size="sm"
                    min={1}
                    max={50}
                    step={1}
                    errorMessage={errors.maxAttempts?.message}
                    {...register('maxAttempts', { valueAsNumber: true })}
                  />
                  <Text variant="muted" className="mt-1 text-xs">
                    {t('loginPolicy.maxAttemptsHint')}
                  </Text>
                </div>

                <div>
                  <Input
                    label={t('loginPolicy.backoffSchedule')}
                    placeholder="1, 10, 60, 600"
                    size="sm"
                    errorMessage={errors.scheduleSeconds?.message}
                    {...register('scheduleSeconds')}
                  />
                  <Text variant="muted" className="mt-1 text-xs">
                    {t('loginPolicy.backoffScheduleHint')}
                  </Text>
                </div>

                <div>
                  <Input
                    label={t('loginPolicy.trustedProxies')}
                    placeholder="loopback, uniquelocal, 10.0.0.0/8"
                    size="sm"
                    errorMessage={errors.trustedProxies?.message}
                    {...register('trustedProxies')}
                  />
                  <Text variant="muted" className="mt-1 text-xs">
                    {t('loginPolicy.trustedProxiesHint')}
                  </Text>
                </div>
              </Stack>
            )}

            {enabled && (
              <HStack justify="end">
                <EditorActions
                  controller={editor}
                  formId={FORM_ID}
                  canEdit={!cannotManage}
                  entityKind="governance_login_policy"
                />
              </HStack>
            )}
          </Stack>
        </fieldset>
      </form>
    </PageSection>
  );
}
