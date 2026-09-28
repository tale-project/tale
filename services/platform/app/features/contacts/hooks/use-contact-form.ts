'use client';

import { useMemo } from 'react';
import * as z from 'zod';

import { useT } from '@/lib/i18n/client';
import {
  CONTACT_EMAIL_LOCAL_PART_MAX,
  CONTACT_EMAIL_MAX,
  CONTACT_LOCALE_MAX,
  CONTACT_LOCALE_PATTERN,
  CONTACT_NAME_MAX,
  CONTACT_PHONE_MAX,
  CONTACT_PHONE_PATTERN,
} from '@/lib/shared/schemas/common';

/** Shared shape for both the create and edit contact forms — keeping one
 *  schema factory means the two dialogs can't drift on which fields are
 *  required (see #2640: import and edit disagreeing on the Name rule). */
export type ContactFormValues = {
  name: string;
  email: string;
  phone: string;
  locale: string;
};

/**
 * Zod schema shared by `ContactCreateDialog` and `ContactEditDialog`.
 *
 * Name is intentionally optional — bulk import already allows a name-less
 * contact (email alone is a valid row), so requiring it only in the edit
 * form stranded name-less imported rows behind a fabricated name (#2640).
 * Email and locale stay required. Phone is optional but, when present,
 * digits and phone punctuation only.
 *
 * Every field is held to the door's own rule (`contactFieldsShape` in
 * `backend/domains/contacts/input-schema.ts`, the caps shared through
 * `lib/shared/schemas/common.ts`): trimmed first, then capped, so a value
 * the form lets through is one the server takes — a 301-character name or
 * a 51-character phone used to pass here and come back as a bare 400.
 */
export function useContactFormSchema() {
  const { t: tContacts } = useT('contacts');
  const { t: tCommon } = useT('common');

  return useMemo(
    () =>
      z.object({
        name: z
          .string()
          .trim()
          .max(
            CONTACT_NAME_MAX,
            tCommon('validation.maxLength', {
              field: tContacts('name'),
              max: CONTACT_NAME_MAX,
            }),
          ),
        email: z
          .string()
          .trim()
          .max(
            CONTACT_EMAIL_MAX,
            tCommon('validation.maxLength', {
              field: tContacts('email'),
              max: CONTACT_EMAIL_MAX,
            }),
          )
          .email(tCommon('validation.email'))
          // RFC 5321: at most 64 characters before the `@` — named as the
          // limit, not as a malformed address the person would re-check.
          .refine(
            (value) => value.indexOf('@') <= CONTACT_EMAIL_LOCAL_PART_MAX,
            tCommon('validation.emailLocalPart', {
              max: CONTACT_EMAIL_LOCAL_PART_MAX,
            }),
          ),
        phone: z
          .string()
          .trim()
          .max(
            CONTACT_PHONE_MAX,
            tCommon('validation.maxLength', {
              field: tContacts('phone'),
              max: CONTACT_PHONE_MAX,
            }),
          )
          .refine(
            (value) => value === '' || CONTACT_PHONE_PATTERN.test(value),
            tCommon('validation.phone'),
          ),
        locale: z
          .string()
          .trim()
          .min(
            1,
            tCommon('validation.required', { field: tContacts('locale') }),
          )
          .max(
            CONTACT_LOCALE_MAX,
            tCommon('validation.maxLength', {
              field: tContacts('locale'),
              max: CONTACT_LOCALE_MAX,
            }),
          )
          .regex(
            CONTACT_LOCALE_PATTERN,
            tCommon('validation.required', { field: tContacts('locale') }),
          ),
      }),
    [tContacts, tCommon],
  );
}
