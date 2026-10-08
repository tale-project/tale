'use client';

import { DatePicker } from '@tale/ui/date-picker';
import { Description } from '@tale/ui/description';
import { FieldShell } from '@tale/ui/field-shell';
import { Label } from '@tale/ui/label';
import { Select } from '@tale/ui/select';
import { useFormatDate } from '@tale/ui/use-format-date';
import { XCircle } from 'lucide-react';
import { useMemo } from 'react';

import { useT } from '@/lib/i18n/client';

import {
  API_KEY_EXPIRY_PRESET_DAYS,
  type ApiKeyExpiryChoice,
  customExpiryBounds,
  expiresAtAfter,
  expiryDays,
  isApiKeyExpiryChoice,
} from '../lib/expiry';

const PRESET_LABEL_KEYS: Record<
  (typeof API_KEY_EXPIRY_PRESET_DAYS)[number],
  string
> = {
  7: 'apiKeys.form.expiresOptions.7days',
  30: 'apiKeys.form.expiresOptions.30days',
  90: 'apiKeys.form.expiresOptions.90days',
  365: 'apiKeys.form.expiresOptions.1year',
};

const DATE_ID = 'api-key-expiry-date';
const DATE_LABEL_ID = `${DATE_ID}-label`;
const DATE_HINT_ID = `${DATE_ID}-hint`;
const DATE_ERROR_ID = `${DATE_ID}-error`;

interface ApiKeyExpiryFieldProps {
  choice: ApiKeyExpiryChoice;
  /** The day picked under "Custom date" (local midnight, ms), or null. */
  customDate: number | null;
  onChoiceChange: (choice: ApiKeyExpiryChoice) => void;
  onCustomDateChange: (date: number | null) => void;
  /** The moment the form opened: the hint and the calendar's bounds count
   * whole days from it, as the key's lifetime will. */
  now: number;
  /** Why the custom date cannot be used, once the field was touched. */
  customDateError?: string;
}

/**
 * A key's lifetime: a preset, a day picked in the calendar, or never — and,
 * under the control, the date the key will stop working, so the choice is
 * read as a date rather than a count of days.
 */
export function ApiKeyExpiryField({
  choice,
  customDate,
  onChoiceChange,
  onCustomDateChange,
  now,
  customDateError,
}: ApiKeyExpiryFieldProps) {
  const { t } = useT('settings');
  const { formatDate } = useFormatDate();

  const options = useMemo(
    () => [
      ...API_KEY_EXPIRY_PRESET_DAYS.map((days) => ({
        value: `${days}`,
        label: t(PRESET_LABEL_KEYS[days]),
      })),
      { value: 'custom', label: t('apiKeys.form.expiresOptions.custom') },
      { value: 'never', label: t('apiKeys.form.expiresOptions.never') },
    ],
    [t],
  );

  const days = expiryDays(choice, customDate, now);
  const expiresOn =
    typeof days === 'number'
      ? t('apiKeys.form.expiresOn', {
          date: formatDate(new Date(expiresAtAfter(days, now)), 'medium'),
        })
      : undefined;
  const bounds = customExpiryBounds(now);

  return (
    <>
      <Select
        id="expiresIn"
        label={t('apiKeys.form.expiresIn')}
        value={choice}
        onValueChange={(value) => {
          if (isApiKeyExpiryChoice(value)) onChoiceChange(value);
        }}
        options={options}
        hint={
          choice === 'custom'
            ? undefined
            : choice === 'never'
              ? t('apiKeys.form.neverExpiresHint')
              : expiresOn
        }
      />
      {choice === 'custom' && (
        <FieldShell
          label={
            // Named through aria-labelledby, not `htmlFor`: a native label
            // would take over the trigger's name and drop the picked day
            // from it.
            <Label id={DATE_LABEL_ID}>{t('apiKeys.form.expiryDate')}</Label>
          }
          hint={
            <Description id={DATE_HINT_ID}>
              {expiresOn ?? t('apiKeys.form.expiryDateHint')}
            </Description>
          }
          {...(customDateError !== undefined
            ? {
                error: (
                  <p
                    id={DATE_ERROR_ID}
                    role="alert"
                    aria-live="polite"
                    className="text-destructive flex items-center gap-1.5 text-sm"
                  >
                    <XCircle className="size-4" aria-hidden="true" />
                    {customDateError}
                  </p>
                ),
              }
            : {})}
        >
          <DatePicker
            id={DATE_ID}
            // The label names the trigger and the trigger's own text keeps
            // the picked day in that name.
            aria-labelledby={`${DATE_LABEL_ID} ${DATE_ID}`}
            aria-describedby={
              customDateError !== undefined
                ? `${DATE_HINT_ID} ${DATE_ERROR_ID}`
                : DATE_HINT_ID
            }
            value={customDate ?? undefined}
            onChange={onCustomDateChange}
            minDate={bounds.minDate}
            maxDate={bounds.maxDate}
          />
        </FieldShell>
      )}
    </>
  );
}
