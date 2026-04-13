import { randomBytes } from 'node:crypto';

const MAX_PREFIX_LENGTH = 33;
const HEX_SUFFIX_LENGTH = 6;
const FALLBACK_PREFIX = 'tale';

const VALID_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Sanitize a directory basename into a Docker-safe prefix.
 * Applied rules: lowercase, replace non-[a-z0-9] with `-`, collapse
 * consecutive `-`, strip leading/trailing `-`, truncate to 33 chars, then
 * re-strip trailing `-`. If the result is empty (e.g., CJK/emoji directory),
 * fall back to 'tale'.
 */
export function sanitizePrefix(dirBasename: string): string {
  let name = dirBasename.toLowerCase().replace(/[^a-z0-9]/g, '-');
  name = name.replace(/-{2,}/g, '-');
  name = name.replace(/^-+|-+$/g, '');
  if (name.length > MAX_PREFIX_LENGTH) {
    name = name.slice(0, MAX_PREFIX_LENGTH).replace(/-+$/, '');
  }
  return name.length === 0 ? FALLBACK_PREFIX : name;
}

/**
 * Generate a project ID of the form `{sanitized-name}-{6-hex}`.
 * The hex suffix provides collision resistance when two directories share
 * the same sanitized basename on the same machine.
 */
export function generateProjectId(dirBasename: string): string {
  const prefix = sanitizePrefix(dirBasename);
  const hex = randomBytes(Math.ceil(HEX_SUFFIX_LENGTH / 2))
    .toString('hex')
    .slice(0, HEX_SUFFIX_LENGTH);
  const id = `${prefix}-${hex}`;
  if (!VALID_ID_PATTERN.test(id)) {
    // This should be unreachable given the sanitization rules, but validate
    // defensively — Docker would otherwise reject the name with a cryptic error.
    throw new Error(
      `Generated project ID "${id}" is invalid. Expected pattern ${VALID_ID_PATTERN}.`,
    );
  }
  return id;
}

/** Validate that an ID string conforms to Docker naming rules. */
export function isValidProjectId(id: string): boolean {
  return VALID_ID_PATTERN.test(id) && id.length > 0 && id.length <= 40;
}
