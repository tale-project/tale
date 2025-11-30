/**
 * Trusted headers authenticate model - central export point.
 *
 * This module contains business logic for handling users and sessions
 * when authenticating via trusted headers (e.g. Authelia, Authentik).
 */

export { findOrCreateUserFromHeaders } from './find_or_create_user_from_headers';
export type {
  FindOrCreateUserFromHeadersArgs,
  FindOrCreateUserFromHeadersResult,
} from './find_or_create_user_from_headers';

export { createSessionForTrustedUser } from './create_session_for_trusted_user';
export type {
  CreateSessionForTrustedUserArgs,
  CreateSessionForTrustedUserResult,
} from './create_session_for_trusted_user';

export { getUserById } from './get_user_by_id';
export type { BetterAuthUser } from './get_user_by_id';

export { trustedHeadersAuthenticate } from './trusted_headers_authenticate';
export type {
  TrustedHeadersAuthenticateArgs,
  TrustedHeadersAuthenticateResult,
} from './trusted_headers_authenticate';
