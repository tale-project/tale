import { z } from 'zod';

import { SECRET_KINDS } from '@/lib/api/schemas';

import { problemsOf, type FormValues } from './form';

/** What each refusal says to the person, in their language. */
export interface FormMessages {
  titleRequired: string;
  titleTooLong: string;
  labelRequired: string;
  labelTooLong: string;
  valueTooLong: (label: string) => string;
  noValues: string;
  tooMany: string;
}

const rowSchema = z.object({
  template: z.string().nullable(),
  multiline: z.boolean(),
  label: z.string(),
  value: z.string(),
  hidden: z.boolean(),
  decided: z.boolean(),
});

/**
 * The form's rules for `react-hook-form`: `problemsOf` finds what the server
 * would refuse, this words it beside the field it belongs to. The two
 * refusals of the whole form (no value at all, too many) sit under `rows.root`
 * and keep the form from submitting; the form words them itself.
 */
export function secretFormSchema(
  messages: FormMessages,
): z.ZodType<FormValues, FormValues> {
  return z
    .object({
      kind: z.enum(SECRET_KINDS),
      title: z.string(),
      scope: z.string(),
      rows: z.array(rowSchema),
    })
    .superRefine((values, ctx) => {
      const problems = problemsOf(values);
      if (problems.title !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['title'],
          message: messages[problems.title],
        });
      }
      problems.rows.forEach((row, index) => {
        if (row.label !== undefined) {
          ctx.addIssue({
            code: 'custom',
            path: ['rows', index, 'label'],
            message: messages[row.label],
          });
        }
        if (row.value !== undefined) {
          ctx.addIssue({
            code: 'custom',
            path: ['rows', index, 'value'],
            message: messages.valueTooLong(values.rows[index].label.trim()),
          });
        }
      });
      if (problems.noValues) {
        ctx.addIssue({
          code: 'custom',
          path: ['rows', 'root'],
          message: messages.noValues,
        });
      }
      if (problems.tooMany) {
        ctx.addIssue({
          code: 'custom',
          path: ['rows', 'root'],
          message: messages.tooMany,
        });
      }
    });
}
