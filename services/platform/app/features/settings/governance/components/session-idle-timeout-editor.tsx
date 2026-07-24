'use client';

import { Skeletonize } from '@tale/ui/skeleton-context';
import { useCallback, useMemo } from 'react';
import { z } from 'zod';

import {
  useFormEditor,
  useRegisterGroupedEditor,
} from '@/app/components/ui/editor';
import { Input } from '@/app/components/ui/forms/input';
import { Switch } from '@/app/components/ui/forms/switch';
import {
  SettingsFieldList,
  SettingsFieldRow,
} from '@/app/features/settings/components/settings-field-list';
import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { useAbility } from '@/app/hooks/use-ability';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import {
  DEFAULT_SESSION_IDLE_TIMEOUT,
  type SessionIdleTimeoutConfig,
  sessionIdleTimeoutConfigSchema,
} from '@/lib/shared/schemas/governance';
import {
  SESSION_IDLE_TIMEOUT_MAX_MINUTES,
  SESSION_IDLE_TIMEOUT_MIN_MINUTES,
} from '@/lib/shared/session-idle';

import { createConfigParser } from '../config-parser';
import { useUpsertGovernancePolicy } from '../hooks/mutations';
import { useGovernancePolicy } from '../hooks/queries';
import { useGovernancePolicyToggle } from '../hooks/use-governance-policy-toggle';

interface SessionIdleTimeoutEditorProps {
  organizationId: string;
}

interface SessionIdleTimeoutForm {
  idleTimeoutMinutes: number;
}

const FORM_ID = 'governance-session-idle-timeout-form';

const parseConfig = createConfigParser(sessionIdleTimeoutConfigSchema, () => ({
  ...DEFAULT_SESSION_IDLE_TIMEOUT,
}));

// =============================================================================
// Mirrors `LoginPolicyEditor`: owns data fetching, the form controller, the
// instant-save `enabled` toggle, and the loading state. Renders the REAL
// layout once inside `<Skeletonize>`; the skeleton-aware `<Switch>`/`<Input>`
// mask themselves while loading. The batched minutes field renders once
// `enabled` is true (matching the loaded behaviour — `enabled` defaults to
// `false` while loading).
// =============================================================================
export function SessionIdleTimeoutEditor({
  organizationId,
}: SessionIdleTimeoutEditorProps) {
  const { t } = useT('governance');
  const { toast } = useToast();
  const ability = useAbility();

  const { data: policy, isLoading } = useGovernancePolicy(
    organizationId,
    'session_idle_timeout',
  );
  const upsertMutation = useUpsertGovernancePolicy();

  const savedConfig = useMemo(() => parseConfig(policy?.config), [policy]);
  const cannotManage = ability.cannot('write', 'orgSettings');

  // `enabled` is instant-save (header switch); `idleTimeoutMinutes` is batched
  // through the settings header's global Save/Discard cluster.
  const { enabled, isToggling, onToggle } = useGovernancePolicyToggle({
    organizationId,
    policyType: 'session_idle_timeout',
    savedEnabled: savedConfig.enabled,
    isLoading,
    buildConfig: (next): SessionIdleTimeoutConfig => ({
      ...savedConfig,
      enabled: next,
    }),
    failureTitle: t('toastSaveFailedTitle'),
    failureDescription: t('sessionIdleTimeout.saveFailed'),
  });

  const schema = useMemo(
    () =>
      z.object({
        idleTimeoutMinutes: z
          .number()
          .int()
          .min(
            SESSION_IDLE_TIMEOUT_MIN_MINUTES,
            t('sessionIdleTimeout.invalid'),
          )
          .max(
            SESSION_IDLE_TIMEOUT_MAX_MINUTES,
            t('sessionIdleTimeout.invalid'),
          ),
      }),
    [t],
  );

  const data = useMemo<SessionIdleTimeoutForm | undefined>(() => {
    if (isLoading) return undefined;
    return { idleTimeoutMinutes: savedConfig.idleTimeoutMinutes };
  }, [isLoading, savedConfig]);

  const save = useCallback(
    async (values: SessionIdleTimeoutForm) => {
      try {
        await upsertMutation.mutateAsync({
          organizationId,
          policyType: 'session_idle_timeout',
          config: {
            enabled,
            idleTimeoutMinutes: values.idleTimeoutMinutes,
          } satisfies SessionIdleTimeoutConfig,
        });
        toast({
          title: t('toastSavedTitle'),
          description: t('sessionIdleTimeout.saved'),
          variant: 'success',
        });
      } catch (err) {
        toast({
          title: t('toastSaveFailedTitle'),
          description: t('sessionIdleTimeout.saveFailed'),
          variant: 'destructive',
        });
        throw err;
      }
    },
    [enabled, organizationId, t, toast, upsertMutation],
  );

  const editor = useFormEditor<SessionIdleTimeoutForm>({
    data,
    schema,
    save,
  });
  const canEdit = !cannotManage;
  // Read-only viewers and disabled policies stay unregistered so the global
  // cluster never renders for a section they cannot edit.
  useRegisterGroupedEditor(editor, { enabled: canEdit && enabled });

  const {
    register,
    formState: { errors },
  } = editor.form;

  return (
    <Skeletonize loading={isLoading} label={t('sessionIdleTimeout.title')}>
      <SettingsSection
        title={t('sessionIdleTimeout.title')}
        description={t('sessionIdleTimeout.description')}
        action={
          <Switch
            aria-label={t('sessionIdleTimeout.enabled')}
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
            {/* Same structure as the Organization details section: one divided
                list of rows, each with its label + hint on the left and its
                control pinned right. The row exists only while the policy is
                enabled — the section toggle hides its content. */}
            {enabled && (
              <SettingsFieldList>
                <SettingsFieldRow
                  label={t('sessionIdleTimeout.minutes')}
                  description={t('sessionIdleTimeout.minutesHint')}
                >
                  <Input
                    aria-label={t('sessionIdleTimeout.minutes')}
                    type="number"
                    min={SESSION_IDLE_TIMEOUT_MIN_MINUTES}
                    max={SESSION_IDLE_TIMEOUT_MAX_MINUTES}
                    step={1}
                    wrapperClassName="w-full"
                    errorMessage={errors.idleTimeoutMinutes?.message}
                    {...register('idleTimeoutMinutes', { valueAsNumber: true })}
                  />
                </SettingsFieldRow>
              </SettingsFieldList>
            )}
          </fieldset>
        </form>
      </SettingsSection>
    </Skeletonize>
  );
}
