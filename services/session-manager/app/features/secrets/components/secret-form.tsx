import { zodResolver } from '@hookform/resolvers/zod';
import { Alert } from '@tale/ui/alert';
import { Button } from '@tale/ui/button';
import { FormDialog } from '@tale/ui/dialog/form-dialog';
import { FormSection } from '@tale/ui/form-section';
import { Input } from '@tale/ui/input';
import { Stack } from '@tale/ui/layout';
import { Select } from '@tale/ui/select';
import { useForm } from '@tale/ui/use-form';
import { Plus } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react';
import { Controller, useFieldArray } from 'react-hook-form';

import { ApiError } from '@/app/lib/api/client';
import { failureText } from '@/app/lib/api/failure';
import {
  SECRET_KINDS,
  type Secret,
  type SecretKind,
  type SecretKindInfo,
} from '@/lib/api/schemas';
import { useT } from '@/lib/i18n/client';
import {
  MAX_FIELDS,
  MAX_LABEL,
  MAX_TITLE,
  MAX_VALUE,
} from '@/lib/secret-limits';

import { useSecretActions, FORM_REFUSALS } from '../hooks/use-secret-actions';
import { useSecretLabels } from '../hooks/use-secret-labels';
import {
  customRow,
  isPristine,
  problemsOf,
  rowsFromSecret,
  startingRows,
  switchKind,
  toCreateBody,
  toUpdateBody,
  type FormValues,
} from '../lib/form';
import { secretFormSchema, type FormMessages } from '../lib/form-schema';
import { KIND_ICONS } from '../lib/kinds';
import { scopeOf } from '../lib/scope';
import type { SessionChoice } from '../lib/session-choices';
import { SecretFieldRow } from './secret-field-row';
import { SecretScopeField } from './secret-scope-field';

interface SecretFormProps {
  mode: 'create' | 'edit';
  kinds: readonly SecretKindInfo[];
  /** Editing: the stored secret, hidden values included. */
  secret?: Secret;
  /** Creating: the kind the form opens as. */
  initialKind: SecretKind;
  /** Creating: who the secret is for when the form opens. */
  initialScope: string;
  /** Creating: the session `initialScope` names, for its name in the select. */
  scopeSession?: SessionChoice;
  /** Called with false when the form is dismissed or the secret is saved. */
  onOpenChange: (open: boolean) => void;
  /** Called once the secret is saved, before the form closes. */
  onSaved?: () => void;
  restoreFocusRef?: RefObject<HTMLElement | null>;
}

function kindSpec(
  kinds: readonly SecretKindInfo[],
  kind: SecretKind,
): SecretKindInfo {
  return (
    kinds.find((candidate) => candidate.key === kind) ?? {
      key: kind,
      label: kind,
      fields: [],
    }
  );
}

/** What the form opens with: a blank secret of a kind, or the stored one. */
function openedValues(
  props: Pick<SecretFormProps, 'mode' | 'kinds' | 'secret'> & {
    initialKind: SecretKind;
    initialScope: string;
  },
): FormValues {
  const { mode, kinds, secret, initialKind, initialScope } = props;
  if (mode === 'edit' && secret !== undefined) {
    return {
      kind: secret.kind,
      title: secret.title,
      scope: scopeOf(secret),
      rows: rowsFromSecret(kindSpec(kinds, secret.kind), secret.fields),
    };
  }
  return {
    kind: initialKind,
    title: '',
    scope: initialScope,
    rows: startingRows(kindSpec(kinds, initialKind)),
  };
}

/**
 * The form of a secret, to add one or to change one: its kind (chosen while
 * adding, fixed after), a title, who it is for, and its values with their
 * labels. Starting rows come with the kind; more can be added. A value left
 * empty is dropped by the server, so a row is only checked once it has one.
 * Nothing is said to be wrong until the person presses the button that saves:
 * then every problem is told beside its field, and the first one has the
 * cursor. Closing with unsaved edits asks first. Saving a stored secret sends
 * what changed, and only that.
 */
