export const MICROSOFT_LOGIN_BASE = 'https://login.microsoftonline.com';
export const MICROSOFT_GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

export const DEFAULT_SCOPES = ['openid', 'profile', 'email', 'offline_access'];

/**
 * Graph file scopes belong on Knowledge cloud-import OAuth, never on SSO
 * authorize. Strip both short and fully-qualified forms so a legacy Scopes
 * field or enableOneDriveAccess config cannot reattach them to sign-in.
 */
const SSO_EXCLUDED_FILE_SCOPES = new Set([
  'Files.Read',
  'https://graph.microsoft.com/Files.Read',
  'Sites.Read.All',
  'https://graph.microsoft.com/Sites.Read.All',
]);

export function withoutGraphFileScopes(scopes: readonly string[]): string[] {
  return scopes.filter((scope) => !SSO_EXCLUDED_FILE_SCOPES.has(scope));
}

/**
 * The canonical, actionable message every "bad Entra issuer" failure funnels
 * through. Kept as a single constant so the config form, the connection test,
 * and the sign-in path all read identically (and so a test can assert on it).
 */
export const ENTRA_ISSUER_HELP =
  'Issuer must be https://login.microsoftonline.com/{tenant-id}/v2.0';

/**
 * Thrown when an Entra issuer cannot be resolved to a concrete tenant. Carrying
 * a distinct type lets callers (validateConfig, the authorize/token paths) map
 * it to a clear "fix your Issuer URL" message instead of a silent fallback that
 * a single-tenant app then rejects with an opaque AADSTS error.
 */
export class EntraIssuerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EntraIssuerError';
  }
}

// A GUID (with or without hyphens) — the Directory (tenant) ID as shown on the
// app-registration Overview page. Also the shape Microsoft accepts directly as
// the `{tenant}` path segment.
const GUID_RE =
  /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;
// The named-tenant forms Microsoft also accepts as a `{tenant}` segment
// (`contoso.onmicrosoft.com`, or the well-known `common`/`organizations`/
// `consumers` endpoints). We keep these as-is rather than forcing a GUID.
const NAMED_TENANT_RE = /^[a-z0-9-]+\.onmicrosoft\.com$/i;
const WELL_KNOWN_TENANTS = new Set(['common', 'organizations', 'consumers']);

function isValidTenantSegment(segment: string): boolean {
  return (
    GUID_RE.test(segment) ||
    NAMED_TENANT_RE.test(segment) ||
    WELL_KNOWN_TENANTS.has(segment.toLowerCase())
  );
}

/**
 * Resolve the `{tenant}` path segment for the Microsoft login endpoints from a
 * configured issuer.
 *
 * Accepts, and NEVER silently degrades to `common` (which a single-tenant app —
 * the registration our own docs tell admins to create — then rejects):
 *  - a v2 issuer `https://login.microsoftonline.com/{tenant}/v2.0` → `{tenant}`
 *  - a bare Directory (tenant) ID GUID → that GUID
 *
 * Rejects with an actionable {@link EntraIssuerError}:
 *  - a v1 `https://sts.windows.net/{tenant}/` issuer (wrong endpoint version)
 *  - any other value (empty, a non-Microsoft host, a bare `common`, junk)
 */
export function extractTenantId(issuer: string): string {
  const trimmed = issuer.trim();
  if (!trimmed) {
    throw new EntraIssuerError(`Issuer URL is required. ${ENTRA_ISSUER_HELP}`);
  }

  // A bare Directory (tenant) ID → normalize to that tenant. Admins routinely
  // paste the GUID from the Overview page; accept it rather than falling back
  // to `common`.
  if (GUID_RE.test(trimmed)) {
    return trimmed;
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new EntraIssuerError(
      `"${issuer}" is not a valid Issuer URL. ${ENTRA_ISSUER_HELP}`,
    );
  }

  const host = url.hostname.toLowerCase();

  // v1 issuer — the STS endpoint. A single-tenant v2 app rejects tokens minted
  // for the v1 endpoint, so fail loudly instead of degrading to `common`.
  if (host === 'sts.windows.net') {
    throw new EntraIssuerError(
      `"${issuer}" is a v1 (sts.windows.net) issuer. ${ENTRA_ISSUER_HELP}`,
    );
  }

  if (host !== 'login.microsoftonline.com') {
    throw new EntraIssuerError(
      `"${issuer}" is not a Microsoft Entra issuer. ${ENTRA_ISSUER_HELP}`,
    );
  }

  const segment = url.pathname.split('/').find(Boolean);
  if (!segment || !isValidTenantSegment(segment)) {
    throw new EntraIssuerError(
      `Could not read a tenant from "${issuer}". ${ENTRA_ISSUER_HELP}`,
    );
  }

  return segment;
}
