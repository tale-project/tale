/**
 * Flatten untrusted text into a single safe path segment. User-authored names
 * (document titles, attachment file names) become path leaves in the sandbox
 * workspace — a separator or dot-navigation inside one must never add or
 * climb path levels (the daemon confines writes to `/user`, not to the
 * caller's mount, so an unsanitized `../../output/x` leaf would land in the
 * harvest box as a forged deliverable). Separators flatten to `_`; a name
 * that degenerates to nothing (or to `.`/`..`) becomes the fallback.
 */
export function safePathSegment(raw: string, fallback = 'file'): string {
  const name = raw.replace(/[\\/]/g, '_').trim();
  if (name === '' || name === '.' || name === '..') return fallback;
  return name;
}
