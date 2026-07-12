'use client';

/**
 * Connected `Form` block — declared `formFieldSchema[]` fields (the same
 * grammar as an automation manifest's `requires.config`, rendered through the shared
 * `ConfigFieldInput`) feeding ONE bound submit action: local field state is
 * dispatched as the `$input.*` resolution context, so the view's `submit.args`
 * template picks the entered values. `required` fields validate before
 * dispatch (inline error text, wired `aria-invalid`/`aria-describedby` via the
 * `@tale/ui` Field), `derive` rules split one input into stored sub-keys
 * exactly like the config editor, and `onSuccess` runs the declarative effect
 * union (`useActionEffect`). `initial` values are sentinel-capable
 * (`$config:`, `$state.`, …) and resolve against the live runtime once.
 * Optional `when` + `whenQuery` hide the form when a predicate fails (e.g.
 * Create Setup after the setup folder already exists).
 */
import type { Fields, PuckComponent } from '@measured/puck';
import { Button } from '@tale/ui/button';
import { Field } from '@tale/ui/field';
import { useLocale } from '@tale/ui/i18n/locale-provider';
import { HStack, VStack } from '@tale/ui/layout';
import { SquarePen } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';

import { useT } from '@/lib/i18n/client';
import { deriveConfigValues } from '@/lib/shared/platform/derive_config';
import {
  argsReferenceProjectId,
  isFunctionAllowed,
  resolveBindingArgs,
} from '@/lib/shared/platform/function_bindings';
import type { AutomationConfigField } from '@/lib/shared/schemas/automation_views';
import { resolveLocalizedProp } from '@/lib/shared/utils/resolve-automation-locale';
import { isRecord } from '@/lib/utils/type-utils';

import {
  asFieldString,
  ConfigFieldInput,
  initFieldValues,
} from '../../components/config-field-inputs';
import { useConfigFieldText } from '../../hooks/use-automation-text';
import { useBlockWhenGate } from '../../hooks/use-block-when-gate';
import { useBoundAction } from '../../hooks/use-bound-action';
import {
  useActionEffect,
  type ActionEffect,
} from '../../runtime/action-effects';
import { useAutomationRuntime } from '../../runtime/automation-runtime';
import { useOptionalViewState } from '../../runtime/view-state';
import { BindingStates, BlockFrame } from '../block-frame';
import type { BoundActionSpec } from './bound-button';

export interface FormBlockProps {
  /** Literal block title (English); overridden by `i18n.<locale>.title`. */
  title?: string;
  /** Per-locale overrides for the block title (`i18n.de.title`, …). */
  i18n?: Record<string, Record<string, string>>;
  fields: AutomationConfigField[];
  /** Initial values per field key (sentinel-capable, resolved once). */
  initial?: Record<string, unknown>;
  /** The submit action — its args read the entered values via `$input.*`. */
  submit: BoundActionSpec;
  onSuccess?: ActionEffect;
  /** Hide when this predicate is false (against `whenQuery` data or `{}`). */
  when?: string;
  whenQuery?: { path: string; args?: unknown };
}

type FieldError = 'required' | 'invalid';

/** A required field is missing when its (trimmed) text is empty; booleans are
 *  always a value (checked or not), so `required` never blocks them. */
export function missingRequiredFields(
  fields: AutomationConfigField[],
  values: Record<string, string | boolean>,
): string[] {
  return fields
    .filter(
      (f) =>
        f.required === true &&
        f.type !== 'boolean' &&
        asFieldString(values[f.key]).trim() === '',
    )
    .map((f) => f.key);
}

