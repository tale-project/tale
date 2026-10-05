'use client';

import {
  DEFAULT_PASSWORD_POLICY,
  type PasswordPolicyConfig,
  passwordPolicyConfigSchema,
} from '@tale/shared/schemas/governance';
import { useFormEditor, useRegisterGroupedEditor } from '@tale/ui/editor';
import { Input } from '@tale/ui/input';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { useToast } from '@tale/ui/use-toast';
import { useCallback, useMemo } from 'react';
import { z } from 'zod';

import {
  SettingsFieldList,
  SettingsFieldRow,
} from '@/app/features/settings/components/settings-field-list';
import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { SettingsToggleRow } from '@/app/features/settings/components/settings-toggle-row';
import { useAbility } from '@/app/hooks/use-ability';
import { useT } from '@/lib/i18n/client';

import { createConfigParser } from '../config-parser';
import { useUpsertGovernancePolicy } from '../hooks/mutations';
import { useGovernancePolicy } from '../hooks/queries';
import { withGovernancePolicyReadBoundary } from './policy-read-boundary';

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

/** The character classes a new password may be required to contain. */
const CHARACTER_RULES = [
  'requireUpper',
  'requireLower',
  'requireDigit',
  'requireSpecial',
] as const;

const parseConfig = createConfigParser(
  passwordPolicyConfigSchema,
  () => DEFAULT_PASSWORD_POLICY,
);

// =============================================================================
// Single editor — owns data fetching, the form controller, the save wiring,
// and the loading state. Renders the REAL layout once, always, wrapped in
// `<Skeletonize>`. The skeleton-aware `<Input>`/`<Switch>` mask
// themselves to their exact size while loading. The `rotationDays` input
// renders once `rotationEnabled` is true (matching the loaded behavior, since
// the form value is `undefined`/`false` while loading).
// =============================================================================
function PasswordPolicyEditorContent({
  organizationId,
}: PasswordPolicyEditorProps) {
  const { t } = useT('governance');
  const { toast } = useToast();
  const ability = useAbility();

  const { data: policy, isLoading } = useGovernancePolicy(
    organizationId,
    'password_policy',
  );
  const upsertMutation = useUpsertGovernancePolicy({ errorToast: false });

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

  // Save feedback belongs to the settings header's Save/Discard cluster: it
  // flashes "Saved" on success and raises the single destructive toast on
  // failure. The rule switches and the rotation switch below persist instantly
  // through `persistToggle`, which has no cluster to report through and so
  // raises its own failure toast.
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
      } catch (e) {
        console.error('[passwordPolicy save]', e);
        throw new Error(t('passwordPolicy.saveFailed'), { cause: e });
      }
    },
    [organizationId, t, upsertMutation],
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
      // Fire-and-forget, so catch: a validation failure (e.g. a numeric input
      // mid-edit) surfaces inline on that field and needs nothing here, while a
      // real write failure has no Save cluster to report through on this path —
      // the toggle applied without a click on Save — so it toasts here.
      editor.save().catch((err) => {
        if (err instanceof Error && err.message === 'VALIDATION_FAILED') return;
        console.error('[passwordPolicy] toggle save failed', err);
        toast({
          title: t('toastSaveFailedTitle'),
          description: t('passwordPolicy.saveFailed'),
          variant: 'destructive',
        });
      });
    },
    [editor, setValue, t, toast],
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
            {/* Same structure as the Organization details section: one divided
                list of rows, each with its label + hint on the left and its
                control pinned right. Each input carries `aria-label` with the
                row's label so it keeps an accessible name of its own now that
                the visible label lives on the row; a toggle row names its
                switch by its label itself. */}
            <SettingsFieldList>
              <SettingsFieldRow
                label={t('passwordPolicy.minLength')}
                description={t('passwordPolicy.minLengthHint')}
              >
                <Input
                  aria-label={t('passwordPolicy.minLength')}
                  type="number"
                  min={6}
                  max={128}
                  step={1}
                  wrapperClassName="w-full"
                  errorMessage={errors.minLength?.message}
                  {...register('minLength', { valueAsNumber: true })}
                />
              </SettingsFieldRow>

              {/* Each rule is an on/off setting, so it takes the settings
                  toggle: a switch at the row's right edge. */}
              {CHARACTER_RULES.map((rule) => (
                <SettingsToggleRow
                  key={rule}
                  className="py-5"
                  label={t(`passwordPolicy.${rule}`)}
                  checked={watch(rule) ?? false}
                  onCheckedChange={(v) => persistToggle(rule, v)}
                  disabled={!canEdit || editor.isSaving}
                />
              ))}

              <SettingsToggleRow
                className="py-5"
                label={t('passwordPolicy.rotationEnabled')}
                checked={rotationEnabled}
                onCheckedChange={(v) => persistToggle('rotationEnabled', v)}
                disabled={!canEdit || editor.isSaving}
              />

              {rotationEnabled && (
                <SettingsFieldRow
                  label={t('passwordPolicy.rotationDays')}
                  description={t('passwordPolicy.rotationDaysHint')}
                >
                  <Input
                    aria-label={t('passwordPolicy.rotationDays')}
                    type="number"
                    min={1}
                    max={3650}
                    step={1}
                    wrapperClassName="w-full"
                    errorMessage={errors.rotationDays?.message}
                    {...register('rotationDays', { valueAsNumber: true })}
                  />
                </SettingsFieldRow>
              )}
            </SettingsFieldList>
          </fieldset>
        </form>
      </SettingsSection>
    </Skeletonize>
  );
}

export const PasswordPolicyEditor = withGovernancePolicyReadBoundary(
  PasswordPolicyEditorContent,
  'password_policy',
);
