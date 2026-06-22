import { z } from 'zod/v4';

/**
 * Token sources — a generic, config-driven way to draw an agent's LLM
 * credential from a POOL of tokens served by an external HTTP broker, instead
 * of a single static secret. The broker's response shape is NOT hardcoded: a
 * `responseMapping` (JSONPath to the token array + per-token field names)
 * normalizes any vendor's JSON into a list of usable tokens, mirroring the
 * governance moderation provider's `custom_jsonpath` pattern.
 *
 * The rotation engine fetches the pool, filters to active+unexpired, picks one
 * per `selection`, and injects it under `targetEnvVar`; on a rate-limit/expiry
 * it rotates to a different token (see `node_only/sandbox/token_source_pool`).
 */

/** Reserved env-var namespace for a token source's broker auth secret. */
export const TOKEN_SOURCE_SECRET_ENV_PREFIX = 'TALE_TOKEN_SOURCE_';
export const TOKEN_SOURCE_SECRET_ENV_REGEX =
  /^TALE_TOKEN_SOURCE_[A-Za-z0-9_]+$/;

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
export type TokenSourceResponseMapping = z.infer<
  typeof tokenSourceResponseMappingSchema
>;

/**
 * How the broker request is authenticated. The secret VALUE is NOT stored here:
 * it lives either in an encrypted `<slug>.secrets.json` sidecar (the value a
 * user enters in the management UI) or — for operator-provisioned sources — in
 * the env var named by the optional `secretEnv` (the `resolveTokenPool` reader
 * prefers the sidecar, then falls back to the env-ref).
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
export type TokenSourceAuth = z.infer<typeof tokenSourceAuthSchema>;

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
