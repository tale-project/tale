import {
  totpClientNameSchema,
  totpEnvironmentSchema,
} from './shared/authenticator-name';

export interface AuthenticatorEnv {
  TOTP_CLIENT_NAME?: string;
  TOTP_ENVIRONMENT?: string;
}

/**
 * The two settings authenticator entries are named after (`TOTP_CLIENT_NAME`,
 * `TOTP_ENVIRONMENT`), normalized for `window.__ENV__` so the page names a
 * backup-codes download the way the backend names the entry
 * (`lib/shared/authenticator-name.ts`).
 *
 * The backend refuses to start on a value its schema refuses. The web tier
 * must not go down with it: such a value is logged and left out, and the page
 * falls back to the name an unset setting gives.
 */
export function parseAuthenticatorEnv(
  env: Record<string, string | undefined> = process.env,
): AuthenticatorEnv {
  const clientName = totpClientNameSchema.safeParse(env.TOTP_CLIENT_NAME);
  const environment = totpEnvironmentSchema.safeParse(env.TOTP_ENVIRONMENT);
  if (!clientName.success) {
    console.warn(
      "Ignoring TOTP_CLIENT_NAME: not a client name of 1 to 40 letters, digits, spaces or & ' . + -; backup-code downloads name no client.",
    );
  }
  if (!environment.success) {
    console.warn(
      'Ignoring TOTP_ENVIRONMENT: not an environment label of 1 to 32 letters, digits, underscores or hyphens; backup-code downloads name no environment.',
    );
  }
  return {
    TOTP_CLIENT_NAME: clientName.success ? clientName.data : undefined,
    TOTP_ENVIRONMENT: environment.success ? environment.data : undefined,
  };
}
