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

/**
 * A character no phone number holds: anything but digits and the punctuation
 * people type in them (`CONTACT_PHONE_PATTERN`'s alphabet). Not global, so
 * `test` doesn't resume from the previous match.
 */
const PHONE_FORBIDDEN_CHARACTER = /[^\d+().\s-]/;

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
          // Name a letter as it is typed, but keep it in the field: stripping
          // it changed the number behind the person's back, and Save then
          // sent the cleaned value (`00kkkk` became `00`) once this message
          // was gone (#3825). The schema refuses the same characters, so
          // Save stays blocked until they are removed.
          onChange: (event) => {
            if (PHONE_FORBIDDEN_CHARACTER.test(event.target.value)) {
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
