import { ConvexError } from 'convex/values';

import {
  SUPPORTED_LOCALES,
  isSupportedLocale,
} from '../../lib/shared/constants/locales';

/**
 * Hard check for product-translation locales — throws a structured
 * `ConvexError` on any value outside {@link SUPPORTED_LOCALES}.
 *
 * The mutation argument validators (`productLocaleValidator`) already reject
 * unknown locales at the Convex boundary; this guard is defence-in-depth for
 * the exported helpers, which are reachable from internal callers and tests
 * that bypass that boundary.
 */
export function assertSupportedProductLocale(language: string): void {
  if (!isSupportedLocale(language)) {
    throw new ConvexError({
      code: 'invalid_locale',
      message:
        `Unsupported translation language "${language}". ` +
        `Supported locales: ${SUPPORTED_LOCALES.join(', ')}.`,
    });
  }
}
