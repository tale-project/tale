import { z } from 'zod';

/** The generic OpenID Connect sign-in a managed deployment can declare beside
 * Entra: the field shapes the declaration and the private provisioning input
 * share, and how a stored connection is recognised as the managed one. */

/** The backend's provider id for a standards-based OpenID Connect connection. */
export const OIDC_PROVIDER_ID = 'generic-oidc';
export const OIDC_DEFAULT_DISPLAY_NAME = 'OpenID Connect';
export const OIDC_DEFAULT_SCOPES = ['openid', 'profile', 'email'];

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** An issuer in the one form the backend stores and compares it by: an HTTPS
 * origin and optional path without a trailing slash, query or fragment.
 * Plain HTTP is accepted for a loopback address only, so a deployment never
 * sends people to a provider over an unencrypted hop. */
function isIssuerUrl(input: string): boolean {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return false;
  }
  if (url.username || url.password || /[?#]/.test(input)) return false;
  const canonical = url.origin + (url.pathname === '/' ? '' : url.pathname);
  if (input !== canonical) return false;
  return (
    url.protocol === 'https:' ||
    (url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname))
  );
}

const printable = /^[^\x00-\x1f\x7f]+(?![\s\S])/;
export const oidcIssuer = z
  .string()
  .max(512)
  .refine(isIssuerUrl, 'expected a canonical HTTPS issuer URL');
const displayName = z
  .string()
  .min(1)
  .max(200)
  .regex(printable)
  .refine((input) => input.trim() === input);
// One OAuth scope token: printable ASCII without space, quote or backslash.
const scope = z
  .string()
  .max(200)
  .regex(/^[\x21\x23-\x5b\x5d-\x7e]+(?![\s\S])/);
const claimPath = z.string().min(1).max(200).regex(printable);
const claimMappings = z
  .strictObject({
    email: claimPath.optional(),
    name: claimPath.optional(),
    groups: claimPath.optional(),
  })
  .refine(
    (mappings) => Object.values(mappings).some((path) => path !== undefined),
    'declare at least one claim mapping or omit the block',
  );

/** Everything about the connection that is not a credential, as declared. */
export const oidcOptionalFields = {
  displayName: displayName.optional(),
  scopes: z.array(scope).min(1).max(50).optional(),
  pkce: z.boolean().optional(),
  claimMappings: claimMappings.optional(),
  /** The operator vouches for the mapped email claim, so a sign-in marks the
   * address verified. Only the mapped claim is ever vouched for. */
  trustEmail: z.boolean().optional(),
};

/** The address a person is matched by is only vouched for when the claim that
 * carries it is the one the declaration names: a plain `email` claim may be
 * one the person edited at the provider. */
export function trustsUnmappedEmail(oidc: {
  trustEmail?: boolean | undefined;
  claimMappings?: { email?: string | undefined } | undefined;
}): boolean {
  return oidc.trustEmail === true && !oidc.claimMappings?.email;
}

interface DeclaredOidc {
  displayName?: string | undefined;
  /** Literal in the bundle, or a reference that only the destination resolves. */
  issuer: string | object;
  scopes?: string[] | undefined;
  pkce?: boolean | undefined;
  claimMappings?:
    | {
        email?: string | undefined;
        name?: string | undefined;
        groups?: string | undefined;
      }
    | undefined;
  trustEmail?: boolean | undefined;
}

/** Whether the connection the private input asks for is the one the reviewed
 * bundle declares. Credentials are the destination's own; everything public
 * must match, and an issuer the bundle leaves to the environment is the
 * destination's choice. */
export function oidcMatchesDeclaration(
  declared: DeclaredOidc | undefined,
  supplied: Omit<DeclaredOidc, 'issuer'> & { issuer: string },
): boolean {
  if (!declared) return false;
  const same = (a: string[] | undefined, b: string[] | undefined) =>
    a === undefined || b === undefined
      ? a === b
      : a.length === b.length && a.every((entry, index) => entry === b[index]);
  return (
    (typeof declared.issuer !== 'string' ||
      declared.issuer === supplied.issuer) &&
    declared.displayName === supplied.displayName &&
    same(declared.scopes, supplied.scopes) &&
    declared.pkce === supplied.pkce &&
    declared.trustEmail === supplied.trustEmail &&
    declared.claimMappings?.email === supplied.claimMappings?.email &&
    declared.claimMappings?.name === supplied.claimMappings?.name &&
    declared.claimMappings?.groups === supplied.claimMappings?.groups
  );
}
