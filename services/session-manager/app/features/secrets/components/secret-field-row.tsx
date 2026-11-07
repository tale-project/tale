import { BorderedSection } from '@tale/ui/bordered-section';
import { IconButton } from '@tale/ui/icon-button';
import { Input } from '@tale/ui/input';
import { Row } from '@tale/ui/layout';
import { Textarea } from '@tale/ui/textarea';
import { Trash2 } from 'lucide-react';
import { memo } from 'react';
import { useWatch, type Control, type UseFormRegister } from 'react-hook-form';

import { useT } from '@/lib/i18n/client';

import { isHiddenRow, type FormValues } from '../lib/form';

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
  labelError?: string;
  valueError?: string;
  onRemove: (index: number) => void;
}

/**
 * One value of the secret: its label and the value. Whether it is hidden is
 * not asked: a stored value is as it was stored, and a new one is hidden when
 * it is a password, a card number, a CVC or labelled like something private
 * (`isHiddenRow`), as the server decides. A hidden value is masked until shown,
 * by the field's own button inside its edge, and stays out of the lists; a
 * stored one can also be copied without showing it.
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
  labelError,
  valueError,
  onRemove,
}: SecretFieldRowProps) {
  const { t } = useT('secrets');
  const [template, label, storedHidden, stored] = useWatch({
    control,
    name: [
      `rows.${index}.template`,
      `rows.${index}.label`,
      `rows.${index}.hidden`,
      `rows.${index}.decided`,
    ],
  });
  const hidden = isHiddenRow({
    template,
    label,
    hidden: storedHidden,
    decided: stored,
  });

  const added = fixedLabel === undefined;
  const name = fixedLabel ?? (label.trim() || t('row.name', { position }));

  // What a hidden value's field carries: masked, its buttons named for this
  // value. Only a stored value can be copied: a value typed here a moment ago
  // has nothing to copy that the person does not have. The field is keyed by
  // whether it is hidden, so a value whose label makes it hidden is masked,
  // however it was left before.
  const secret = hidden
    ? {
        ...(stored
          ? {
              copyable: true,
              copyLabel: t('row.copy', { label: name }),
              copiedLabel: t('row.copied', { label: name }),
            }
          : {}),
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

  // A row the person added has two fields with the same names as every other
  // added row's: its group, a frame of its own, says which row they belong to.
  return added ? (
    <BorderedSection role="group" aria-label={name}>
      {labelRow}
      {valueField}
    </BorderedSection>
  ) : (
    valueField
  );
});
