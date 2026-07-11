'use client';

import type { FieldErrors, UseFormRegister } from 'react-hook-form';

import { Input } from '@/app/components/ui/forms/input';
import { useT } from '@/lib/i18n/client';

import type { ContactFormValues } from '../hooks/use-contact-form';

interface ContactFormFieldsProps {
  register: UseFormRegister<ContactFormValues>;
  errors: FieldErrors<ContactFormValues>;
  disabled?: boolean;
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
  disabled,
}: ContactFormFieldsProps) {
  const { t: tContacts } = useT('contacts');

  return (
    <>
      <Input
        id="name"
        label={tContacts('name')}
        placeholder={tContacts('namePlaceholder')}
        {...register('name')}
        disabled={disabled}
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
        label={tContacts('phone')}
        {...register('phone')}
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
