import { z } from 'zod';

/** The i18n keys (`products.edit.validation.*`) a refused amount resolves to. */
export interface ProductNumberMessages {
  number: string;
  nonNegative: string;
  tooLarge: string;
  /** Required for a count (stock); an amount (price) takes decimals. */
  integer?: string;
}

/**
 * The form's rule for a price or a stock count, as the string a number input
 * holds: blank is "not given"; otherwise a finite number, zero or more, within
 * the safe-integer range the door stores exactly — a stock count a whole
 * number. The door itself accepts signed values (an API caller may book a
 * correction); the form refuses them at the step, not in a toast after Review.
 */
export function productNumberSchema(messages: ProductNumberMessages) {
  return z
    .string()
    .trim()
    .superRefine((value, ctx) => {
      if (value === '') return;
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) {
        ctx.addIssue({ code: 'custom', message: messages.number });
        return;
      }
      if (parsed < 0) {
        ctx.addIssue({ code: 'custom', message: messages.nonNegative });
        return;
      }
      if (parsed > Number.MAX_SAFE_INTEGER) {
        ctx.addIssue({ code: 'custom', message: messages.tooLarge });
        return;
      }
      if (messages.integer !== undefined && !Number.isInteger(parsed)) {
        ctx.addIssue({ code: 'custom', message: messages.integer });
      }
    });
}
