import type { ApiKey } from './types';

/** The masked key as its holder saw it: `start … suffix`. */
export function maskedKey(
  apiKey: Pick<ApiKey, 'start' | 'prefix' | 'suffix'>,
): string {
  const head = apiKey.start || apiKey.prefix;
  const tail = apiKey.suffix;
  return head ? (tail ? `${head} … ${tail}` : head) : tail ? `… ${tail}` : '-';
}
