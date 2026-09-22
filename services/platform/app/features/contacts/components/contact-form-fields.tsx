'use client';

import { Input } from '@tale/ui/input';
import type {
  FieldErrors,
  UseFormClearErrors,
  UseFormRegister,
  UseFormSetError,
} from 'react-hook-form';

import { useT } from '@/lib/i18n/client';

import type { ContactFormValues } from '../hooks/use-contact-form';

/** Digits plus the punctuation people type in phone numbers. */
const PHONE_ALLOWED = /[^\d+().\s\-]/g;

interface ContactFormFieldsProps {
  register: UseFormRegister<ContactFormValues>;
  errors: FieldErrors<ContactFormValues>;
  setError: UseFormSetError<ContactFormValues>;
  clearErrors: UseFormClearErrors<ContactFormValues>;
  disabled?: boolean;
  autoFocus?: boolean;
}

/**
 * Name/Email/Phone/Locale inputs shared by `ContactCreateDialog` and
 * `ContactEditDialog` — one field set for both so they can't silently drift
 * on labels, placeholders, or validation wiring.
 *
 * None of these pass the native HTML `required` attribute: `FormDialog`'s
 * `<form>` has no `noValidate`, so a `required` input's browser-native
 * constraint validation intercepts submit and blocks it *before* React Hook
 * Form runs — leaving Zod's error state (and the inline message below) never
 * populated. Zod already enforces email/locale as required; the label just
 * doesn't show the red asterisk it would otherwise pair with (#2640).
 */
export function ContactFormFields({
  register,
  errors,
  setError,
  clearErrors,
  disabled,
  autoFocus = false,
}: ContactFormFieldsProps) {
  const { t: tContacts } = useT('contacts');
  const { t: tCommon } = useT('common');

  return (
    <>
      <Input
        id="name"
        label={tContacts('name')}
        placeholder={tContacts('namePlaceholder')}
        {...register('name')}
        disabled={disabled}
        autoFocus={autoFocus}
        errorMessage={errors.name?.message}
      />

      <Input
        id="email"
        type="email"
        label={tContacts('email')}
        placeholder={tContacts('emailPlaceholder')}
        {...register('email')}
        disabled={disabled}
        errorMessage={errors.email?.message}
      />

      <Input
        id="phone"
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        label={tContacts('phone')}
        placeholder={tContacts('phonePlaceholder')}
        {...register('phone', {
          // Refuse letters, but say so — silent stripping feels like a
          // broken keyboard. Digits and phone punctuation stay.
          onChange: (event) => {
            const raw = event.target.value;
            const cleaned = raw.replace(PHONE_ALLOWED, '');
            if (raw !== cleaned) {
              event.target.value = cleaned;
              setError('phone', {
                type: 'manual',
                message: tCommon('validation.phone'),
              });
            } else if (errors.phone?.type === 'manual') {
              clearErrors('phone');
            }
          },
        })}
        disabled={disabled}
        errorMessage={errors.phone?.message}
      />

      <Input
        id="locale"
        label={tContacts('locale')}
        placeholder={tContacts('localePlaceholder')}
        {...register('locale')}
        disabled={disabled}
        errorMessage={errors.locale?.message}
      />
    </>
  );
}
