/** Shared schema issue identifiers; only the presentation layer translates them. */
export const FORM_FIELD_ERRORS = {
  nameRequired: 'validation.nameRequired',
  nameTooLong: 'validation.nameTooLong',
  emailRequired: 'validation.emailRequired',
  emailInvalid: 'validation.emailInvalid',
  emailTooLong: 'validation.emailTooLong',
  companyTooLong: 'validation.companyTooLong',
  messageRequired: 'validation.messageRequired',
  messageTooShort: 'validation.messageTooShort',
  messageTooLong: 'validation.messageTooLong',
  phoneInvalid: 'validation.phoneInvalid',
  phoneTooShort: 'validation.phoneTooShort',
  phoneTooLong: 'validation.phoneTooLong',
} as const;

type FormFieldErrorKey =
  (typeof FORM_FIELD_ERRORS)[keyof typeof FORM_FIELD_ERRORS];
const knownKeys = new Set<string>(Object.values(FORM_FIELD_ERRORS));

/** Unknown resolver issues still get localized guidance, never raw validation prose. */
export function formFieldErrorMessage(
  message: string | undefined,
  t: (key: FormFieldErrorKey | 'validation.invalid') => string,
): string | undefined {
  if (!message) return undefined;
  return t(
    knownKeys.has(message)
      ? (message as FormFieldErrorKey)
      : 'validation.invalid',
  );
}
