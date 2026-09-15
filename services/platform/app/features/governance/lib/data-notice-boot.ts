/**
 * The loading skeleton's memory of the confidentiality notice.
 *
 * The notice sits under the chat composer, so whether it shows decides where
 * the composer sits. The composer placeholder — baked into the served boot
 * shell and rendered while access resolves — paints before any policy read
 * can answer, so it would leave no room for the notice and the live composer
 * would shift up by the notice's height when it mounts. Instead, the last
 * notice this device showed for an org is remembered here, and the
 * pre-hydration script in `index.html` hands it to the placeholder before
 * first paint:
 *
 * - `localStorage[chat-data-notice-<orgId>]` holds the notice text as a CSS
 *   string literal, present only while the notice shows. Org-scoped rather
 *   than user-scoped because the script runs before auth, like the chat
 *   panel's `chat-history-panel-open-<orgId>`.
 * - The script copies it to the `--boot-chat-notice` custom property on
 *   `<html>` and adds the `boot-chat-notice` class; `ChatComposerPlaceholder`
 *   reveals its notice row on the class and sizes the row by rendering that
 *   property as generated content, so the row wraps exactly like the live
 *   notice at every width — without the served shell carrying any text.
 *
 * The value is stored pre-escaped so the inline script stays a plain copy.
 */

const KEY_PREFIX = 'chat-data-notice-';
const BOOT_CLASS = 'boot-chat-notice';
const BOOT_PROPERTY = '--boot-chat-notice';

export function dataNoticeBootKey(organizationId: string): string {
  return `${KEY_PREFIX}${organizationId}`;
}

/**
 * Quote `text` as a CSS string literal. Every character outside
 * `[A-Za-z0-9 ]` becomes a hex escape, so quotes, backslashes and any other
 * syntax in an admin's text stay inert; runs of whitespace collapse to one
 * space, matching how the live notice renders them.
 */
export function toCssString(text: string): string {
  const escaped = Array.from(text.replaceAll(/\s+/g, ' ').trim(), (char) =>
    /^[A-Za-z0-9 ]$/.test(char)
      ? char
      : `\\${(char.codePointAt(0) ?? 0).toString(16)} `,
  ).join('');
  return `"${escaped}"`;
}

function applyBootMarker(value: string | null): void {
  const root = document.documentElement;
  if (value === null) {
    root.classList.remove(BOOT_CLASS);
    root.style.removeProperty(BOOT_PROPERTY);
    return;
  }
  root.classList.add(BOOT_CLASS);
  root.style.setProperty(BOOT_PROPERTY, value);
}

/**
 * The notice this device last showed for an org, as the stored CSS string
 * literal, or `null` when it showed none (or storage is unavailable).
 */
export function readRememberedDataNotice(
  organizationId: string,
): string | null {
  const key = dataNoticeBootKey(organizationId);
  try {
    return window.localStorage.getItem(key);
  } catch (error) {
    console.warn(`Failed to read the remembered data notice "${key}":`, error);
    return null;
  }
}

/**
 * Record what the chat showed for an org: the notice text, or `null` when no
 * notice showed. Updates the stored value the next page load reads, and the
 * live `<html>` marker, so a placeholder rendered later in this page session
 * agrees with the notice on screen.
 */
export function rememberDataNotice(
  organizationId: string,
  message: string | null,
): void {
  const value = message === null ? null : toCssString(message);
  applyBootMarker(value);
  const key = dataNoticeBootKey(organizationId);
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch (error) {
    console.warn(`Failed to remember the data notice for "${key}":`, error);
  }
}

/** Drop the live `<html>` marker; the stored value stays for the next load. */
export function clearDataNoticeBootMarker(): void {
  applyBootMarker(null);
}