export function Form({
  title,
  i18n,
  fields,
  initial,
  submit,
  onSuccess,
  when,
  whenQuery,
}: FormBlockProps) {
  const { t } = useT('automations');
  const { t: tCommon } = useT('common');
  const { locale } = useLocale();
  // View-authored fields: field.i18n → literal label → humanized key.
  const text = useConfigFieldText();
  const resolvedTitle = resolveLocalizedProp(title, i18n, 'title', locale);
  const runtime = useAutomationRuntime();
  const viewState = useOptionalViewState();
  const { dispatch, isPending } = useBoundAction(submit.path, submit.mode);
  const applyEffect = useActionEffect();
  const baseId = useId();
  const whenGate = useBlockWhenGate(when, whenQuery);

  const blocked = !isFunctionAllowed(
    submit.path,
    runtime.allowlist,
    submit.mode,
  );
  const needsProject =
    runtime.projectId === undefined &&
    (argsReferenceProjectId(submit.args) ||
      (whenQuery !== undefined && argsReferenceProjectId(whenQuery.args)));

  // `initial` may carry binding sentinels (`$config:owner`, `$projectName`,
  // `$state.taskId`) — resolve them against the live runtime. `$projectName`
  // often arrives after the first paint; we re-seed empty fields once when it
  // resolves, without clobbering edits the operator already made.
  const state = viewState?.state;
  const resolvedInitial = useMemo(() => {
    const resolved = resolveBindingArgs(initial ?? {}, {
      organizationId: runtime.organizationId,
      projectId: runtime.projectId,
      projectName: runtime.projectName,
      config: runtime.config,
      state,
    });
    return isRecord(resolved) ? resolved : {};
  }, [
    initial,
    runtime.organizationId,
    runtime.projectId,
    runtime.projectName,
    runtime.config,
    state,
  ]);

  const [values, setValues] = useState<Record<string, string | boolean>>(() =>
    initFieldValues(fields, resolvedInitial),
  );
  const [errors, setErrors] = useState<Record<string, FieldError>>({});
  const editedRef = useRef(false);
  // Submit stays inactive until the operator actually changes a field (and
  // again after a successful save), so a form can't be submitted by accident
  // with its default/prefilled values. Set only by user edits below — the
  // sentinel re-seed effect above is a system action and must not mark dirty.
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (editedRef.current) return;
    setValues((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const [key, seed] of Object.entries(resolvedInitial)) {
        if (typeof seed !== 'string' || seed.trim() === '') continue;
        if (asFieldString(prev[key]).trim() !== '') continue;
        next[key] = seed;
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [resolvedInitial]);

  // Mirror BoundButton's label resolution (`labelKey` through the platform
  // catalog with the literal as fallback), with the localized Save as the
  // last resort.
  const submitLabel = submit.labelKey
    ? t(submit.labelKey, {
        defaultValue: submit.label ?? tCommon('actions.save'),
      })
    : submit.label || tCommon('actions.save');

  const onSubmit = async (): Promise<void> => {
    const nextErrors: Record<string, FieldError> = {};
    for (const key of missingRequiredFields(fields, values)) {
      nextErrors[key] = 'required';
    }
    // The derive split runs like the config editor: the dispatched input holds
    // each raw value PLUS every derived sub-key (`$input.owner`, …).
    const { values: input, invalid } = deriveConfigValues(fields, values);
    for (const key of invalid) nextErrors[key] ??= 'invalid';
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    try {
      const result = await dispatch(submit.args, undefined, { input });
      setDirty(false);
      applyEffect(onSuccess ?? submit.onSuccess, result);
    } catch (err) {
      // The mutation/action layer already toasts + logs the failure; surface
      // it here too rather than swallowing the rejection.
      console.error(
        '[automation-binding] form submit failed',
        submit.path,
        err,
      );
    }
  };

  if (whenGate.decision === 'pending' || whenGate.decision === 'hide') {
    return null;
  }
  // Unresolved `$projectId` (or other config) on the gate query — show the
  // project empty state when that's why, otherwise stay hidden rather than
  // evaluating `when` against `{}`.
  if (whenGate.decision === 'needsConfig') {
    if (needsProject || whenGate.needsProject) {
      return (
        <BlockFrame title={resolvedTitle} icon={SquarePen}>
          <BindingStates needsProject>{null}</BindingStates>
        </BlockFrame>
      );
    }
    return null;
  }

  return (
    <BlockFrame title={resolvedTitle} icon={SquarePen}>
      <BindingStates
        blocked={blocked}
        path={submit.path}
        needsProject={needsProject}
      >
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void onSubmit();
          }}
        >
          <VStack gap={4}>
            <VStack gap={3}>
              {fields.map((f) => {
                const error = errors[f.key];
                const label = text.label(f);
                const fieldId = `${baseId}-${f.key}`;
                return (
                  <Field
                    key={f.key}
                    label={label}
                    htmlFor={fieldId}
                    required={f.required}
                    description={text.help(f)}
                    error={
                      error === 'required'
                        ? tCommon('validation.required', { field: label })
                        : error === 'invalid'
                          ? t('config.invalidValue', { label })
                          : undefined
                    }
                  >
                    <ConfigFieldInput
                      id={fieldId}
                      field={f}
                      value={values[f.key]}
                      disabled={isPending}
                      text={text}
                      onChange={(next) => {
                        editedRef.current = true;
                        setDirty(true);
                        setValues((s) => ({ ...s, [f.key]: next }));
                      }}
                    />
                  </Field>
                );
              })}
            </VStack>
            <HStack className="justify-end">
              <Button type="submit" disabled={isPending || !dirty}>
                {submitLabel}
              </Button>
            </HStack>
          </VStack>
        </form>
      </BindingStates>
    </BlockFrame>
  );
}

/** Registry entry (`registerConnectedBlock('Form', formBlock)`). */
export const formBlock: {
  fields: Fields;
  render: PuckComponent<Partial<FormBlockProps>>;
} = {
  fields: { title: { type: 'text' } },
  render: ({
    title,
    i18n,
    fields,
    initial,
    submit,
    onSuccess,
    when,
    whenQuery,
  }) =>
    submit?.path && fields && fields.length > 0 ? (
      <Form
        title={title}
        i18n={i18n}
        fields={fields}
        initial={initial}
        submit={submit}
        onSuccess={onSuccess}
        when={when}
        whenQuery={whenQuery}
      />
    ) : (
      <></>
    ),
};
