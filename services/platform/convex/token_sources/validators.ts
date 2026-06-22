/** Pure (V8-safe) validators for the token-sources config domain. */

const TOKEN_SOURCE_SLUG_REGEX = /^[a-z0-9][a-z0-9_-]{0,99}$/;

export function validateTokenSourceSlug(slug: string): boolean {
  return TOKEN_SOURCE_SLUG_REGEX.test(slug);
}
