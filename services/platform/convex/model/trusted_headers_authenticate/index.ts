/**
 * Trusted headers authenticate model - central export point.
 *
 * This module contains business logic for handling users and sessions
 * when authenticating via trusted headers (e.g. Authelia, Authentik).
 */

export * from './find_or_create_user_from_headers';
export * from './create_session_for_trusted_user';
export * from './get_user_by_id';
export * from './trusted_headers_authenticate';
export * from './resolve_team_names';
