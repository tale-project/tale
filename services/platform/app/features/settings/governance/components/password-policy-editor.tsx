'use client';

import { HStack, Stack } from '@tale/ui/layout';
import { PageSection } from '@tale/ui/page-section';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';
import { useCallback, useMemo } from 'react';
import { z } from 'zod';

import { EditorActions, useFormEditor } from '@/app/components/ui/editor';
import { Checkbox } from '@/app/components/ui/forms/checkbox';
import { Input } from '@/app/components/ui/forms/input';
import { Switch } from '@/app/components/ui/forms/switch';
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

interface PasswordPolicyForm {
  minLength: number;
  requireUpper: boolean;
  requireLower: boolean;
  requireDigit: boolean;
  requireSpecial: boolean;
  rotationEnabled: boolean;
  rotationDays: number;
}

const FORM_ID = 'governance-password-policy-form';

type PasswordPolicyController = ReturnType<
  typeof useFormEditor<PasswordPolicyForm>
>;

function parseConfig(raw: unknown): PasswordPolicyConfig {
  const obj = isRecord(raw) ? raw : {};
  const result = passwordPolicyConfigSchema.safeParse(obj);
  return result.success ? result.data : DEFAULT_PASSWORD_POLICY;
}

// =============================================================================
// Plain presentational view — no data/mutation hooks of its own. Renders the
// real layout from the injected form `controller`. Rendered both live (by the
// container) and as its own skeleton (the container wraps it in
// `<Skeletonize>`), so the loading and loaded layouts are the SAME tree and
// cannot drift. The skeleton-aware `<Input>`/`<Checkbox>`/`<Switch>` mask
// themselves to their exact size while loading. The `rotationDays` input
// renders once `rotationEnabled` is true (matching the loaded behavior, since
// the form value is `undefined`/`false` while loading).
// =============================================================================
export function PasswordPolicyEditorView({
  controller,
  onSave,
  canEdit,
}: {
  controller: PasswordPolicyController;
  onSave: (values: PasswordPolicyForm) => Promise<void>;
  canEdit: boolean;
}) {
  const { t } = useT('governance');
  const {
    form: {
      register,
      handleSubmit,
      watch,
      setValue,
      formState: { errors },
    },
  } = controller;

  const rotationEnabled = watch('rotationEnabled') ?? false;

  return (
    <PageSection
      title={t('passwordPolicy.title')}
      description={t('passwordPolicy.description')}
    >
      <form id={FORM_ID} onSubmit={handleSubmit(onSave)}>
        <fieldset
          disabled={!canEdit || controller.isLoading}
          className="contents"
        >
          <Stack gap={6} className="max-w-2xl">
            <Stack gap={4}>
              <div>
                <Input
                  label={t('passwordPolicy.minLength')}
                  type="number"
                  size="sm"
                  min={6}
                  max={128}
                  step={1}
                  errorMessage={errors.minLength?.message}
                  {...register('minLength', { valueAsNumber: true })}
                />
                <Text variant="muted" className="mt-1 text-xs">
                  {t('passwordPolicy.minLengthHint')}
                </Text>
              </div>

              <Checkbox
                label={t('passwordPolicy.requireUpper')}
                checked={watch('requireUpper') ?? false}
                onCheckedChange={(v) =>
                  setValue('requireUpper', Boolean(v), { shouldDirty: true })
                }
                disabled={!canEdit}
              />
              <Checkbox
                label={t('passwordPolicy.requireLower')}
                checked={watch('requireLower') ?? false}
                onCheckedChange={(v) =>
                  setValue('requireLower', Boolean(v), { shouldDirty: true })
                }
                disabled={!canEdit}
              />
              <Checkbox
                label={t('passwordPolicy.requireDigit')}
                checked={watch('requireDigit') ?? false}
                onCheckedChange={(v) =>
                  setValue('requireDigit', Boolean(v), { shouldDirty: true })
                }
                disabled={!canEdit}
              />
              <Checkbox
                label={t('passwordPolicy.requireSpecial')}
                checked={watch('requireSpecial') ?? false}
                onCheckedChange={(v) =>
                  setValue('requireSpecial', Boolean(v), { shouldDirty: true })
                }
                disabled={!canEdit}
              />

              <Switch
                label={t('passwordPolicy.rotationEnabled')}
                checked={rotationEnabled}
                onCheckedChange={(v) =>
                  setValue('rotationEnabled', v, { shouldDirty: true })
                }
                disabled={!canEdit || controller.isSaving}
              />
              {rotationEnabled && (
                <div>
                  <Input
                    label={t('passwordPolicy.rotationDays')}
                    type="number"
                    size="sm"
                    min={1}
                    max={3650}
                    step={1}
                    errorMessage={errors.rotationDays?.message}
                    {...register('rotationDays', { valueAsNumber: true })}
                  />
                  <Text variant="muted" className="mt-1 text-xs">
                    {t('passwordPolicy.rotationDaysHint')}
                  </Text>
                </div>
              )}
            </Stack>

            <HStack justify="end">
              <EditorActions
                controller={controller}
                formId={FORM_ID}
                canEdit={canEdit}
                entityKind="governance_password_policy"
              />
            </HStack>
          </Stack>
        </fieldset>
      </form>
    </PageSection>
  );
}

// =============================================================================
// Container — owns data fetching, the form controller, save/toast wiring, and
// the loading state. Wraps the plain view in `<Skeletonize>` so the same tree
// renders the skeleton while `isLoading`.
// =============================================================================
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

  const schema = useMemo(
    () =>
      z.object({
        minLength: z
          .number()
          .int()
          .min(6, t('passwordPolicy.invalidMinLength'))
          .max(128, t('passwordPolicy.invalidMinLength')),
        requireUpper: z.boolean(),
        requireLower: z.boolean(),
        requireDigit: z.boolean(),
        requireSpecial: z.boolean(),
        rotationEnabled: z.boolean(),
        rotationDays: z
          .number()
          .int()
          .min(1, t('passwordPolicy.invalidRotationDays'))
          .max(3650, t('passwordPolicy.invalidRotationDays')),
      }),
    [t],
  );

  const data = useMemo<PasswordPolicyForm | undefined>(() => {
    if (isLoading) return undefined;
    const saved = parseConfig(policy?.config);
    return {
      minLength: saved.minLength,
      requireUpper: saved.requireUpper,
      requireLower: saved.requireLower,
      requireDigit: saved.requireDigit,
      requireSpecial: saved.requireSpecial,
      rotationEnabled: saved.rotationDays > 0,
      rotationDays: saved.rotationDays > 0 ? saved.rotationDays : 90,
    };
  }, [isLoading, policy]);

  const save = useCallback(
    async (values: PasswordPolicyForm) => {
      try {
        await upsertMutation.mutateAsync({
          organizationId,
          policyType: 'password_policy',
          config: {
            minLength: values.minLength,
            requireUpper: values.requireUpper,
            requireLower: values.requireLower,
            requireDigit: values.requireDigit,
            requireSpecial: values.requireSpecial,
            rotationDays: values.rotationEnabled ? values.rotationDays : 0,
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
        throw e;
      }
    },
    [organizationId, t, toast, upsertMutation],
  );

  const editor = useFormEditor<PasswordPolicyForm>({
    data,
    schema,
    save,
  });

  const cannotManage = ability.cannot('write', 'orgSettings');

  return (
    <Skeletonize loading={isLoading} label={t('passwordPolicy.title')}>
      <PasswordPolicyEditorView
        controller={editor}
        onSave={save}
        canEdit={!cannotManage}
      />
    </Skeletonize>
  );
}
