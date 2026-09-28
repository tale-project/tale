import { isHttpUrl } from './utils/url';

const ENV_KEY = 'TALE_CONTACT_SUPPORT_URL';

/**
 * The deployment's own support page (`TALE_CONTACT_SUPPORT_URL`), handed to
 * the SPA through `window.__ENV__` for the error displays' "contact support"
 * link. `undefined` when unset or blank, and when the value is not an
 * absolute `http(s)` URL — that one is logged and ignored, so the displays
 * keep their `https://tale.dev/contact` default instead of a broken or
 * `javascript:` link.
 *
 * The answer is the parsed URL's serialization, in which the parser has
 * percent-encoded `<`, `>` and quotes. That alone does not make it safe to
 * embed: `$` and backticks stay as written, so the web tier splices it into
 * the inline `__ENV__` script through `lib/utils/inline-script.ts`, like
 * every other runtime value.
 */
export function parseContactSupportUrl(
  raw: string | undefined = process.env[ENV_KEY],
): string | undefined {
  const value = raw?.trim();
  if (!value) return undefined;
  if (!isHttpUrl(value)) {
    console.warn(
      `Ignoring ${ENV_KEY}: not an absolute http(s) URL; the contact-support link keeps its default.`,
    );
    return undefined;
  }
  return new URL(value).href;
}
