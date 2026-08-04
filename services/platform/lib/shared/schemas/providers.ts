/**
 * AI-provider system-config schemas — the shapes of the three shipped config
 * trees under `configs/platform/system/`:
 *
 *  - `providers/<name>/provider.yml`  → {@link providerDefinitionSchema} — a provider
 *    CONNECTOR: which wire dialect the endpoint speaks, where it lives, how
 *    its model catalog is sourced, and which credential auth methods it
 *    accepts. Credentials themselves are org data (the `providerCredentials`
 *    table), never part of the provider.
 *  - `models/<provider>/models.yml` → {@link modelCatalogFileSchema} — the static
 *    model catalog for providers with `catalog.source: static`; one
 *    normalized {@link modelCatalogEntrySchema} shape shared with the
 *    API-fetched catalogs (OpenRouter, models-endpoint), so everything
 *    downstream reads one model vocabulary.
 *  - `harnesses/<slug>/harness.yml`  → {@link harnessDefinitionSchema} — the
 *    declarative facts of a sandbox coding harness: credential policy,
 *    credential env keys, model-id dialect, prompt transport, capabilities,
 *    the `parser` stream-dialect family, and the full `exec` construction
 *    facts (argv slots, stdin envelope, env wiring, MCP mounting) that
 *    `lib/harnesses/exec-builder.ts` interprets. Only the genuinely stateful
 *    parts stay code: the stream parsers (`lib/harnesses/parsers/`, keyed by
 *    `parser`) and the few named transforms the exec facts reference.
 *
 * Every object is `.strict()`: these files ship with the image, so an
 * unknown key is a packaging defect to fail loudly on, never data to carry.
 *
 * Layer A: imports only `zod/v4` — no `node:*`, no `convex/_generated` — so
 * client code (settings UI), V8 Convex code, `'use node'` actions, and tests
 * can all share it. Filesystem loading lives in
 * `convex/lib/providers/load_system_config.ts`.
 */

import { z } from 'zod/v4';

import { isPrivateIp } from '../net/private-ip';

/**
 * Reserved prefix every provider-key environment-variable name must carry.
 * The env auth method is gated by this prefix rather than an operator
 * allowlist: a Convex Node action can read ALL deployment secrets via
 * `process.env` (`SOPS_AGE_KEY`, `BETTER_AUTH_SECRET`, …), so restricting
 * provider-key names to a dedicated namespace stops a config-write actor
 * from naming an arbitrary deployment secret and exfiltrating it via a
 * provider `baseUrl`. Fail-closed: any name outside the prefix is rejected.
 *
 * This is THE single definition — every checker (schema, resolver, UI)
 * imports it from here; never restate the string or the regex.
 */
export const SECRETS_ENV_PREFIX = 'TALE_PROVIDER_KEY_';

/** Validation regex for provider-key env names: the reserved prefix plus at
 * least one suffix character (letters, digits, underscores). */
export const SECRETS_ENV_REGEX = /^TALE_PROVIDER_KEY_[A-Za-z0-9_]+$/;

/**
 * A provider-key env-var name, prefix-gated. The 40-char cap matches the
 * platform→Convex env-name sync limit in `docker-entrypoint.sh` — a longer
 * name would silently never reach the Node action runtime.
 */
export const providerKeyEnvNameSchema = z
  .string()
  .max(40)
  .regex(
    SECRETS_ENV_REGEX,
    `must start with ${SECRETS_ENV_PREFIX} and contain only letters, digits, and underscores`,
  );

/** Lower-case kebab slug — provider names and harness slugs. */
const slugSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    'must be a lower-case kebab slug (letters, digits, single dashes)',
  );

const displayNameSchema = z.string().min(1).max(200);

/**
 * The wire format (request/response schema) the provider's endpoint speaks —
 * NOT the transport or the vendor: `openai` = OpenAI Chat Completions shape,
 * `anthropic` = Anthropic Messages shape. A vendor can appear under either
 * (Google ships an OpenAI-compatible endpoint).
 */
export const apiFormatSchema = z.enum(['openai', 'anthropic']);
export type ApiFormat = z.infer<typeof apiFormatSchema>;

/**
 * Endpoint base URL. https for anything public; cleartext `http://` is
 * accepted ONLY when the host is private/loopback-shaped (`isPrivateIp` —
 * the same recognizer the request-time SSRF layers use), so a self-hosted
 * model server on localhost or a LAN (Ollama, vLLM, the e2e mock gateway)
 * can be configured while a bearer-bearing call can never be sent across
 * the open internet in the clear.
 *
 * The schema is deliberately PURE (no env reads): it validates the file's
 * shape. Whether a private host is actually reachable is a deployment
 * decision enforced at every request boundary — `checkProviderHostPolicy`
 * refuses private hosts unless the operator set
 * `TALE_ALLOW_PRIVATE_PROVIDER_HOSTS=1`, and cloud-metadata endpoints are
 * refused unconditionally. A private-http provider file on a deployment
 * without the opt-in is inert, not a hole.
 * Exported for the per-credential endpoint validation (Azure-style providers).
 */
export const providerBaseUrlSchema = z
  .string()
  .url()
  .refine((value) => {
    try {
      const parsed = new URL(value);
      if (parsed.protocol === 'https:') return true;
      return parsed.protocol === 'http:' && isPrivateIp(parsed.hostname);
    } catch {
      return false;
    }
  }, 'baseUrl must be an https:// URL (plain http:// is allowed only for ' + 'private/loopback hosts, e.g. a self-hosted model server)');

