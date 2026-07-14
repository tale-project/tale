'use client';

import { Field } from '@tale/ui/field';
/**
 * The dialog twin of the `Form` block, for a Collection `addAction` that
 * declares `form.fields`: the header button opens this dialog, the entered
 * values dispatch as the action's `$input.*` resolution context (same
 * derive/validation path as the inline Form), and `onSuccess` applies after
 * the dialog closes.
 */
import { useLocale } from '@tale/ui/i18n/locale-provider';
import { useId, useState } from 'react';

import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { useT } from '@/lib/i18n/client';
import { deriveConfigValues } from '@/lib/shared/platform/derive_config';
import type { AutomationConfigField } from '@/lib/shared/schemas/automation_views';
import { resolveLocalizedProp } from '@/lib/shared/utils/resolve-automation-locale';

import {
  ConfigFieldInput,
  initFieldValues,
} from '../../components/config-field-inputs';
import { useConfigFieldText } from '../../hooks/use-automation-text';
import { useBoundAction } from '../../hooks/use-bound-action';
import { useActionEffect } from '../../runtime/action-effects';
import type { BoundActionSpec } from './bound-button';
import { missingRequiredFields } from './form';

type FieldError = 'required' | 'invalid';

export function AddActionFormDialog({
  action,
  fields,
  open,
  onOpenChange,
}: {
  action: BoundActionSpec;
  fields: AutomationConfigField[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useT('automations');
  const { t: tCommon } = useT('common');
  const { locale } = useLocale();
  const text = useConfigFieldText();
  const { dispatch, isPending } = useBoundAction(action.path, action.mode);
  const applyEffect = useActionEffect();
  const baseId = useId();

  const [values, setValues] = useState<Record<string, string | boolean>>(() =>
    initFieldValues(fields, {}),
  );
  const [errors, setErrors] = useState<Record<string, FieldError>>({});

  const authoredLabel =
    resolveLocalizedProp(action.label, action.i18n, 'label', locale) ??
    action.label;
  const label = action.labelKey
    ? t(action.labelKey, { defaultValue: authoredLabel ?? action.path })
    : (authoredLabel ?? action.path);

  const reset = () => {
    setValues(initFieldValues(fields, {}));
    setErrors({});
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const nextErrors: Record<string, FieldError> = {};
    for (const key of missingRequiredFields(fields, values)) {
      nextErrors[key] = 'required';
    }
    const { values: input, invalid } = deriveConfigValues(fields, values);
    for (const key of invalid) nextErrors[key] ??= 'invalid';
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    try {
      const result = await dispatch(action.args, undefined, { input });
      onOpenChange(false);
      reset();
      applyEffect(action.onSuccess, result);
    } catch (err) {
      // The mutation/action layer already toasts + logs; surface here too.
      console.error(
        '[automation-binding] add-action form failed',
        action.path,
        err,
      );
    }
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) reset();
      }}
      title={label}
      isSubmitting={isPending}
      submitText={label}
      onSubmit={(e) => void onSubmit(e)}
    >
      {fields.map((f) => {
        const error = errors[f.key];
        const fieldLabel = text.label(f);
        const fieldId = `${baseId}-${f.key}`;
        return (
          <Field
            key={f.key}
            label={fieldLabel}
            htmlFor={fieldId}
            required={f.required}
            description={text.help(f)}
            error={
              error === 'required'
                ? tCommon('validation.required', { field: fieldLabel })
                : error === 'invalid'
                  ? t('config.invalidValue', { label: fieldLabel })
                  : undefined
            }
          >
            <ConfigFieldInput
              id={fieldId}
              field={f}
              value={values[f.key]}
              disabled={isPending}
              text={text}
              onChange={(next) => setValues((s) => ({ ...s, [f.key]: next }))}
            />
          </Field>
        );
      })}
    </FormDialog>
  );
}
