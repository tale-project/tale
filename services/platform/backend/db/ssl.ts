import { readFileSync } from 'node:fs';
import type { ConnectionOptions } from 'node:tls';

/**
 * ONE owner of how this deployment speaks TLS to Postgres.
 *
 * The backend reaches Postgres through two different drivers on the SAME
 * connection string — postgres.js for the app pool, the boot migrator and every
 * knowledge corpus, node-postgres (inside pg-boss) for the job queue — and left
 * to themselves they disagree about what that string means:
 *
 *  - postgres.js maps `sslmode` to a string it then interprets itself, and
 *    knows exactly one certificate source: `sslrootcert=system`. Its
 *    `verify-ca` also falls through to its `verify-full` branch, so it checks
 *    the hostname on a mode that is defined not to.
 *  - node-postgres parses the string with `pg-connection-string`, which reads
 *    `sslrootcert` as a FILE PATH — and, because `ConnectionParameters` merges
 *    the parsed connection string OVER the config object, its interpretation
 *    silently wins over any `ssl` option a caller passes alongside.
 *
 * So the URL is parsed here instead, exactly once: `sslmode` (and libpq's
 * certificate parameters) are read, stripped from the URL, and turned into an
 * explicit `ssl` option every driver gets handed. Both drivers then receive a
 * string with no TLS parameters left to reinterpret, and identical options.
 *
 * ## The certificate bundle
 *
 * `POSTGRES_CA_FILE` names a PEM file trusted for EVERY Postgres connection
 * this process opens — the app database, the deployment's knowledge corpus, and
 * the databases organizations bring themselves. It is deliberately deployment-
 * wide and deliberately a BUNDLE: managed Postgres providers sign with roots
 * Node does not ship (Amazon RDS is the common one), two organizations may be
 * on different providers, and concatenating their roots into one file is how
 * TLS trust stores have always worked. A per-connection `sslrootcert` in the
 * URL overrides it for that connection.
 *
 * ## Why an absent `sslmode` still means no TLS
 *
 * libpq defaults to `prefer`. This does not, because the deployment it has to
 * keep working is the bundled one, whose URL carries no `sslmode` and whose
 * Postgres serves no TLS on an in-network hop where TLS adds nothing. Only an
 * explicit `sslmode` changes what happens — which is what every external
 * database's URL carries anyway.
 */

/** libpq's modes, in the spelling a connection URL uses. */
const SSL_MODES = [
  'disable',
  'allow',
  'prefer',
  'require',
  'verify-ca',
  'verify-full',
] as const;

export type SslMode = (typeof SSL_MODES)[number];

/** The TLS parameters this module owns; stripped so no driver re-reads them. */
const TLS_URL_PARAMS = ['sslmode', 'sslrootcert'] as const;

export interface PostgresConnection {
  /** The connection string with every TLS parameter removed. */
  url: string;
  /** `false` for a plaintext connection, else options for `tls.connect`. */
  ssl: false | ConnectionOptions;
}

/** Parsed PEM bundles, keyed by path — a pool factory may resolve per pool. */
const caCache = new Map<string, string>();

/**
 * Read a PEM bundle, once per path.
 *
 * A configured-but-unreadable certificate is FATAL rather than a silent
 * downgrade: an operator who named a CA file asked for a verified connection,
 * and continuing without it would connect anyway and report nothing.
 */
function readCaBundle(file: string): string {
  const cached = caCache.get(file);
  if (cached !== undefined) return cached;
  let pem: string;
  try {
    pem = readFileSync(file, 'utf8');
  } catch (error: unknown) {
    throw new Error(
      `could not read the Postgres CA bundle at "${file}": ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  caCache.set(file, pem);
  return pem;
}

/** Test seam: forget every parsed bundle. */
export function clearPostgresCaCache(): void {
  caCache.clear();
}

function isSslMode(value: string): value is SslMode {
  return (SSL_MODES as readonly string[]).includes(value);
}

/**
 * Split a Postgres URL into the string the drivers should see and the TLS
 * options they should use.
 *
 * `sslrootcert=system` is libpq's "use the operating system's trust store",
 * which is what Node does with no `ca` at all.
 */
export function resolvePostgresConnection(
  rawUrl: string,
  env: Record<string, string | undefined> = process.env,
): PostgresConnection {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    // Not a URL we can pick apart (a libpq key/value DSN, say). Hand it back
    // untouched and let the driver do whatever it did before.
    return { url: rawUrl, ssl: false };
  }

  const rawMode = url.searchParams.get('sslmode')?.trim().toLowerCase() ?? '';
  const rootCert = url.searchParams.get('sslrootcert')?.trim();
  for (const param of TLS_URL_PARAMS) {
    url.searchParams.delete(param);
  }
  const cleaned = url.toString();

  if (rawMode === '') {
    return { url: cleaned, ssl: false };
  }
  if (!isSslMode(rawMode)) {
    throw new Error(
      `sslmode "${rawMode}" is not one of ${SSL_MODES.join(', ')}`,
    );
  }
  return { url: cleaned, ssl: sslOptionsFor(rawMode, rootCert, env) };
}

/**
 * The `tls.connect` options for one mode. Split out so the per-organization
 * lane — which holds its mode in a config field rather than a URL — resolves
 * TLS through the same rules.
 */
export function sslOptionsFor(
  mode: SslMode,
  rootCert?: string,
  env: Record<string, string | undefined> = process.env,
): false | ConnectionOptions {
  if (mode === 'disable') return false;

  const file =
    rootCert !== undefined && rootCert !== '' && rootCert !== 'system'
      ? rootCert
      : rootCert === 'system'
        ? undefined
        : env.POSTGRES_CA_FILE?.trim();
  const ca = file ? readCaBundle(file) : undefined;

  // `allow`, `prefer` and `require` encrypt without authenticating the server
  // — libpq's own semantics, and what postgres.js already did for them. An
  // operator who wants the server authenticated asks for `verify-ca` or
  // `verify-full` below; silently upgrading these three would refuse the
  // connections that work today against a self-signed in-cluster certificate.
  if (mode === 'allow' || mode === 'prefer' || mode === 'require') {
    // nosemgrep: tools.opengrep.rules.problem-based-packs.insecure-transport.js-node.bypass-tls-verification.bypass-tls-verification -- intentional: this IS libpq's definition of sslmode=require/prefer/allow (encrypt, do not authenticate); the verifying modes are the branches below, and which one applies is the operator's explicit choice in the connection URL
    return { rejectUnauthorized: false, ...(ca === undefined ? {} : { ca }) };
  }
  // `verify-ca` proves the certificate chains to a trusted root and stops
  // there — deliberately NOT checking the hostname, which is the whole
  // difference from `verify-full` and which postgres.js gets wrong.
  if (mode === 'verify-ca') {
    return {
      rejectUnauthorized: true,
      checkServerIdentity: () => undefined,
      ...(ca === undefined ? {} : { ca }),
    };
  }
  return { rejectUnauthorized: true, ...(ca === undefined ? {} : { ca }) };
}
