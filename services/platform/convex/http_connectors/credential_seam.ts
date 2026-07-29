/**
 * The one seam between the OAuth2 callback and the connector-credentials
 * domain.
 *
 * Secret material is that domain's business: it owns the AES-256-GCM envelope,
 * the masked preview, the default-credential rules and the status vocabulary.
 * This route's job ends at "here are the tokens the vendor granted, for this
 * organization" — so the handover is a single narrow call, declared here with
 * the argument shape it depends on and nothing else.
 *
 * The reference is built by name rather than through the generated `internal`
 * tree (the pattern `trusted_headers_auth` uses) so this module compiles
 * against the CONTRACT rather than against whatever the credentials domain
 * happens to export at any moment. If that action moves or is renamed, one
 * string below changes.
 */

import { makeFunctionReference } from 'convex/server';

/**
 * What the credentials domain needs to persist an authorization-code grant.
 * A plain `type` (not an `interface`) so it satisfies `makeFunctionReference`'s
 * `Args extends DefaultFunctionArgs` constraint — TypeScript infers the
 * implicit string index signature only for object-literal type aliases.
 */
export type StoreOauth2CredentialArgs = {
  /** The organization the pending-state row was minted for — never the request. */
  organizationId: string;
  connectorSlug: string;
  /** Better Auth user id of whoever completed the consent flow. */
  createdBy: string;
  /** Human label for the credential list. */
  name: string;
  accessToken: string;
  refreshToken?: string;
  /** Absolute epoch-ms expiry of the access token, when the vendor gave one. */
  expiresAt?: number;
  /** Scopes the vendor actually granted. */
  scopes: string[];
};

export type StoreOauth2CredentialResult = {
  credentialId: string;
};

/**
 * The credentials-domain action that encrypts the grant into the credential
 * row's single `encryptedData` envelope and returns the row id.
 *
 * It takes `createdBy` explicitly rather than reading the caller's identity:
 * the OAuth callback is a front-channel redirect from the vendor and carries no
 * Convex identity, so the user was authenticated and authorized at `start`
 * time and recorded on the pending-authorization row. Anything that derives
 * authority from the callback request instead would be forgeable.
 */
export const STORE_OAUTH2_CREDENTIAL_PATH =
  'connector_credentials/actions:storeOauth2Credential';

export const storeOauth2CredentialRef = makeFunctionReference<
  'action',
  StoreOauth2CredentialArgs,
  StoreOauth2CredentialResult
>(STORE_OAUTH2_CREDENTIAL_PATH);