export function SecretForm({
  mode,
  kinds,
  secret,
  initialKind,
  initialScope,
  scopeSession,
  onOpenChange,
  onSaved,
  restoreFocusRef,
}: SecretFormProps) {
  const { t } = useT('secrets');
  const { t: tErrors } = useT('errors');
  const { t: tCommon } = useT('common');
  const labels = useSecretLabels();
  const actions = useSecretActions();
  const valuesId = useId();
  const [serverError, setServerError] = useState<string | null>(null);
  // The button that saves was pressed once: from then on the form tells what
  // is wrong, and keeps telling it as the person mends it.
  const [attempted, setAttempted] = useState(false);
  const [opened] = useState(() =>
    openedValues({ mode, kinds, secret, initialKind, initialScope }),
  );

  const messages = useMemo<FormMessages>(
    () => ({
      titleRequired: t('validation.titleRequired'),
      titleTooLong: t('validation.titleTooLong', { max: MAX_TITLE }),
      labelRequired: t('validation.labelRequired'),
      labelTooLong: t('validation.labelTooLong', { max: MAX_LABEL }),
      valueTooLong: (label) =>
        t('validation.valueTooLong', {
          label: labels.field(label),
          max: MAX_VALUE,
        }),
      noValues: t('validation.noValues'),
      tooMany: t('validation.tooMany', { max: MAX_FIELDS }),
    }),
    [t, labels],
  );
  const schema = useMemo(() => secretFormSchema(messages), [messages]);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: opened,
    // Not on blur: a person who leaves the empty title for the list of
    // sessions would see "Enter a title." push that list down between the
    // press and the release of the mouse button, and the click would be lost.
    mode: 'onSubmit',
  });
  const { control, register, setValue, getValues, formState } = form;
  const { fields, append, remove, replace } = useFieldArray({
    control,
    name: 'rows',
    keyName: 'key',
  });
  const values = form.watch();
  const kind = values.kind;
  const problems = problemsOf(values);

  // A new secret opens blank in whichever kind is chosen; a stored one, as it
  // is stored. Changing the kind of a new secret alone is no edit.
  const baseline: FormValues =
    mode === 'edit'
      ? opened
      : { ...opened, kind, rows: startingRows(kindSpec(kinds, kind)) };
  const dirty = !isPristine(values, baseline);

  const changeKind = (next: SecretKind) => {
    setValue('kind', next);
    replace(switchKind(getValues('rows'), kindSpec(kinds, next), labels.field));
    // New rows are a fresh start: nothing is said about them until the button
    // that saves is pressed again.
    form.clearErrors();
    setAttempted(false);
  };

  // The form opens on the title. The first text field in the dialog is the
  // native twin Radix draws beside the kind's select, so the dialog is told.
  const titleField = useRef<HTMLInputElement | null>(null);
  const titleProps = register('title');

  const addButton = useRef<HTMLButtonElement>(null);
  const [removals, setRemovals] = useState(0);
  // The row a person removed takes its controls along: the focus goes to the
  // button that adds one, else (a note has none) to the group of values.
  useEffect(() => {
    if (removals === 0) return;
    (addButton.current ?? document.getElementById(valuesId))?.focus();
  }, [removals, valuesId]);
  const removeRow = useCallback(
    (index: number) => {
      remove(index);
      setRemovals((count) => count + 1);
    },
    [remove],
  );

  // The mutation cache keeps what a write was called with: the values of the
  // secret. The form holds them itself for as long as it is open, so the write
  // is let go as soon as it has settled, not when the form is gone.
  const { reset: forgetCreation } = actions.create;
  const { reset: forgetUpdate } = actions.update;

  const submit = form.handleSubmit(
    async (data) => {
      setServerError(null);
      try {
        if (mode === 'edit' && secret !== undefined) {
          const changes = toUpdateBody(data, secret);
          if (Object.keys(changes).length > 0) {
            await actions.update.mutateAsync({
              id: secret.id,
              update: changes,
            });
          }
        } else {
          await actions.create.mutateAsync(toCreateBody(data));
        }
      } catch (error) {
        // A refusal the form words stays on top of it; any other failure has
        // raised its toast already (`useApiMutation`), and the draft stays.
        if (error instanceof ApiError && FORM_REFUSALS.includes(error.code)) {
          setServerError(failureText(error, tErrors));
        } else {
          console.warn(
            'The secret was not saved',
            error instanceof ApiError ? error.code : error,
          );
        }
        return;
      } finally {
        forgetCreation();
        forgetUpdate();
      }
      onSaved?.();
      onOpenChange(false);
    },
    () => {
      // The form focuses the first field that has a problem. A problem of the
      // whole form (not one value) has no field: the first value is where to
      // start.
      const found = problemsOf(getValues());
      const ofAField =
        found.title !== undefined ||
        found.rows.some(
          (row) => row.label !== undefined || row.value !== undefined,
        );
      if (!ofAField && fields.length > 0) form.setFocus('rows.0.value');
    },
  );

  const addedPosition = (index: number) =>
    values.rows.slice(0, index + 1).filter((row) => row.template === null)
      .length;
  const errors = formState.errors.rows;
  const spec = kindSpec(kinds, kind);
  const onlyNote = kind === 'note' && fields.length === 1;
  const known = useMemo<SessionChoice[]>(() => {
    if (secret?.session) {
      return [{ id: secret.session.id, name: secret.session.name }];
    }
    return scopeSession === undefined ? [] : [scopeSession];
  }, [secret, scopeSession]);

  return (
    <FormDialog
      open
      onOpenChange={onOpenChange}
      title={mode === 'edit' ? t('form.editTitle') : t('form.createTitle')}
      description={mode === 'edit' ? labels.kind(kind) : undefined}
      submitText={
        mode === 'edit' ? tCommon('actions.save') : t('form.createSubmit')
      }
      size="entity"
      // A secret has up to 40 values: they scroll, the buttons stay.
      stickyFooter
      confirmDiscardOnDirty
      isSubmitting={actions.create.isPending || actions.update.isPending}
      isDirty={dirty}
      onSubmit={() => {
        setAttempted(true);
        void submit();
      }}
      restoreFocusRef={restoreFocusRef}
      initialFocusRef={titleField}
    >
      {serverError === null ? null : (
        <Alert variant="destructive" description={serverError} />
      )}
      {mode === 'create' ? (
        <Controller
          control={control}
          name="kind"
          render={({ field }) => (
            <Select
              label={t('form.kind')}
              value={field.value}
              onValueChange={(next) => {
                const chosen = SECRET_KINDS.find((entry) => entry === next);
                if (chosen !== undefined) changeKind(chosen);
              }}
              hint={labels.kindHint(field.value)}
              options={kinds.map((candidate) => {
                const Icon = KIND_ICONS[candidate.key];
                return {
                  value: candidate.key,
                  label: labels.kind(candidate.key),
                  icon: <Icon className="size-4" aria-hidden="true" />,
                };
              })}
            />
          )}
        />
      ) : null}
      <Input
        label={t('form.title')}
        required
        {...titleProps}
        ref={(node) => {
          titleProps.ref(node);
          titleField.current = node;
        }}
        placeholder={labels.titleExample(kind)}
        errorMessage={formState.errors.title?.message}
        autoComplete="off"
      />
      <Controller
        control={control}
        name="scope"
        render={({ field }) => (
          <SecretScopeField
            value={field.value}
            onValueChange={field.onChange}
            knownSessions={known}
          />
        )}
      />
      <FormSection
        id={valuesId}
        tabIndex={-1}
        className="outline-none"
        label={t('form.values')}
        description={t('form.hiddenHint')}
      >
        {attempted && problems.noValues ? (
          <Alert variant="destructive" description={t('validation.noValues')} />
        ) : null}
        {attempted && problems.tooMany ? (
          <Alert
            variant="destructive"
            description={t('validation.tooMany', { max: MAX_FIELDS })}
          />
        ) : null}
        <Stack gap={4}>
          {fields.map((row, index) => (
            <SecretFieldRow
              key={row.key}
              index={index}
              fixedLabel={
                row.template === null ? undefined : labels.field(row.template)
              }
              multiline={row.multiline}
              large={onlyNote}
              position={addedPosition(index)}
              control={control}
              register={register}
              setValue={setValue}
              labelError={errors?.[index]?.label?.message}
              valueError={errors?.[index]?.value?.message}
              onRemove={removeRow}
            />
          ))}
        </Stack>
        {spec.key === 'note' ? null : (
          <div>
            <Button
              ref={addButton}
              type="button"
              variant="secondary"
              size="sm"
              icon={Plus}
              onClick={() =>
                // The cursor goes to the label of the new row, not to its value,
                // which `react-hook-form` would pick as the first it registered.
                append(customRow(), {
                  focusName: `rows.${fields.length}.label`,
                })
              }
              disabled={fields.length >= MAX_FIELDS}
              disabledReason={t('validation.tooMany', { max: MAX_FIELDS })}
            >
              {t('form.addField')}
            </Button>
          </div>
        )}
      </FormSection>
    </FormDialog>
  );
}
