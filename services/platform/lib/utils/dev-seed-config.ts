/**
 * Gating + identity resolution for the dev-login seeder
 * (`backend/domains/provisioning/dev-seed.ts`). Pure and dependency-free so
 * the rules (flag spellings, loopback-only, credential overrides) are
 * unit-testable on their own, and so the seeder itself stays a thin wrapper
 * over the Better Auth calls it makes.
 */

/** Mirrors the e2e convention (`TaleE2E!Passw0rd`): satisfies the default
 * password policy (length/lower/upper/digit/special). Insecure by design —
 * it guards a loopback-only dev stack, same threat model as the
 * `x-dev-secrets` defaults in compose.dev.yml. */
export const DEV_SEED_DEFAULT_EMAIL = 'dev@tale.test';
export const DEV_SEED_DEFAULT_PASSWORD = 'TaleDev!Passw0rd';

/** Opt-out spellings shared with the other dev toggles (SANDBOX_BROWSER_VIEW,
 * TALE_DEV_HOT_RELOAD): any of these disables the flag. */
const FALSY_FLAG_VALUES = new Set(['0', 'false', 'no', 'off']);

/** Same loopback list as the backend's HTTPS guard (backend/auth/auth.ts). */
const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

type DevSeedConfig =
  | {
      enabled: true;
      email: string;
      password: string;
      usesDefaultPassword: boolean;
    }
  | { enabled: false; reason: string };

/**
 * Resolve the seed configuration from an env map.
 */
export function resolveDevSeedConfig(
  env: Record<string, string | undefined>,
): DevSeedConfig {
  const flag = env.TALE_DEV_SEED_USER?.trim().toLowerCase();
  if (!flag || FALSY_FLAG_VALUES.has(flag)) {
    return { enabled: false, reason: 'TALE_DEV_SEED_USER is not enabled' };
  }

  // Loopback-only: a known password on a reachable hostname is an account
  // takeover, not a convenience. SITE_URL is the production signal here for
  // the same reason as the backend auth HTTPS guard.
  const siteUrl = env.SITE_URL || 'http://127.0.0.1:3000';
  let hostname: string;
  try {
    hostname = new URL(siteUrl).hostname;
  } catch {
    return {
      enabled: false,
      reason: `SITE_URL is not a valid URL: ${siteUrl}`,
    };
  }
  if (!LOOPBACK_HOSTNAMES.has(hostname)) {
    return {
      enabled: false,
      reason: `SITE_URL host "${hostname}" is not loopback — refusing to seed a known dev password`,
    };
  }

  const password = env.TALE_DEV_SEED_USER_PASSWORD || DEV_SEED_DEFAULT_PASSWORD;
  return {
    enabled: true,
    email: (env.TALE_DEV_SEED_USER_EMAIL || DEV_SEED_DEFAULT_EMAIL)
      .toLowerCase()
      .trim(),
    password,
    usesDefaultPassword: password === DEV_SEED_DEFAULT_PASSWORD,
  };
}
