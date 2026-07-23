/**
 * Frozen old-world contract for historical migrations — never evolve; deleted
 * when pre-rewrite upgrade support ends.
 *
 * Faithful copy of the retired `lib/shared/schemas/token_sources.ts`
 * (the pre-rewrite token-sources config format).
 * `v0_4_0/02_provider_credentials_from_files/migration.ts` validates each
 * org's `token-sources/<slug>.json` file against `tokenSourceSchema` (and its
 * `<slug>.secrets.json` sidecar against `tokenSourceSecretsSchema`) before
 * folding it into a `subscription-broker` provider credential, so the parse
 * behaviour must stay byte-identical to what the retired backend accepted.
 *
 * The retired runtime around these shapes (the rotation engine, the file
 * actions) is NOT frozen — the live successor is
 * `convex/provider_credentials/` and `lib/shared/schemas/providers.ts`'s
 * `brokerCredentialDataSchema`, which deliberately preserves these field
 * bounds so migrated configs convert losslessly.
 */

import { z } from 'zod/v4';

/** Reserved env-var namespace for a token source's broker auth secret. */
const TOKEN_SOURCE_SECRET_ENV_PREFIX = 'TALE_TOKEN_SOURCE_';
const TOKEN_SOURCE_SECRET_ENV_REGEX = new RegExp(
  `^${TOKEN_SOURCE_SECRET_ENV_PREFIX}[A-Za-z0-9_]+$`,
);

const TOKEN_SOURCE_SLUG_REGEX = /^[a-z0-9][a-z0-9_-]{0,99}$/;
const ENV_VAR_NAME_REGEX = /^[A-Za-z_][A-Za-z0-9_]*$/;

const secretEnvSchema = z
  .string()
  .max(60)
  .regex(
    TOKEN_SOURCE_SECRET_ENV_REGEX,
    'must start with TALE_TOKEN_SOURCE_ and contain only letters, digits, and underscores',
  );

/**
 * How to extract the token list from the broker's JSON response. `tokensPath`
 * is a minimal JSONPath (`$.a.b[0].c`) to the array; the remaining fields are
 * plain property names read off each array item.
 */
export const tokenSourceResponseMappingSchema = z.object({
  /** JSONPath to the token array, e.g. `$.tokens`. */
  tokensPath: z.string().min(1).max(200),
  /** Field on each item holding the token value, e.g. `access_token`. */
  tokenField: z.string().min(1).max(80),
  /** Optional field naming the item's status, e.g. `status`. */
  statusField: z.string().min(1).max(80).optional(),
  /** The status value that counts as usable, e.g. `active`. Requires statusField. */
  statusActiveValue: z.string().min(1).max(80).optional(),
  /** Optional field holding the expiry (ISO string or epoch ms/s), e.g. `expires_at`. */
  expiryField: z.string().min(1).max(80).optional(),
});

/**
 * How the broker request is authenticated. The secret VALUE is NOT stored
 * here: it lives either in an encrypted `<slug>.secrets.json` sidecar or —
 * for operator-provisioned sources — in the env var named by the optional
 * `secretEnv`.
 */
export const tokenSourceAuthSchema = z.discriminatedUnion('method', [
  z.object({ method: z.literal('none') }),
  z.object({
    method: z.literal('bearer'),
    secretEnv: secretEnvSchema.optional(),
  }),
  z.object({
    method: z.literal('header'),
    headerName: z.string().min(1).max(64),
    secretEnv: secretEnvSchema.optional(),
  }),
]);

/** Encrypted sidecar shape (`<slug>.secrets.json`): the one broker auth secret. */
export const tokenSourceSecretsSchema = z.object({
  authSecret: z.string().min(1),
});
export type TokenSourceSecrets = z.infer<typeof tokenSourceSecretsSchema>;

export const tokenSourceSchema = z.object({
  slug: z.string().regex(TOKEN_SOURCE_SLUG_REGEX),
  displayName: z.string().min(1).max(200),
  /** The broker endpoint to fetch the token pool from. */
  endpoint: z.string().url(),
  method: z.enum(['GET', 'POST']).default('GET'),
  auth: tokenSourceAuthSchema.default({ method: 'none' }),
  responseMapping: tokenSourceResponseMappingSchema,
  /** Sandbox env var the picked token is injected under, e.g. `CLAUDE_CODE_OAUTH_TOKEN`. */
  targetEnvVar: z.string().regex(ENV_VAR_NAME_REGEX).max(80),
  /** Pool selection strategy. `random` (default) picks uniformly per run. */
  selection: z.enum(['random', 'round-robin', 'first']).default('random'),
  timeoutMs: z.number().int().min(500).max(30_000).default(10_000),
  maxResponseBytes: z.number().int().min(1024).max(1_048_576).default(262_144),
  /** Drop tokens expiring within this many ms of now (clock + handoff slack). */
  expirySkewMs: z.number().int().min(0).max(3_600_000).default(300_000),
});
export type TokenSource = z.infer<typeof tokenSourceSchema>;

/** Re-exported for `token_sources_file_utils.ts`'s slug validation (the
 * retired `token_sources/validators.ts` shared this regex the same way). */
export { TOKEN_SOURCE_SLUG_REGEX };
