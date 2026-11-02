import { ApiError } from '@/app/lib/api/client';
import { failureText } from '@/app/lib/api/failure';
import { i18n } from '@/lib/i18n/i18n';

/**
 * How the app words a refusal of the backend, in the language shown now. A test
 * of the page that tells a refusal asserts this and not the sentence itself,
 * which the catalog's owner words and rewords (`errors.yml`).
 */
export function errorText(
  code: string,
  extra: Record<string, unknown> = {},
): string {
  return failureText(
    new ApiError(0, code, '', extra),
    i18n.getFixedT(i18n.language, 'errors'),
  );
}
