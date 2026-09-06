/**
 * The public base of the backend's `/http_api` lane — the origin-facing URL
 * the SSO, SAML metadata and SCIM handlers hand to identity providers. It is
 * `${SITE_URL}${BASE_PATH}/http_api`, which the proxy forwards to the
 * backend (the `/http_api` aliases are mounted in backend/app.ts).
 */
export function getPublicHttpApiUrl(): string {
  const siteUrl = process.env.SITE_URL;
  if (!siteUrl) {
    throw new Error('Missing required environment variable: SITE_URL');
  }
  const basePath = process.env.BASE_PATH ?? '';
  return `${siteUrl.replace(/\/$/, '')}${basePath}/http_api`;
}
