'use client';

import { HStack, Stack } from '@tale/ui/layout';
import { PageSection } from '@tale/ui/page-section';
import { Skeletonize } from '@tale/ui/skeleton-context';
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
  DEFAULT_SESSION_IDLE_TIMEOUT,
  type SessionIdleTimeoutConfig,
  sessionIdleTimeoutConfigSchema,
} from '@/lib/shared/schemas/governance';
import {
  SESSION_IDLE_TIMEOUT_MAX_MINUTES,
  SESSION_IDLE_TIMEOUT_MIN_MINUTES,
} from '@/lib/shared/session-idle';
import { isRecord } from '@/lib/utils/type-guards';

import { useUpsertGovernancePolicy } from '../hooks/mutations';
import { useGovernancePolicy } from '../hooks/queries';

interface SessionIdleTimeoutEditorProps {
  organizationId: string;
}

interface SessionIdleTimeoutForm {
  idleTimeoutMinutes: number;
}

const FORM_ID = 'governance-session-idle-timeout-form';

function parseConfig(raw: unknown): SessionIdleTimeoutConfig {
  const obj = isRecord(raw) ? raw : {};
  const result = sessionIdleTimeoutConfigSchema.safeParse(obj);
  return result.success ? result.data : { ...DEFAULT_SESSION_IDLE_TIMEOUT };
}

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
  // through the EditorActions cluster.
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    if (!isLoading) setEnabled(savedConfig.enabled);
  }, [isLoading, savedConfig]);

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

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = editor.form;
  const canEdit = !cannotManage;
  const isToggling = upsertMutation.isPending;

  const handleToggleEnabled = useCallback(
    async (next: boolean) => {
      setEnabled(next);
      try {
        await upsertMutation.mutateAsync({
          organizationId,
          policyType: 'session_idle_timeout',
          config: {
            ...savedConfig,
            enabled: next,
          } satisfies SessionIdleTimeoutConfig,
        });
      } catch (err) {
        console.error('[sessionIdleTimeout toggle]', err);
        setEnabled(!next);
        toast({
          title: t('toastSaveFailedTitle'),
          description: t('sessionIdleTimeout.saveFailed'),
          variant: 'destructive',
        });
      }
    },
    [organizationId, savedConfig, t, toast, upsertMutation],
  );

  return (
    <Skeletonize loading={isLoading} label={t('sessionIdleTimeout.title')}>
      <PageSection
        title={t('sessionIdleTimeout.title')}
        description={t('sessionIdleTimeout.description')}
        action={
          <Switch
            label={t('sessionIdleTimeout.enabled')}
            checked={enabled}
            onCheckedChange={handleToggleEnabled}
            disabled={!canEdit || isToggling}
          />
        }
      >
        <form id={FORM_ID} onSubmit={handleSubmit(save)}>
          <fieldset
            disabled={!canEdit || editor.isLoading}
            className="contents"
          >
            <Stack gap={6} className="max-w-2xl">
              {enabled && (
                <div>
                  <Input
                    label={t('sessionIdleTimeout.minutes')}
                    type="number"
                    size="sm"
                    min={SESSION_IDLE_TIMEOUT_MIN_MINUTES}
                    max={SESSION_IDLE_TIMEOUT_MAX_MINUTES}
                    step={1}
                    errorMessage={errors.idleTimeoutMinutes?.message}
                    {...register('idleTimeoutMinutes', { valueAsNumber: true })}
                  />
                  <Text variant="muted" className="mt-1 text-xs">
                    {t('sessionIdleTimeout.minutesHint')}
                  </Text>
                </div>
              )}

              {enabled && (
                <HStack justify="end">
                  <EditorActions
                    controller={editor}
                    formId={FORM_ID}
                    canEdit={canEdit}
                    entityKind="governance_session_idle_timeout"
                  />
                </HStack>
              )}
            </Stack>
          </fieldset>
        </form>
      </PageSection>
    </Skeletonize>
  );
}
