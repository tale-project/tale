/** True for an `http(s)://` URL string; false for any non-string or other scheme. */
export function isHttpUrl(href: unknown): boolean {
  return (
    typeof href === 'string' &&
    (href.startsWith('http://') || href.startsWith('https://'))
  );
}
