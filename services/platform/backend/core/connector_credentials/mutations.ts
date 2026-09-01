import { AppError } from '../../../lib/shared/errors/app-error';

/**
 * Canonical form of a per-credential API origin: https, no trailing slash,
 * and nothing after the host. Live bodies build every URL by appending to
 * `ctx.endpoint`, so a stored path (or query, or fragment) would silently
 * produce a wrong — possibly attacker-chosen — request URL.
 */
export function normalizeEndpointOrigin(raw: string): string {
  const value = raw.trim();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AppError({
      code: 'CREDENTIAL_ENDPOINT_INVALID',
      message: `Endpoint "${value}" is not a URL — enter the API origin, e.g. https://your-site.atlassian.net.`,
      userMessage: `Endpoint "${value}" is not a valid URL — enter the API origin, e.g. https://your-site.atlassian.net.`,
    });
  }
  if (url.protocol !== 'https:') {
    throw new AppError({
      code: 'CREDENTIAL_ENDPOINT_INVALID',
      message: `Endpoint "${value}" must use https.`,
      userMessage: `Endpoint "${value}" must use https.`,
    });
  }
  if (url.username !== '' || url.password !== '') {
    throw new AppError({
      code: 'CREDENTIAL_ENDPOINT_INVALID',
      message: `Endpoint "${value}" must not embed credentials — store them on the credential itself.`,
      userMessage: `Endpoint "${value}" must not embed credentials — store them on the credential itself.`,
    });
  }
  const hasPath = url.pathname !== '' && url.pathname !== '/';
  if (hasPath || url.search !== '' || url.hash !== '') {
    throw new AppError({
      code: 'CREDENTIAL_ENDPOINT_INVALID',
      message: `Endpoint "${value}" must be an origin only — drop everything after the host (e.g. https://${url.host}).`,
      userMessage: `Endpoint "${value}" must be an origin only — drop everything after the host (e.g. https://${url.host}).`,
    });
  }
  return url.origin;
}