/**
 * Where a provider's model catalog comes from. The four cases:
 *
 *  - `static`          → shipped file `models/<name>.yml` (Anthropic, OpenAI,
 *                        Gemini — vendors without a usable listing endpoint).
 *  - `openrouter-api`  → OpenRouter's own catalog API, normalized at fetch.
 *  - `models-endpoint` → the provider's `GET {baseUrl}/models` listing
 *                        (Vercel AI Gateway), normalized at fetch.
 *  - `none`            → the provider has no shippable catalog at all
 *                        (Azure: model ids are org-chosen deployment names;
 *                        Nous Portal: a subscription-routed marketplace) —
 *                        availability comes from each credential's own
 *                        `modelAllowlist`.
 *
 * A live source may ALSO ship a `models/<name>.yml` file: it acts as the
 * curated DEFAULT set, merged under the fetched listing (fetched wins by id)
 * and served alone when a cold fetch fails — an air-gapped install still
 * gets a working model picker.
 */
const catalogSourceSchema = z.discriminatedUnion('source', [
  z.object({ source: z.literal('static') }).strict(),
  z.object({ source: z.literal('openrouter-api') }).strict(),
  z.object({ source: z.literal('models-endpoint') }).strict(),
  z.object({ source: z.literal('none') }).strict(),
]);
export type CatalogSource = z.infer<typeof catalogSourceSchema>;

/**
 * Constraints a subscription-flavored auth method imposes on execution. A
 * vendor subscription (a brokered Claude OAuth pool, a GLM/Kimi coding plan
 * key, a Nous Portal key, a Gemini CLI OAuth blob) is only usable by the
 * vendor's sanctioned agent tooling, so the credential forces sandbox
 * execution with that one harness; the execution-resolution case split
 * (`lib/shared/providers/resolve_execution.ts`) enforces it.
 */
const executionConstraintsSchema = z
  .object({
    execution: z.literal('sandbox'),
    harness: slugSchema,
  })
  .strict();
export type ExecutionConstraints = z.infer<typeof executionConstraintsSchema>;
/** Historical name — the broker method carried these constraints first. */
export type SubscriptionBrokerConstraints = ExecutionConstraints;

/**
 * The credential auth methods a provider accepts, discriminated on
 * `method`:
 *
 *  - `api-key` — a single secret stored (encrypted) on the credential row.
 *  - `env`     — a deployment environment variable; the credential stores
 *    only the variable NAME, which must pass the {@link SECRETS_ENV_PREFIX}
 *    gate. No provider-side fields.
 *  - `subscription-key` — a STATIC vendor subscription secret (a coding-plan
 *    key, a portal key, an OAuth credentials blob). Never usable for direct
 *    API calls: it carries forced-execution constraints binding it to one
 *    harness. May override the wire endpoint/format — subscriptions often
 *    ride a dedicated coding endpoint distinct from the provider's API base
 *    (Z.ai, Kimi expose anthropic-format coding endpoints).
 *  - `subscription-broker` — an external broker endpoint polled for ROTATING
 *    OAuth tokens (the credential row stores endpoint + mapping +
 *    selection); same forced-execution constraints.
 */
const providerAuthMethodSchema = z.discriminatedUnion('method', [
  z.object({ method: z.literal('api-key') }).strict(),
  z.object({ method: z.literal('env') }).strict(),
  z
    .object({
      method: z.literal('subscription-key'),
      baseUrl: providerBaseUrlSchema.optional(),
      apiFormat: apiFormatSchema.optional(),
      constraints: executionConstraintsSchema,
    })
    .strict(),
  z
    .object({
      method: z.literal('subscription-broker'),
      constraints: executionConstraintsSchema,
    })
    .strict(),
]);
export type ProviderAuthMethod = z.infer<typeof providerAuthMethodSchema>;

/** The auth-method discriminant values — the credential-side vocabulary. */
export type ProviderAuthMethodName = ProviderAuthMethod['method'];

/** The shape of one `configs/platform/system/providers/<name>/provider.yml`. */
export const providerDefinitionSchema = z
  .object({
    name: slugSchema,
    displayName: displayNameSchema,
    apiFormat: apiFormatSchema,
    /** Absent only for `endpointMode: per-credential` providers (Azure) —
     * each credential then carries its own resource endpoint. */
    baseUrl: providerBaseUrlSchema.optional(),
    /**
     * Where the wire endpoint lives: `fixed` (default — the provider's
     * `baseUrl`) or `per-credential` (Azure-style resource endpoints — each
     * credential row stores its own `endpointUrl`).
     */
    endpointMode: z.enum(['fixed', 'per-credential']).optional(),
    catalog: catalogSourceSchema,
    auth: z
      .array(providerAuthMethodSchema)
      .min(1)
      .refine(
        (methods) =>
          new Set(methods.map((entry) => entry.method)).size === methods.length,
        { message: 'auth methods must be unique per provider' },
      ),
  })
  .strict()
  .refine(
    (provider) =>
      provider.endpointMode === 'per-credential' ||
      provider.baseUrl !== undefined,
    { message: 'baseUrl is required unless endpointMode is per-credential' },
  )
  .refine(
    (provider) =>
      provider.catalog.source !== 'models-endpoint' ||
      provider.baseUrl !== undefined,
    { message: 'a models-endpoint catalog needs a fixed baseUrl to list from' },
  );
export type ProviderDefinition = z.infer<typeof providerDefinitionSchema>;

/**
 * How hard a reasoning model can be told to think — the two control surfaces
 * in the wild: `effort` (a named level riding `reasoning_effort`) and
 * `budget-tokens` (an explicit thinking-token budget).
 */
const reasoningKnobSchema = z.enum(['effort', 'budget-tokens']);

/**
 * One normalized model-catalog entry — the single shape every catalog source
 * (static file, OpenRouter API, models endpoint) is normalized into, and the
 * only model vocabulary downstream code reads.
 */
/** Audio container/codec a TTS model can answer with. */
export const audioFormatLiterals = [
  'mp3',
  'opus',
  'aac',
  'flac',
  'wav',
  'pcm',
] as const;
export type AudioFormat = (typeof audioFormatLiterals)[number];

