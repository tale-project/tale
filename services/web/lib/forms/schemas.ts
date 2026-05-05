import { z } from 'zod';

// Strip control chars before length checks would be ideal, but in zod 4
// `.transform()` returns a ZodPipe — composing further `.min/.email/...`
// after the pipe is unsupported. So we keep validation on the plain string
// and run the control-char strip in `.transform()` last.

const sanitize = (value: string): string =>
  // eslint-disable-next-line no-control-regex -- intentional: stripping control chars at boundary
  value.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

const requiredString = z
  .string()
  .trim()
  .min(1, { message: 'Required' })
  .max(2000, { message: 'Too long' })
  .transform(sanitize);

const optionalString = z
  .string()
  .trim()
  .max(2000, { message: 'Too long' })
  .transform(sanitize)
  .optional();

const emailField = z
  .string()
  .trim()
  .min(1, { message: 'Required' })
  .max(2000, { message: 'Too long' })
  .email({ message: 'Invalid email' })
  .transform(sanitize);

const phoneField = z
  .string()
  .trim()
  .max(32, { message: 'Too long' })
  .superRefine((value, ctx) => {
    if (value.length === 0) return;
    if (value.length < 4) {
      ctx.addIssue({
        code: 'custom',
        message: 'Too short',
      });
      return;
    }
    if (!/^[\d\s+()-]+$/.test(value)) {
      ctx.addIssue({
        code: 'custom',
        message: 'Invalid phone number',
      });
    }
  })
  .transform(sanitize)
  .optional();

const privacyField = z.boolean().refine((value) => value === true, {
  message: 'You must accept the privacy policy',
});

// Honeypot — must remain empty. Bots fill anything visible.
const honeypotField = z.string().max(0, { message: 'Bot detected' });

const baseFields = {
  name: requiredString,
  email: emailField,
  privacy: privacyField,
  startedAt: z.number().int().nonnegative(),
  website: honeypotField.default(''),
};

export const REQUEST_DEMO_INTERESTS = [
  'pro_enterprise',
  'professional_services',
  'custom_ai_training',
  'ai_hardware',
] as const;

export const requestDemoSchema = z.object({
  ...baseFields,
  phone: phoneField,
  company: optionalString,
  interests: z.array(z.enum(REQUEST_DEMO_INTERESTS)).default([]),
  message: optionalString,
});

export const contactSchema = z.object({
  ...baseFields,
  company: optionalString,
  message: z
    .string()
    .trim()
    .min(10, { message: 'Tell us a bit more (10+ characters)' })
    .max(2000, { message: 'Too long' })
    .transform(sanitize),
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
