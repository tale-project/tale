import { BorderedSection } from '@tale/ui/bordered-section';
import { Checkbox } from '@tale/ui/checkbox';
import { IconButton } from '@tale/ui/icon-button';
import { Input } from '@tale/ui/input';
import { Row, Stack } from '@tale/ui/layout';
import { Textarea } from '@tale/ui/textarea';
import { Trash2 } from 'lucide-react';
import { memo } from 'react';
import {
  useWatch,
  type Control,
  type UseFormRegister,
  type UseFormSetValue,
} from 'react-hook-form';

import { useT } from '@/lib/i18n/client';

import type { FormValues } from '../lib/form';

/**
 * What keeps a password manager out of a hidden value: it is a secret the
 * person is storing here, not an account password, and a manager's save or
 * generate would only crowd the buttons inside the field. The same hints that
 * `Input`'s `sensitive` sets, which this field cannot use: `sensitive` masks a
 * TEXT field with CSS, and a screen reader reads the value typed into one
 * out loud.
 */
const KEEP_MANAGERS_OUT = {
  'data-1p-ignore': true,
  'data-lpignore': 'true',
  'data-form-type': 'other',
  'data-bwignore': 'true',
} as const;

interface SecretFieldRowProps {
  index: number;
  /**
   * The label of a starting row, in the person's language. It is fixed: the
   * server knows the row by its own label. A row the person added has none,
   * and its label is typed.
   */
  fixedLabel?: string;
  /** The value is text of several lines. */
  multiline: boolean;
  /** The row is the whole secret (a note): its text area is the tall one. */
  large?: boolean;
  /** Which of the added rows this is, for its name while it has no label. */
  position: number;
  control: Control<FormValues>;
  register: UseFormRegister<FormValues>;
  setValue: UseFormSetValue<FormValues>;
  labelError?: string;
  valueError?: string;
  onRemove: (index: number) => void;
}

/**
 * One value of the secret: its label, the value, and whether it is kept
 * hidden. A hidden value is masked until shown and copied without showing it,
 * by the field's own buttons inside its edge; it stays out of the lists.
 * Showing it here changes nothing about the secret. The value is read and
 * written through the form (uncontrolled), so typing in one row re-renders no
 * other.
 *
 * A hidden value of one line is a password field, so that assistive technology
 * does not speak it. A text area has no such form: a hidden value of several
 * lines is masked by the browser, and a screen reader still reads it.
 */
export const SecretFieldRow = memo(function SecretFieldRow({
  index,
  fixedLabel,
  multiline,
  large = false,
  position,
  control,
  register,
  setValue,
  labelError,
  valueError,
  onRemove,
}: SecretFieldRowProps) {
  const { t } = useT('secrets');
  const [hidden, label] = useWatch({
    control,
    name: [`rows.${index}.hidden`, `rows.${index}.label`],
  });

  const added = fixedLabel === undefined;
  const name = fixedLabel ?? (label.trim() || t('row.name', { position }));

  const keepHidden = (keep: boolean) => {
    setValue(`rows.${index}.hidden`, keep, { shouldDirty: true });
    setValue(`rows.${index}.decided`, true);
  };

  // What a hidden value's field carries: masked, the two buttons named for this
  // value. The field is keyed by the choice, so a value made hidden is masked
  // again, however it was left before, and one made visible has nothing to show.
  const secret = hidden
    ? {
        copyable: true,
        copyLabel: t('row.copy', { label: name }),
        copiedLabel: t('row.copied', { label: name }),
        revealLabels: {
          show: t('row.show', { label: name }),
          hide: t('row.hide', { label: name }),
        },
      }
    : {};
  const value = register(`rows.${index}.value`);
  const valueLabel = fixedLabel ?? t('row.value');

  const valueField = multiline ? (
    <Textarea
      key={hidden ? 'hidden' : 'plain'}
      {...value}
      {...secret}
      sensitive={hidden}
      label={valueLabel}
      errorMessage={valueError}
      autoComplete="off"
      spellCheck={false}
      className={large ? 'min-h-40' : 'min-h-20'}
    />
  ) : (
    <Input
      key={hidden ? 'hidden' : 'plain'}
      {...value}
      {...secret}
      {...(hidden ? KEEP_MANAGERS_OUT : {})}
      type={hidden ? 'password' : 'text'}
      label={valueLabel}
      errorMessage={valueError}
      autoComplete="off"
      spellCheck={false}
    />
  );

  const labelRow = added ? (
    <Row gap={2} align="end">
      <Input
        {...register(`rows.${index}.label`)}
        label={t('row.label')}
        errorMessage={labelError}
        autoComplete="off"
        wrapperClassName="min-w-0 flex-1"
      />
      <IconButton
        type="button"
        icon={Trash2}
        aria-label={t('row.remove', { label: name })}
        onClick={() => onRemove(index)}
      />
    </Row>
  ) : null;
  const keep = (
    <Checkbox
      label={t('row.keepHidden')}
      // The words on screen come first, then which value they are about: a
      // list of the form's controls would otherwise read "Keep hidden" over
      // and over.
      aria-label={t('row.keepHiddenFor', { label: name })}
      checked={hidden}
      onCheckedChange={(checked) => keepHidden(checked === true)}
    />
  );

  // A row the person added has two fields with the same names as every other
  // added row's: its group, a frame of its own, says which row they belong to.
  return added ? (
    <BorderedSection role="group" aria-label={name}>
      {labelRow}
      {valueField}
      {keep}
    </BorderedSection>
  ) : (
    <Stack gap={2}>
      {valueField}
      {keep}
    </Stack>
  );
});
