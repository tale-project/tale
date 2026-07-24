'use client';

import { Stack } from '@tale/ui/layout';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';
import { useCallback, useMemo } from 'react';
import { z } from 'zod';

import {
  useFormEditor,
  useRegisterGroupedEditor,
} from '@/app/components/ui/editor';
import { Input } from '@/app/components/ui/forms/input';
import { Switch } from '@/app/components/ui/forms/switch';
import { SettingsSection } from '@/app/features/settings/components/settings-section';
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

import { createConfigParser } from '../config-parser';
import { useUpsertGovernancePolicy } from '../hooks/mutations';
import { useGovernancePolicy } from '../hooks/queries';
import { useGovernancePolicyToggle } from '../hooks/use-governance-policy-toggle';

interface LoginPolicyEditorProps {
  organizationId: string;
}

interface LoginPolicyForm {
  maxAttempts: number;
  scheduleSeconds: string;
  trustedProxies: string;
}

const FORM_ID = 'governance-login-policy-form';

const parseConfig = createConfigParser(loginPolicyConfigSchema, () => ({
  enabled: true,
  maxAttemptsBeforeLockout: DEFAULT_LOGIN_MAX_ATTEMPTS,
  backoffSchedule: [...DEFAULT_LOGIN_BACKOFF_MS],
  trustedProxies: [...DEFAULT_TRUSTED_PROXIES],
}));

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

// =============================================================================
// Single editor — owns data fetching, the form controller, the instant-save
// `enabled` toggle, and the loading state. Renders the REAL layout once,
// always, wrapped in `<Skeletonize>`. The skeleton-aware `<Switch>`/`<Input>`
// mask themselves to their exact track/field height while loading. The header
// `enabled` switch always renders so its mask is visible even before data
// arrives; the batched fields render once `enabled` is true (matching the
// loaded behavior, since `enabled` defaults to `false` while loading).
// =============================================================================
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
  const { enabled, isToggling, onToggle } = useGovernancePolicyToggle({
    organizationId,
    policyType: 'login_policy',
    savedEnabled: savedConfig.enabled,
    isLoading,
    buildConfig: (next): LoginPolicyConfig => ({
      ...savedConfig,
      enabled: next,
    }),
    failureTitle: t('toastSaveFailedTitle'),
    failureDescription: t('loginPolicy.saveFailed'),
  });

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
            // Spread the saved config first (#2670) — `perIpLimit` has no
            // form field, so without this the batched save silently wiped it
            // every time, while the `enabled` toggle path (above) already
            // preserved it via the same spread. Explicit fields below still
            // win for what the form actually edits.
            ...savedConfig,
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
    [enabled, organizationId, savedConfig, t, toast, upsertMutation],
  );

  const editor = useFormEditor<LoginPolicyForm>({
    data,
    schema,
    save,
  });
  const canEdit = !cannotManage;
  // Saving runs through the settings header's global Save/Discard cluster;
  // read-only viewers and disabled policies stay unregistered so the cluster
  // never renders for a section they cannot edit.
  useRegisterGroupedEditor(editor, { enabled: canEdit && enabled });

  const {
    register,
    formState: { errors },
  } = editor.form;

  return (
    <Skeletonize loading={isLoading} label={t('loginPolicy.title')}>
      <SettingsSection
        title={t('loginPolicy.title')}
        description={t('loginPolicy.description')}
        action={
          <Switch
            aria-label={t('loginPolicy.enabled')}
            checked={enabled}
            onCheckedChange={onToggle}
            disabled={!canEdit || isToggling || editor.isSaving}
          />
        }
      >
        <form id={FORM_ID} onSubmit={editor.submit}>
          <fieldset
            disabled={!canEdit || editor.isLoading}
            className="contents"
          >
            <Stack gap={6}>
              {enabled && (
                <Stack gap={4}>
                  <div>
                    <Input
                      label={t('loginPolicy.maxAttempts')}
                      type="number"
                      min={1}
                      max={50}
                      step={1}
                      wrapperClassName="max-w-xs"
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
                      errorMessage={errors.trustedProxies?.message}
                      {...register('trustedProxies')}
                    />
                    <Text variant="muted" className="mt-1 text-xs">
                      {t('loginPolicy.trustedProxiesHint')}
                    </Text>
                  </div>
                </Stack>
              )}
            </Stack>
          </fieldset>
        </form>
      </SettingsSection>
    </Skeletonize>
  );
}
