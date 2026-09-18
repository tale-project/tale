import type { TrustedHeaderNames } from '../../../lib/shared/schemas/trusted_headers.ts';

/**
 * The request headers the trusted-headers door reads, by their effective
 * names. The defaults are the `Remote-*` vocabulary authenticating proxies
 * (Authelia, Authentik, oauth2-proxy) speak; a deployment renames any of
 * them through the `TRUSTED_*_HEADER` environment variables. One reader for
 * the door AND the settings card, so what the card shows is what the door
 * reads.
 */
export function trustedHeaderNames(
  env: NodeJS.ProcessEnv = process.env,
): TrustedHeaderNames {
  return {
    key: env.TRUSTED_SECRET_HEADER || 'Remote-Internal-Secret',
    email: env.TRUSTED_EMAIL_HEADER || 'Remote-Email',
    name: env.TRUSTED_NAME_HEADER || 'Remote-Name',
    role: env.TRUSTED_ROLE_HEADER || 'Remote-Role',
    teams: env.TRUSTED_TEAMS_HEADER || 'Remote-Teams',
  };
}
