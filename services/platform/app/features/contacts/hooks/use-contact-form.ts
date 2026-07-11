'use client';

import { useMemo } from 'react';
import * as z from 'zod';

import { useT } from '@/lib/i18n/client';

/** Accepts a bare language tag (`en`) or a language-region/script tag
 *  (`en-US`, `zh_Hans`) — mirrors the import mapper's locale detection. */
export const LOCALE_PATTERN = /^[a-z]{2}(?:[-_][A-Za-z]{2,})?$/;

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
 * Email and locale stay required.
 */
export function useContactFormSchema() {
  const { t: tContacts } = useT('contacts');
  const { t: tCommon } = useT('common');

  return useMemo(
    () =>
      z.object({
        name: z.string().trim(),
        email: z.string().email(tCommon('validation.email')),
        phone: z.string(),
        locale: z
          .string()
          .min(
            1,
            tCommon('validation.required', { field: tContacts('locale') }),
          )
          .regex(
            LOCALE_PATTERN,
            tCommon('validation.required', { field: tContacts('locale') }),
          ),
      }),
    [tContacts, tCommon],
  );
}
