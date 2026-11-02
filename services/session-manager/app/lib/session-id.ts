import { idSchema } from '@/lib/api/schemas';

/**
 * The id a session's address names (`/sessions/12`), or null when the text is
 * no id: a number with signs, a fraction, an exponent or leading zeros names
 * no session, however the number reads.
 */
export function parseSessionId(text: string): number | null {
  if (!/^[1-9]\d*$/.test(text)) return null;
  const parsed = idSchema.safeParse(Number(text));
  return parsed.success ? parsed.data : null;
}
