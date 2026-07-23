/**
 * An automation name in a URL.
 *
 * An automation's name IS its path — `billing/dunning-reminder` — but the
 * detail route addresses it with a single `$automationSlug` segment, so the
 * separator travels as `__`. The round-trip is lossless because a name's
 * grammar (`^[a-z0-9]+(?:[-_][a-z0-9]+)*(?:/…)*$`) allows only SINGLE
 * underscores inside a segment: every `_` must be followed by an alphanumeric,
 * so a doubled one can never occur in a valid name.
 */

/** `billing/dunning-reminder` → `billing__dunning-reminder`. */
export function automationSlugToParam(name: string): string {
  return name.replaceAll('/', '__');
}

/** `billing__dunning-reminder` → `billing/dunning-reminder`. */
export function paramToAutomationSlug(param: string): string {
  return param.replaceAll('__', '/');
}