/** BCP-47 subset the voice map is keyed by (`en`, `de`, `fr`, `de-CH`). */
const voiceLocaleKeySchema = z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/);

/**
 * The text-to-speech facts of a catalog entry, grouped so a chat model's
 * shape stays untouched. A `text-to-speech`-tagged entry MUST declare at
 * least one voice (see the refinement on the schema below) — a TTS model
 * without a voice cannot be synthesized against.
 */
export const modelCatalogTtsSchema = z
  .object({
    /** The voice used when no locale-specific one matches. */
    defaultVoice: z.string().min(1).max(100).optional(),
    /** Locale → voice, tried exact (`de-CH`) then base (`de`). */
    voicesByLocale: z
      .record(voiceLocaleKeySchema, z.string().min(1).max(100))
      .optional(),
    /** Optional per-request speaking instructions, same cascade. */
    defaultInstructions: z.string().max(2000).optional(),
    instructionsByLocale: z
      .record(voiceLocaleKeySchema, z.string().max(2000))
      .optional(),
    /** Wire format requested from the provider; the audio route serves it
     * with the matching MIME type. */
    audioFormat: z.enum(audioFormatLiterals).default('mp3'),
    /** Synthesis price, for the usage ledger's estimate. */
    centsPerMillionCharacters: z.number().nonnegative().finite().optional(),
  })
  .strict();

