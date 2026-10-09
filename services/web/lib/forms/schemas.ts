import { z } from 'zod';

import { FORM_FIELD_ERRORS } from './field-errors';

const sanitize = (value: string): string =>
  // eslint-disable-next-line no-control-regex -- intentional: stripping control chars at boundary
  value.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

// Validate the exact text that will cross the delivery boundary. In particular,
// control characters must not make an otherwise empty field satisfy a minimum.
const cleanString = z.string().transform((value) => sanitize(value).trim());

const nameField = cleanString.pipe(
  z
    .string()
    .min(1, { message: FORM_FIELD_ERRORS.nameRequired })
    .max(2000, { message: FORM_FIELD_ERRORS.nameTooLong }),
);

const companyField = cleanString
  .pipe(z.string().max(2000, { message: FORM_FIELD_ERRORS.companyTooLong }))
  .optional();

const optionalMessageField = cleanString
  .pipe(z.string().max(2000, { message: FORM_FIELD_ERRORS.messageTooLong }))
  .optional();

const emailField = cleanString.pipe(
  z
    .string()
    .min(1, { message: FORM_FIELD_ERRORS.emailRequired })
    .max(2000, { message: FORM_FIELD_ERRORS.emailTooLong })
    .email({ message: FORM_FIELD_ERRORS.emailInvalid }),
);

const phoneField = cleanString
  .pipe(
    z
      .string()
      .max(32, { message: FORM_FIELD_ERRORS.phoneTooLong })
      .superRefine((value, ctx) => {
        if (value.length === 0) return;
        if (!/^\+?[\d ()-]+$/.test(value) || !/\d/.test(value)) {
          ctx.addIssue({
            code: 'custom',
            message: FORM_FIELD_ERRORS.phoneInvalid,
          });
          return;
        }
        if (value.replace(/\D/g, '').length < 4) {
          ctx.addIssue({
            code: 'custom',
            message: FORM_FIELD_ERRORS.phoneTooShort,
          });
        }
      }),
  )
  .optional();

const privacyField = z.boolean().refine((value) => value === true, {
  message: 'privacyRequired',
});

// Honeypot — must remain empty. Bots fill anything visible.
const honeypotField = z.string().max(0, { message: 'Bot detected' });

const baseFields = {
  name: nameField,
  email: emailField,
  privacy: privacyField,
  startedAt: z.number().int().nonnegative(),
  website: honeypotField.default(''),
};

export const REQUEST_DEMO_INTERESTS = [
  'enterprise',
  'professional_services',
  'custom_ai_training',
  'ai_hardware',
] as const;

export const requestDemoSchema = z.object({
  ...baseFields,
  phone: phoneField,
  company: companyField,
  interests: z.array(z.enum(REQUEST_DEMO_INTERESTS)).default([]),
  message: optionalMessageField,
});

export const contactSchema = z.object({
  ...baseFields,
  company: companyField,
  message: cleanString.pipe(
    z
      .string()
      .min(1, { message: FORM_FIELD_ERRORS.messageRequired })
      .min(10, { message: FORM_FIELD_ERRORS.messageTooShort })
      .max(2000, { message: FORM_FIELD_ERRORS.messageTooLong }),
  ),
});

export type RequestDemoPayload = z.infer<typeof requestDemoSchema>;
export type ContactPayload = z.infer<typeof contactSchema>;
export type RequestDemoInput = z.input<typeof requestDemoSchema>;
export type ContactInput = z.input<typeof contactSchema>;

export const submitRequest = z.discriminatedUnion('form', [
  z.object({ form: z.literal('request-demo'), payload: requestDemoSchema }),
  z.object({ form: z.literal('contact'), payload: contactSchema }),
]);

export type SubmitRequest = z.infer<typeof submitRequest>;

export const MIN_SUBMIT_DELAY_MS = 3000;
