/**
 * An automation name in a URL.
 *
 * An automation's name IS its path — `billing/dunning-reminder` — but both the
 * app's `$automationSlug` route param and the REST API's path segment address
 * it as a single segment, so the separator travels as `__`. The round-trip is
 * lossless because a name's grammar (`^[a-z0-9]+(?:[-_][a-z0-9]+)*(?:/…)*$`)
 * allows only SINGLE underscores inside a segment: every `_` must be followed
 * by an alphanumeric, so a doubled one can never occur in a valid name.
 *
 * This is the one codec — the router and the REST surface both import it, so
 * an address minted by one side always resolves on the other.
 */

/** `billing/dunning-reminder` → `billing__dunning-reminder`. */
export function automationSlugToParam(name: string): string {
  return name.replaceAll('/', '__');
}

/** `billing__dunning-reminder` → `billing/dunning-reminder`. */
export function paramToAutomationSlug(param: string): string {
  return param.replaceAll('__', '/');
}
