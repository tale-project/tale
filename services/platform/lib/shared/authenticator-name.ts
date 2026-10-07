import { z } from 'zod';

/**
 * What an authenticator app calls a Tale account, and what a download of its
 * backup codes is named after: the client the deployment serves, the product
 * and the environment, as in `Acme Tale Platform TE`. Production (`PR`) and
 * an unset environment add no environment, so `Acme Tale Platform` is the
 * client's production deployment. Tale's own deployments, and any deployment
 * that names no client, read `Tale Platform`.
 *
 * The backend names new TOTP enrollments with it (`backend/auth/auth.ts`), and
 * the web tier hands the same two settings to the page through
 * `window.__ENV__` (`lib/authenticator-env.ts`), so a saved backup-codes file
 * and the authenticator entry it belongs to say the same thing.
 */
const PRODUCT = { name: 'Tale Platform', fileSlug: 'tale-platform' } as const;

/** The production environment, which the name leaves out. */
const PRODUCTION = 'PR';

/**
 * `TOTP_CLIENT_NAME`: the client as people write it (`Acme`, `Example plus`).
 * Surrounding whitespace is dropped and inner runs collapse to one space. A
 * colon can never pass, because authenticator apps split an entry's label on
 * it.
 */
export const totpClientNameSchema = z
  .string()
  .transform((value) => value.trim().replace(/\s+/g, ' '))
  .pipe(
    z
      .string()
      .regex(
        /^[\p{L}\p{N}][\p{L}\p{N} &'.+-]{0,39}$/u,
        "TOTP_CLIENT_NAME must be a client name of 1 to 40 letters, digits, spaces or & ' . + -",
      ),
  )
  .optional();

/** `TOTP_ENVIRONMENT`: a deployment label (`pr`, `te`), never an origin. */
export const totpEnvironmentSchema = z
  .string()
  .trim()
  .regex(
    /^[a-z0-9][a-z0-9_-]{0,31}$/i,
    'TOTP_ENVIRONMENT must be an environment label of 1 to 32 letters, digits, underscores or hyphens',
  )
  .transform((value) => value.toUpperCase())
  .optional();

export interface AuthenticatorName {
  /** The entry an authenticator app lists: `Acme Tale Platform TE`. */
  issuer: string;
  /** The same words for a file name: `acme-tale-platform-te`. */
  fileSlug: string;
}

/**
 * A client whose name the product already starts with (`Tale`) is not
 * repeated: Tale's own deployment is `Tale Platform`, not `Tale Tale Platform`.
 */
function namesProduct(client: string): boolean {
  const product = PRODUCT.name.toLowerCase();
  const name = client.toLowerCase();
  return product === name || product.startsWith(`${name} `);
}

/**
 * The client as one lower-case word of ASCII letters and digits, as the
 * client platforms spell it in their own file names (`Example plus` is
 * `exampleplus`). Empty when nothing of the name survives.
 */
function fileWord(client: string): string {
  return client
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Throws on a client name or environment the schemas above refuse, so a
 * misconfigured deployment cannot hand out entries named after a typo.
 */
export function authenticatorName(deployment: {
  clientName?: string;
  environment?: string;
}): AuthenticatorName {
  const clientName = totpClientNameSchema.parse(deployment.clientName);
  const environment = totpEnvironmentSchema.parse(deployment.environment);
  const client =
    clientName === undefined || namesProduct(clientName)
      ? undefined
      : clientName;
  const shownEnvironment = environment === PRODUCTION ? undefined : environment;
  return {
    issuer: [client, PRODUCT.name, shownEnvironment]
      .filter((part) => part !== undefined)
      .join(' '),
    fileSlug: [
      client === undefined ? '' : fileWord(client),
      PRODUCT.fileSlug,
      shownEnvironment?.toLowerCase() ?? '',
    ]
      .filter((part) => part !== '')
      .join('-'),
  };
}
