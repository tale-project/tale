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
import { Checkbox } from '@/app/components/ui/forms/checkbox';
import { Input } from '@/app/components/ui/forms/input';
import { Switch } from '@/app/components/ui/forms/switch';
import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { useAbility } from '@/app/hooks/use-ability';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import {
  DEFAULT_PASSWORD_POLICY,
  type PasswordPolicyConfig,
  passwordPolicyConfigSchema,
} from '@/lib/shared/schemas/governance';

import { createConfigParser } from '../config-parser';
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

const parseConfig = createConfigParser(
  passwordPolicyConfigSchema,
  () => DEFAULT_PASSWORD_POLICY,
);

// =============================================================================
// Single editor — owns data fetching, the form controller, save/toast wiring,
// and the loading state. Renders the REAL layout once, always, wrapped in
// `<Skeletonize>`. The skeleton-aware `<Input>`/`<Checkbox>`/`<Switch>` mask
// themselves to their exact size while loading. The `rotationDays` input
// renders once `rotationEnabled` is true (matching the loaded behavior, since
// the form value is `undefined`/`false` while loading).
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
  const canEdit = !cannotManage;
  // Saving runs through the settings header's global Save/Discard cluster;
  // read-only viewers stay unregistered so the cluster never renders for a
  // section they cannot edit.
  useRegisterGroupedEditor(editor, { enabled: canEdit });

  const {
    register,
    watch,
    setValue,
    formState: { errors },
  } = editor.form;

  const rotationEnabled = watch('rotationEnabled') ?? false;

  // Toggles apply immediately — no Save click. Set the value, then persist the
  // whole (validated) form through the editor so the saved values become the
  // new baseline and `isDirty` clears. The numeric inputs keep the Save button
  // for debounced typing; if a number is mid-edit and invalid the save no-ops
  // on validation and the toggle stays pending until the user fixes it + saves.
  const persistToggle = useCallback(
    (field: keyof PasswordPolicyForm, value: boolean) => {
      setValue(field, value, { shouldDirty: true, shouldValidate: true });
      // Fire-and-forget: `save()` already toasts real failures, and a
      // validation failure (e.g. a numeric input mid-edit) surfaces inline on
      // that field. Catch so the discarded promise never rejects unhandled.
      editor.save().catch((err) => {
        if (!(err instanceof Error && err.message === 'VALIDATION_FAILED')) {
          console.error('[passwordPolicy] toggle save failed', err);
        }
      });
    },
    [editor, setValue],
  );

  return (
    <Skeletonize loading={isLoading} label={t('passwordPolicy.title')}>
      <SettingsSection
        title={t('passwordPolicy.title')}
        description={t('passwordPolicy.description')}
      >
        <form id={FORM_ID} onSubmit={editor.submit}>
          <fieldset
            disabled={!canEdit || editor.isLoading}
            className="contents"
          >
            {/* Short numeric fields stay max-w-xs so they don't stretch. */}
            <Stack gap={6}>
              <Stack gap={4}>
                <div>
                  <Input
                    label={t('passwordPolicy.minLength')}
                    type="number"
                    min={6}
                    max={128}
                    step={1}
                    wrapperClassName="max-w-xs"
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
                    persistToggle('requireUpper', Boolean(v))
                  }
                  disabled={!canEdit || editor.isSaving}
                />
                <Checkbox
                  label={t('passwordPolicy.requireLower')}
                  checked={watch('requireLower') ?? false}
                  onCheckedChange={(v) =>
                    persistToggle('requireLower', Boolean(v))
                  }
                  disabled={!canEdit || editor.isSaving}
                />
                <Checkbox
                  label={t('passwordPolicy.requireDigit')}
                  checked={watch('requireDigit') ?? false}
                  onCheckedChange={(v) =>
                    persistToggle('requireDigit', Boolean(v))
                  }
                  disabled={!canEdit || editor.isSaving}
                />
                <Checkbox
                  label={t('passwordPolicy.requireSpecial')}
                  checked={watch('requireSpecial') ?? false}
                  onCheckedChange={(v) =>
                    persistToggle('requireSpecial', Boolean(v))
                  }
                  disabled={!canEdit || editor.isSaving}
                />

                <Switch
                  label={t('passwordPolicy.rotationEnabled')}
                  checked={rotationEnabled}
                  onCheckedChange={(v) => persistToggle('rotationEnabled', v)}
                  disabled={!canEdit || editor.isSaving}
                />
                {rotationEnabled && (
                  <div>
                    <Input
                      label={t('passwordPolicy.rotationDays')}
                      type="number"
                      min={1}
                      max={3650}
                      step={1}
                      wrapperClassName="max-w-xs"
                      errorMessage={errors.rotationDays?.message}
                      {...register('rotationDays', { valueAsNumber: true })}
                    />
                    <Text variant="muted" className="mt-1 text-xs">
                      {t('passwordPolicy.rotationDaysHint')}
                    </Text>
                  </div>
                )}
              </Stack>
            </Stack>
          </fieldset>
        </form>
      </SettingsSection>
    </Skeletonize>
  );
}
