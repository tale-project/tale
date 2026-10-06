/** Validate canonical metadata before it becomes an HTTP Link target. */
export function normalizeCanonicalUrl(value: unknown): string {
  const invalid = () =>
    new Error(
      'Artifact canonical URL must be an absolute HTTP(S) URL without credentials, fragments or control characters',
    );
  if (
    typeof value !== 'string' ||
    !/^https?:\/\//i.test(value) ||
    value.trim() !== value ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw invalid();
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalid();
  }
  if (
    (url.protocol !== 'https:' && url.protocol !== 'http:') ||
    url.username ||
    url.password ||
    url.href.includes('#')
  ) {
    throw invalid();
  }
  // URL serialization encodes Unicode, spaces and angle brackets, keeping
  // the URI inside its <...> delimiters without constructing raw headers.
  return url.href;
}

export function isCanonicalUrl(value: unknown): value is string {
  try {
    normalizeCanonicalUrl(value);
    return true;
  } catch {
    return false;
  }
}