export const modelCatalogEntrySchema = z
  .object({
    /** The id requested on the wire, in the CONNECTOR's own dialect (an
     * aggregator's `anthropic/claude-fable-5`, a vendor's `claude-fable-5`). */
    id: z.string().min(1).max(200),
    /** The provider this entry belongs to (`providers/<name>.yml`). */
    provider: slugSchema,
    /** Role/capability tags for grouping and filtering (`chat`, `vision`,
     * `embedding`, `text-to-speech`, …) — open vocabulary, additive. */
    tags: z.array(z.string().min(1).max(64)),
    supportsTools: z.boolean(),
    supportsVision: z.boolean(),
    /** The model GENERATES media (its output modalities include audio, image,
     * or video — e.g. music or image generators). Such listings often carry a
     * token price of 0 because the real billing is per artifact, so price-
     * sorted auto-selection must never read them as "cheap chat models". */
    outputsMedia: z.boolean().optional(),
    /** Present only for models with a controllable reasoning depth. */
    reasoning: z.object({ knob: reasoningKnobSchema }).strict().optional(),
    /** Total context window in tokens. Nominal for non-chat entries (a TTS
     * model takes character-capped requests, not a context). */
    contextWindow: z.number().int().positive(),
    maxOutputTokens: z.number().int().positive().optional(),
    /** Omitted when the source publishes no reliable price. */
    pricing: z
      .object({
        inputCentsPerMillion: z.number().nonnegative().finite(),
        outputCentsPerMillion: z.number().nonnegative().finite(),
      })
      .strict()
      .optional(),
    /** Text-to-speech facts; static-catalog sources only. */
    tts: modelCatalogTtsSchema.optional(),
    /** Embedding facts for an embedding-tagged entry; static-catalog sources
     * only (live listings publish no vector width — this is exactly the
     * fact an operator otherwise has to look up by hand). `recommended`
     * marks the entry the one-click knowledge setup offers. */
    embedding: z
      .object({
        dimensions: z.number().int().min(1).max(16_000),
        recommended: z.boolean().optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine(
    (entry) =>
      !entry.tags.includes('text-to-speech') ||
      entry.tts?.defaultVoice !== undefined ||
      Object.keys(entry.tts?.voicesByLocale ?? {}).length > 0,
    {
      message:
        'a text-to-speech-tagged model must declare tts.defaultVoice or tts.voicesByLocale',
    },
  );
export type ModelCatalogEntry = z.infer<typeof modelCatalogEntrySchema>;

/**
 * The shape of one `configs/platform/system/models/<provider>.yml` — a YAML
 * sequence of catalog entries. Ids are unique per file; the loader
 * additionally pins every entry's `provider` to the file name.
 */
export const modelCatalogFileSchema = z
  .array(modelCatalogEntrySchema)
  .min(1)
  .refine(
    (entries) => new Set(entries.map((e) => e.id)).size === entries.length,
    { message: 'model ids must be unique within a catalog file' },
  );

/** Environment-variable name as a credential env key (`ANTHROPIC_API_KEY`). */
const envKeyNameSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(
    /^[A-Z][A-Z0-9_]*$/,
    'must be an environment-variable name (upper-case letters, digits, underscores)',
  );

/**
 * Which model-id dialect the harness's own credential backend speaks when it
 * talks to a provider directly: `vendor-native` requests the vendor's own id
 * (`claude-fable-5`); `catalog` requests the aggregator-style vendor-prefixed
 * id (`anthropic/claude-fable-5`).
 */
const modelIdDialectSchema = z.enum(['vendor-native', 'catalog']);

/**
 * How the turn prompt reaches the harness process. Never argv for secrets or
 * long prompts where avoidable — process lists leak argv — but Cursor and
 * OpenCode expose no stdin prompt channel, hence `argv`.
 */
const promptTransportSchema = z.enum(['stdin-ndjson', 'stdin-text', 'argv']);

/**
 * Reserved prefix for an env-var holding a BROKER's own auth secret (the
 * secret the platform presents TO the token broker — not a provider API key,
 * hence a namespace separate from {@link SECRETS_ENV_PREFIX}). Same
 * fail-closed rationale: a Node action reads every deployment secret via
 * `process.env`, so broker env-refs are confined to a dedicated namespace.
 * The prefix is unchanged from the retired token-source config format so
 * operator-provisioned env-refs keep resolving after migration.
 */
export const BROKER_SECRET_ENV_PREFIX = 'TALE_TOKEN_SOURCE_';

/** Validation regex for broker-secret env names: reserved prefix + suffix. */
export const BROKER_SECRET_ENV_REGEX = /^TALE_TOKEN_SOURCE_[A-Za-z0-9_]+$/;

const brokerSecretEnvSchema = z
  .string()
  .max(60)
  .regex(
    BROKER_SECRET_ENV_REGEX,
    `must start with ${BROKER_SECRET_ENV_PREFIX} and contain only letters, digits, and underscores`,
  );

/**
 * How to extract the token list from a broker's JSON response. `tokensPath`
 * is a minimal JSONPath (`$.a.b[0].c`) to the array; the remaining fields
 * are plain property names read off each array item.
 */
export const brokerResponseMappingSchema = z
  .object({
    /** JSONPath to the token array, e.g. `$.tokens`. */
    tokensPath: z.string().min(1).max(200),
    /** Field on each item holding the token value, e.g. `access_token`. */
    tokenField: z.string().min(1).max(80),
    /** Optional field naming the item's status, e.g. `status`. */
    statusField: z.string().min(1).max(80).optional(),
    /** The status value that counts as usable, e.g. `active`. Only
     * meaningful together with `statusField`. */
    activeValue: z.string().min(1).max(80).optional(),
    /** Optional field holding the expiry (ISO string or epoch ms/s). */
    expiresField: z.string().min(1).max(80).optional(),
  })
  .strict();
export type BrokerResponseMapping = z.infer<typeof brokerResponseMappingSchema>;

/**
 * How the broker request is authenticated. The secret VALUE never sits in a
 * plain config field: it rides the same encrypted envelope as the rest of
 * the broker data (`authSecret` below), or — for operator-provisioned
 * setups — in the env var named by the optional `secretEnv` (the resolver
 * prefers the stored secret, then falls back to the env-ref).
 */
export const brokerAuthSchema = z.discriminatedUnion('method', [
  z.object({ method: z.literal('none') }).strict(),
  z
    .object({
      method: z.literal('bearer'),
      secretEnv: brokerSecretEnvSchema.optional(),
    })
    .strict(),
  z
    .object({
      method: z.literal('header'),
      headerName: z.string().min(1).max(64),
      secretEnv: brokerSecretEnvSchema.optional(),
    })
    .strict(),
]);
export type BrokerAuth = z.infer<typeof brokerAuthSchema>;

/**
 * Pool selection strategy. `random` picks uniformly per resolution; `first`
 * is deterministic; `round-robin` keeps no cross-run cursor and behaves as
 * `first` (an exclude set advances it within a turn) — the retired
 * token-source semantics, preserved so migrated configs behave identically.
 */
export const brokerSelectionSchema = z.enum(['random', 'first', 'round-robin']);
export type BrokerSelection = z.infer<typeof brokerSelectionSchema>;

/**
 * The data of one `subscription-broker` provider credential: an external
 * HTTP broker polled for a POOL of rotating OAuth tokens, with a
 * config-driven response mapping (no hardcoded vendor shape). This is the
 * retired token-source config folded into the credential row — field for
 * field, so existing broker configs convert losslessly:
 * `method`→`httpMethod`, `responseMapping.statusActiveValue`→`activeValue`,
 * `responseMapping.expiryField`→`expiresField`; everything else keeps its
 * name and bounds.
 *
 * The WHOLE object — including the optional `authSecret` — is stored only
 * inside the credential row's `encryptedData` ciphertext (secret_box), never
 * as plaintext config; parse it only after decryption inside `'use node'`
 * code and never log the parsed value.
 */
export const brokerCredentialDataSchema = z
  .object({
    /** The broker endpoint to fetch the token pool from. https-only: the
     * pool response carries live credentials. */
    endpoint: providerBaseUrlSchema,
    httpMethod: z.enum(['GET', 'POST']),
    auth: brokerAuthSchema,
    responseMapping: brokerResponseMappingSchema,
    /** Sandbox env var the picked token is injected under,
     * e.g. `CLAUDE_CODE_OAUTH_TOKEN`. */
    targetEnvVar: z
      .string()
      .max(80)
      .regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
    selection: brokerSelectionSchema,
    /** Broker request timeout. */
    timeoutMs: z.number().int().min(500).max(30_000).default(10_000),
    /** Response size cap for the pool fetch. */
    maxResponseBytes: z
      .number()
      .int()
      .min(1024)
      .max(1_048_576)
      .default(262_144),
    /** Drop tokens expiring within this many ms of now (clock + handoff
     * slack). */
    expirySkewMs: z.number().int().min(0).max(3_600_000).default(300_000),
    /** The broker's own auth secret. Meaningful only when `auth.method` is
     * not `none`; encrypted-at-rest with the rest of this object. */
    authSecret: z.string().min(1).optional(),
  })
  .strict();
export type BrokerCredentialData = z.infer<typeof brokerCredentialDataSchema>;

// ---------------------------------------------------------------------------
// Harness exec facts — the declarative construction vocabulary
// ---------------------------------------------------------------------------
// The `exec` section of a harness YAML describes, slot by slot, how one
// sandbox turn's process invocation is assembled from a `HarnessRunSpec`.
// `lib/harnesses/exec-builder.ts` is the single interpreter; there is no
// per-harness build code. The vocabulary is CLOSED: fixed slot kinds, fixed
// condition atoms, and a fixed placeholder set — never a general template
// language.
//
// Placeholders. Literal strings in argv chunks, env maps, templates, and doc
// trees (values AND map keys) may reference exactly these spec fields:
//
//   ${gateway.baseUrl}  managed gateway root (no trailing slash)
//   ${gateway.token}    session virtual key (env values only in practice —
//                       the hygiene tests enforce where it may land)
//   ${model}            the model id AS DELIVERED to the CLI (after the model
//                       slot's declared transform, when any)
//   ${model.raw}        the caller-resolved model id verbatim
//   ${workdir}          the session working directory
//   ${execId}           the platform exec id of the turn
//   ${prompt}           the turn prompt
//   ${vision.model}     the vision-polyfill transcription model
//   ${bridgeUrl}        the capability-dispatch bridge base URL
//
// Substitution is SINGLE-PASS and closed over that set: replacement values
// are never rescanned (a prompt containing `${gateway.token}` stays those
// literal characters), and any other `${…}` or `{env:…}` sequence passes
// through byte-identically — several CLIs resolve their own env templates
// from staged config (`${TALE_GATEWAY_TOKEN}`, `{env:TALE_GATEWAY_TOKEN}`,
// `$TALE_GATEWAY_TOKEN`), and those must reach them untouched.

/** The stream-parser families under `lib/harnesses/parsers/` — the one
 * genuinely stateful per-harness part that stays code. Every harness YAML
 * names the family that parses its stdout dialect; families are reusable
 * (qwen-code, a gemini-cli fork, shares `gemini-stream`). */
export const parserFamilySchema = z.enum([
  'claude-stream-json',
  'codex-jsonl',
  'cursor-jsonl',
  'gemini-stream',
  'hermes-jsonl',
  'openclaw-jsonl',
  'opencode-jsonl',
  'pi-jsonl',
]);
export type ParserFamily = z.infer<typeof parserFamilySchema>;

/** One literal argv token (placeholders allowed). Length-capped: argv is a
 * process list, not a document sink. */
const argvTokenSchema = z.string().min(1).max(4096);

/** A literal argv chunk emitted verbatim (after placeholder substitution). */
const argvChunkSchema = z.array(argvTokenSchema).min(1);

/** A flag token a slot emits before its value (`--model`, `-c`, or a bare
 * subcommand word like codex's `resume`). */
const flagSchema = z.string().min(1).max(64);

/** Env map whose values are placeholder templates. Empty string is a valid
 * value (claude-code blanks `ANTHROPIC_API_KEY` so it never conflicts with
 * the bearer token). */
const envTemplateMapSchema = z.record(envKeyNameSchema, z.string().max(4096));

/**
 * Condition atoms gating a conditional doc fragment or envelope doc; a
 * `when` list is an AND over its atoms. `managed`/`byo` follow the spec's
 * credential mode; `model`/`no-model` whether a model was resolved.
 */
const execConditionSchema = z.enum(['managed', 'byo', 'model', 'no-model']);
const whenSchema = z.array(execConditionSchema).min(1);

/** Dotted key path inside a config document (`model.maxSessionTurns`,
 * `mcp.servers`). Path segments never contain dots in this vocabulary. */
const docPathSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(
    /^[A-Za-z_$][A-Za-z0-9_$-]*(?:\.[A-Za-z_$][A-Za-z0-9_$-]*)*$/,
    'must be a dotted key path',
  );

/** JSON-shaped literal tree for `set` fragments. Strings — keys included —
 * go through placeholder substitution; everything else is verbatim. */
type DocValue =
  | string
  | number
  | boolean
  | null
  | DocValue[]
  | { [key: string]: DocValue };
const docValueSchema: z.ZodType<DocValue> = z.lazy(() =>
  z.union([
    z.string().max(4096),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(docValueSchema),
    z.record(z.string().min(1).max(200), docValueSchema),
  ]),
);

/**
 * One ordered fragment of a config DOCUMENT (a staged/stdin/env-borne JSON
 * config such as gemini's settings, openclaw's config, pi's models, or
 * opencode's `OPENCODE_CONFIG_CONTENT`). Fragments deep-merge in list order
 * — objects merge recursively, arrays and scalars replace — and JSON key
 * order is first-insertion order, which the byte-exact golden fixtures pin.
 *
 *  - `set`: merge a literal tree (optionally gated by `when`).
 *  - `maxTurns`: set the fixed runaway backstop (`DEFAULT_MAX_TURNS`) as a
 *    number at `path`.
 *  - `mcpServers`: mount the requested MCP servers at `path` — the
 *    in-container Playwright browser server (headless or CDP-attach; shapes
 *    are interpreter constants shared by every harness) plus, on managed
 *    runs with a bridge URL, the capability-dispatch bridge whose child env
 *    is `bridgeEnv` under the CLI's field name (`env`/`environment`).
 *    `serverShape`: `command-args` = `{command, args}` objects;
 *    `opencode-local` = `{type: "local", command: [bin, …args], enabled}`.
 *  - `instructionsRef`: when instructions are staged as a file
 *    (`stagedInstructions`), set `path` to `[prefix + stagedPath]` so the
 *    CLI discovers the staged file.
 */
const docFragmentSchema = z.union([
  z
    .object({
      when: whenSchema.optional(),
      set: z.record(z.string().min(1).max(200), docValueSchema),
    })
    .strict(),
  z.object({ maxTurns: z.object({ path: docPathSchema }).strict() }).strict(),
  z
    .object({
      mcpServers: z
        .object({
          path: docPathSchema,
          serverShape: z.enum(['command-args', 'opencode-local']),
          bridgeEnvField: z.enum(['env', 'environment']),
          bridgeEnv: envTemplateMapSchema,
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      instructionsRef: z
        .object({ path: docPathSchema, prefix: z.string().min(1).max(200) })
        .strict(),
    })
    .strict(),
]);

const docFragmentsSchema = z.array(docFragmentSchema).min(1);

/**
 * One ordered argv slot. The list IS the argv assembly order (after `bin`),
 * so per-harness flag ordering is data, not code. Literal-chunk slots
 * (`args`/`managedArgs`/`byoArgs`) may repeat; every semantic slot appears
 * at most once (refined below).
 *
 *  - `args`: unconditional literal chunk.
 *  - `managedArgs` / `byoArgs`: chunk only for that credential mode (codex
 *    carries its gateway/OpenAI provider config and its managed native
 *    web-search disable here).
 *  - `posture`: the plan/act chunk pair — plan is the read-only exploration
 *    posture; only a `capabilities.planMode` harness declares this.
 *  - `maxTurns`: flag + the fixed `DEFAULT_MAX_TURNS` backstop.
 *  - `additionalDirs`: flag repeated per out-of-workdir grant.
 *  - `resume`: flag + the resume handle (codex's bare `resume` subcommand
 *    word works because the slot sits between its `exec` and flags chunks).
 *  - `model`: flag + the delivered model id. `value` templates the flag
 *    value (opencode's `tale/${model}`); `omitValues` skips the flag for
 *    sentinel ids (cursor's `default`); `transform` names the in-code model
 *    rewrite applied before delivery (claude's 1M-context marker);
 *    `managedPrefixArgs` is emitted before the flag on managed runs with a
 *    model (pi pins its staged gateway provider); `env`/`managedEnv` are
 *    env maps applied whenever a model is set (claude's `ANTHROPIC_MODEL`
 *    and its managed default-slot pins).
 *  - `instructions`: argv-flag delivery of the composed addendum. With
 *    `configKey`, the value is emitted as `<configKey>=<TOML string>` (codex
 *    `-c developer_instructions="…"`); `transform` names the in-code
 *    instructions rewrite (claude's baseline house rules, which also make
 *    the flag unconditional).
 *  - `mcp`: argv-borne MCP mounting. `config-json-flag` = one flag carrying
 *    the merged `{mcpServers}` JSON plus `trailingArgs` (claude's
 *    `--strict-mcp-config`); `omitImagesOnVision` appends the browser
 *    server's save-to-disk image flags when the vision polyfill is armed.
 *    `codex-config-flags` = `-c mcp_servers.*` TOML pairs; the bridge child
 *    env rides codex's `env_vars` whitelist and `bridgeEnv` lands in the
 *    EXEC env instead of argv.
 *  - `toolDeny`: one flag + comma-joined tool names — `always` denies in
 *    both modes (interaction dead-ends like AskUserQuestion), `managed`
 *    adds the governance denials byo lifts (native web tools).
 *  - `prompt`: the prompt as a positional argv token — only for CLIs with
 *    no stdin prompt channel (cursor, opencode); process lists leak argv.
 */
const argvSlotSchema = z.union([
  z.object({ args: argvChunkSchema }).strict(),
  z.object({ managedArgs: argvChunkSchema }).strict(),
  z.object({ byoArgs: argvChunkSchema }).strict(),
  z
    .object({
      posture: z
        .object({ plan: argvChunkSchema, act: argvChunkSchema })
        .strict(),
    })
    .strict(),
  z.object({ maxTurns: z.object({ flag: flagSchema }).strict() }).strict(),
  z
    .object({ additionalDirs: z.object({ flag: flagSchema }).strict() })
    .strict(),
  z.object({ resume: z.object({ flag: flagSchema }).strict() }).strict(),
  z
    .object({
      model: z
        .object({
          flag: flagSchema,
          value: z.string().min(1).max(200).optional(),
          omitValues: z.array(z.string().min(1).max(200)).min(1).optional(),
          transform: z.enum(['claude-max-context']).optional(),
          managedPrefixArgs: argvChunkSchema.optional(),
          env: envTemplateMapSchema.optional(),
          managedEnv: envTemplateMapSchema.optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      instructions: z
        .object({
          flag: flagSchema,
          configKey: z.string().min(1).max(128).optional(),
          transform: z.enum(['claude-house-rules']).optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      mcp: z.discriminatedUnion('delivery', [
        z
          .object({
            delivery: z.literal('config-json-flag'),
            flag: flagSchema,
            trailingArgs: argvChunkSchema.optional(),
            omitImagesOnVision: z.boolean().optional(),
            bridgeEnv: envTemplateMapSchema,
          })
          .strict(),
        z
          .object({
            delivery: z.literal('codex-config-flags'),
            bridgeEnv: envTemplateMapSchema,
          })
          .strict(),
      ]),
    })
    .strict(),
  z
    .object({
      toolDeny: z
        .object({
          flag: flagSchema,
          always: z.array(z.string().min(1).max(80)).optional(),
          managed: z.array(z.string().min(1).max(80)).optional(),
        })
        .strict()
        .refine((deny) => (deny.always ?? deny.managed) !== undefined, {
          message: 'toolDeny needs an always or managed list',
        }),
    })
    .strict(),
  z.object({ prompt: z.object({}).strict() }).strict(),
]);

/**
 * One ordered stdin-envelope entry (`json-envelope` mode): the envelope's
 * JSON keys in emission order. `prompt` = the turn prompt under the key
 * `prompt`; `instructions` = the composed addendum under `key` (omitted
 * when none); `doc` = an assembled config document under `key`, optionally
 * gated by `when` (pi's managed-only `models`).
 */
const stdinEnvelopeEntrySchema = z.union([
  z.object({ prompt: z.object({}).strict() }).strict(),
  z
    .object({
      instructions: z.object({ key: z.string().min(1).max(64) }).strict(),
    })
    .strict(),
  z
    .object({
      doc: z
        .object({
          key: z.string().min(1).max(64),
          when: whenSchema.optional(),
          fragments: docFragmentsSchema,
        })
        .strict(),
    })
    .strict(),
]);

/**
 * The stdin channel. `none` = no stdin (argv-prompt CLIs); `prompt-text` =
 * the raw prompt piped and closed (codex's `-` sentinel reads it);
 * `json-envelope` = one JSON object built from `envelope`, piped and closed
 * (the tale-*-run wrappers read it to EOF); `ndjson-user-message` = the
 * prompt as one stream-json user-message line with stdin HELD OPEN — the
 * mid-turn steering channel (claude); `promptTransform` names the in-code
 * prompt rewrite applied first (claude's ultrathink keyword).
 */
const execStdinSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('none') }).strict(),
  z.object({ mode: z.literal('prompt-text') }).strict(),
  z
    .object({
      mode: z.literal('ndjson-user-message'),
      promptTransform: z.enum(['claude-ultrathink']).optional(),
    })
    .strict(),
  z
    .object({
      mode: z.literal('json-envelope'),
      envelope: z.array(stdinEnvelopeEntrySchema).min(1),
    })
    .strict(),
]);

/**
 * The full exec construction facts. `bin` + the ordered `argv` slots build
 * the process argv; `stdin` the prompt channel; `env.base` is always set,
 * `env.managed` only on managed runs (the ONLY place `${gateway.token}` may
 * reach the raw environment — byo credentials merge verbatim from the
 * caller-built env map, which is interpreter behavior, not a YAML slot);
 * `envDocs` assembles config documents into env variables (opencode);
 * `stagedInstructions` stages the composed addendum as a per-exec file
 * (`${execId}` falls back to `default` in its path); `vision.env` applies
 * on managed runs with the vision polyfill armed; `steering.env` applies
 * when the turn has an exec id (the per-exec steer queue dir).
 */
const harnessExecSchema = z
  .object({
    bin: z.string().min(1).max(128),
    argv: z.array(argvSlotSchema).min(1),
    stdin: execStdinSchema,
    env: z
      .object({
        base: envTemplateMapSchema.optional(),
        managed: envTemplateMapSchema.optional(),
      })
      .strict()
      .optional(),
    envDocs: z
      .record(
        envKeyNameSchema,
        z.object({ fragments: docFragmentsSchema }).strict(),
      )
      .optional(),
    stagedInstructions: z
      .object({ pathTemplate: z.string().min(1).max(300) })
      .strict()
      .optional(),
    vision: z.object({ env: envTemplateMapSchema }).strict().optional(),
    steering: z.object({ env: envTemplateMapSchema }).strict().optional(),
  })
  .strict();
export type HarnessExecFacts = z.infer<typeof harnessExecSchema>;

/**
 * How a subscription-key secret (a coding-plan credential resolved by the
 * platform) reaches the CLI. Declarative only — the interpreter applies it
 * when a spec carries `subscription`; the runtime consumer arrives with the
 * chat rebuild. `env` injects the secret under `tokenVar` (and the
 * subscription's base URL under `baseUrlVar`, when both are present) after
 * the credential env, so it overrides the same-named auth var. `staged-file`
 * writes the secret verbatim as the session-relative file the CLI reads its
 * subscription state from (gemini's `~/.gemini/oauth_creds.json`).
 */
export const harnessSubscriptionSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('env'),
      tokenVar: envKeyNameSchema,
      baseUrlVar: envKeyNameSchema.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('staged-file'),
      path: z.string().min(1).max(300),
    })
    .strict(),
]);
export type HarnessSubscription = z.infer<typeof harnessSubscriptionSchema>;

/** Slot-kind key of an argv entry (each entry is a single-key object). */
function argvSlotKind(slot: Record<string, unknown>): string {
  return Object.keys(slot)[0] ?? '';
}

/** The shape of one `configs/platform/system/harnesses/<slug>/harness.yml`. */
export const harnessDefinitionSchema = z
  .object({
    slug: slugSchema,
    displayName: displayNameSchema,
    /**
     * Which credential modes the harness accepts: `managed` = routed through
     * the platform gateway with a session-scoped virtual key; `byo` =
     * user-owned credentials injected into the session environment. At least
     * one must hold, or no credential could ever run the harness.
     */
    credentialPolicy: z
      .object({
        managed: z.boolean(),
        byo: z.boolean(),
      })
      .strict()
      .refine((policy) => policy.managed || policy.byo, {
        message: 'credentialPolicy must accept managed or byo (or both)',
      }),
    /** Env vars this harness reads credentials from (scrubbed on switch). */
    credentialEnvKeys: z
      .array(envKeyNameSchema)
      .refine((keys) => new Set(keys).size === keys.length, {
        message: 'credentialEnvKeys must be unique',
      }),
    modelIdDialect: modelIdDialectSchema,
    promptTransport: promptTransportSchema,
    capabilities: z
      .object({
        /** Read-only exploration turns that end in a proposed plan. */
        planMode: z.boolean(),
        /** Mid-turn user-message injection into a running turn. */
        steering: z.boolean(),
        /** Whether the harness can mount MCP servers at all. */
        mcp: z.boolean(),
      })
      .strict(),
    /** The stdout stream dialect (`lib/harnesses/parsers/<family>`). */
    parser: parserFamilySchema,
    /** The declarative exec construction facts (see the section header). */
    exec: harnessExecSchema,
    /** Subscription-key delivery, for harnesses a subscription credential
     * can force (absent = no subscription path). */
    subscription: harnessSubscriptionSchema.optional(),
    /** The CLI version baked into the sandbox image, when pinned. */
    pinnedVersion: z.string().min(1).max(64).optional(),
  })
  .strict()
  .superRefine((provider, ctx) => {
    // The declared capabilities/transport facts and the exec facts describe
    // one process — the schema holds them coherent, replacing the retired
    // behavior-probing registry validator.
    const issue = (message: string) =>
      ctx.addIssue({ code: 'custom', message });
    const slots = provider.exec.argv as ReadonlyArray<Record<string, unknown>>;
    const counts = new Map<string, number>();
    for (const slot of slots) {
      const kind = argvSlotKind(slot);
      counts.set(kind, (counts.get(kind) ?? 0) + 1);
    }
    for (const kind of [
      'posture',
      'maxTurns',
      'additionalDirs',
      'resume',
      'model',
      'instructions',
      'mcp',
      'toolDeny',
      'prompt',
    ]) {
      if ((counts.get(kind) ?? 0) > 1) {
        issue(`argv slot "${kind}" may appear at most once`);
      }
    }

    // Plan mode ⇔ a posture slot exists.
    if (provider.capabilities.planMode !== (counts.get('posture') ?? 0) > 0) {
      issue(
        'capabilities.planMode must match the presence of an argv posture slot',
      );
    }

    // Steering ⇔ the held-open NDJSON stdin channel.
    const holdsStdin = provider.exec.stdin.mode === 'ndjson-user-message';
    if (provider.capabilities.steering !== holdsStdin) {
      issue(
        'capabilities.steering must match the ndjson-user-message stdin mode (the held-open steering channel)',
      );
    }
    if (provider.exec.steering && !provider.capabilities.steering) {
      issue('a steering env section requires capabilities.steering');
    }

    // Prompt transport ⇔ the stdin mode / argv prompt slot.
    const stdinMode = provider.exec.stdin.mode;
    const hasArgvPrompt = (counts.get('prompt') ?? 0) > 0;
    const envelope =
      provider.exec.stdin.mode === 'json-envelope'
        ? (provider.exec.stdin.envelope as ReadonlyArray<
            Record<string, unknown>
          >)
        : [];
    const envelopeHasPrompt = envelope.some((e) => 'prompt' in e);
    switch (provider.promptTransport) {
      case 'argv':
        if (stdinMode !== 'none' || !hasArgvPrompt) {
          issue(
            'promptTransport argv requires stdin mode none and an argv prompt slot',
          );
        }
        break;
      case 'stdin-text':
        if (stdinMode !== 'prompt-text' || hasArgvPrompt) {
          issue('promptTransport stdin-text requires stdin mode prompt-text');
        }
        break;
      case 'stdin-ndjson':
        if (
          hasArgvPrompt ||
          (stdinMode !== 'ndjson-user-message' &&
            !(stdinMode === 'json-envelope' && envelopeHasPrompt))
        ) {
          issue(
            'promptTransport stdin-ndjson requires an ndjson-user-message or prompt-carrying json-envelope stdin',
          );
        }
        break;
    }

    // Managed-only surfaces require the managed credential policy (and byo
    // chunks the byo policy) — a policy-false mode must build inert.
    const modelSlot = slots.find((s) => argvSlotKind(s) === 'model')?.model as
      | { managedPrefixArgs?: unknown; managedEnv?: unknown }
      | undefined;
    const toolDenySlot = slots.find((s) => argvSlotKind(s) === 'toolDeny')
      ?.toolDeny as { managed?: unknown } | undefined;
    const usesManaged =
      (counts.get('managedArgs') ?? 0) > 0 ||
      provider.exec.env?.managed !== undefined ||
      provider.exec.vision !== undefined ||
      modelSlot?.managedPrefixArgs !== undefined ||
      modelSlot?.managedEnv !== undefined ||
      toolDenySlot?.managed !== undefined;
    if (usesManaged && !provider.credentialPolicy.managed) {
      issue('managed-only exec sections require credentialPolicy.managed true');
    }
    if ((counts.get('byoArgs') ?? 0) > 0 && !provider.credentialPolicy.byo) {
      issue('byoArgs requires credentialPolicy.byo true');
    }

    // Instructions have at most ONE delivery channel.
    const envelopeInstructions = envelope.filter(
      (e) => 'instructions' in e,
    ).length;
    const instructionDeliveries =
      (counts.get('instructions') ?? 0) +
      envelopeInstructions +
      (provider.exec.stagedInstructions ? 1 : 0);
    if (instructionDeliveries > 1) {
      issue('instructions may use at most one delivery channel');
    }

    // Collect doc fragments across every document sink.
    const fragmentLists: ReadonlyArray<Record<string, unknown>>[] = [];
    for (const entry of envelope) {
      const doc = entry.doc as { fragments?: unknown } | undefined;
      if (doc?.fragments) {
        fragmentLists.push(
          doc.fragments as ReadonlyArray<Record<string, unknown>>,
        );
      }
    }
    for (const doc of Object.values(provider.exec.envDocs ?? {})) {
      fragmentLists.push(
        doc.fragments as ReadonlyArray<Record<string, unknown>>,
      );
    }
    const fragments = fragmentLists.flat();
    const mcpFragmentCount = fragments.filter((f) => 'mcpServers' in f).length;
    const instructionsRefCount = fragments.filter(
      (f) => 'instructionsRef' in f,
    ).length;

    // Staged instructions and their doc reference come as a pair.
    if (
      (provider.exec.stagedInstructions !== undefined) !==
      instructionsRefCount > 0
    ) {
      issue(
        'stagedInstructions and an instructionsRef doc fragment require each other',
      );
    }
    if (instructionsRefCount > 1) {
      issue('at most one instructionsRef doc fragment');
    }

    // MCP capability ⇔ exactly one mounting channel (argv slot or doc
    // fragment); a capability-false harness must ignore MCP requests.
    const mcpChannels = (counts.get('mcp') ?? 0) + mcpFragmentCount;
    if (mcpChannels > 1) {
      issue('at most one MCP mounting channel');
    }
    if (provider.capabilities.mcp !== (mcpChannels === 1)) {
      issue(
        'capabilities.mcp must match the presence of an MCP mounting channel',
      );
    }
  });
export type HarnessDefinition = z.infer<typeof harnessDefinitionSchema>;
