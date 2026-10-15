/**
 * Connector schema — the shape of one
 * `configs/platform/system/connectors/<slug>/connector.yml`.
 *
 * A connector is an external system the platform can act on (GitHub, Slack, a
 * mailbox, an org's WebDAV store). It declares its identity, the auth methods
 * it accepts (MULTIPLE, decoupled from the actions — a credential row picks
 * one), and its actions. Each action is a capability the automation engine and
 * the chat tool surface invoke through one dispatcher; the action's shape maps
 * directly onto the engine's `ConnectorLike` node type.
 *
 * Every action carries a DETERMINISTIC mock (same input → same output, no IO)
 * so the fast authoring/test loop needs no live credentials — the mock is
 * required, the live path optional. Live behavior comes from one of two
 * backends (an exhaustive switch, never a hidden default):
 *
 *  - `yaml-js`   — a JavaScript body run in the CodeRunner sandbox with a
 *                  controlled `ctx` (http, secrets, files, idempotencyKey).
 *  - `native:<id>` — a platform module registered into the engine's slots
 *                  (imap-smtp, sql, webdav) — declared here, not hidden, so
 *                  the catalog and docs list it like any other action.
 *
 * Input is JSON Schema (machine-validated). Output is a TS-style signature
 * string — documentation only, the vocabulary the engine's output-typing rule
 * reads; a connector action is `structured` by construction.
 */

import { z } from 'zod/v4';

const slugSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    'must be a lower-case kebab slug (letters, digits, single dashes)',
  );

/** An action name: snake_case, unique within a connector, and the second
 * half of the engine node type `<connector>.<action>`. */
const actionNameSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(
    /^[a-z][a-z0-9_]*$/,
    'must be snake_case (lower-case, digits, underscores)',
  );

const displayNameSchema = z.string().min(1).max(200);

/** Locale keys of the per-entry `i18n` channels (`de`, `fr`, `de-CH`) — the
 * grammar every declared text uses, as in the automation settings forms and
 * the pack manifest. */
const LOCALE_RE = /^[a-z]{2}(-[A-Z]{2})?$/;

/** A per-credential setting's key (`configFields[].key`). */
const configKeySchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-zA-Z0-9]*$/, 'config key is lowerCamelCase');

/** An action named for a person: a short verb phrase in sentence case
 * ("List issues"), without the connector's name — a surface shows it beside
 * the connector's display name ("GitHub · List issues"). */
const actionTitleSchema = z.string().min(1).max(80);

/**
 * The auth methods a connector accepts — discriminated on `method`, MULTIPLE
 * per connector, decoupled from the actions. A credential row references one
 * method; the OAuth popup flow binds to a credential of the `oauth2` method.
 *
 *  - `api-key` — one secret sent however the live body chooses (query/header).
 *  - `bearer`  — one token sent as `Authorization: <scheme> <token>` (PATs).
 *  - `basic`   — username + password (HTTP Basic; also SMTP/IMAP login).
 *  - `oauth2`  — an OAuth app: client id/secret + the authorize/token URLs and
 *                default scopes the connector's flow uses.
 *  - `client-credentials` — the organization's own app signs in as itself
 *                (OAuth 2.0 client credentials grant, RFC 6749 §4.4): no
 *                person and no consent screen. The credential stores the
 *                app's client id/secret (and its directory, where the token
 *                URL names `{tenantId}`); the platform fetches the access
 *                token from `tokenUrl` for `scopes` and keeps it until it
 *                expires.
 *  - `platform` — the platform itself is the identity: no stored credential,
 *                no connect flow. Only native-backed platform capabilities
 *                (sandbox scripts, task/document actions) declare it, it
 *                stands alone, and such connectors never appear in the
 *                connectors settings list.
 */
const connectorAuthMethodSchema = z.discriminatedUnion('method', [
  z.object({ method: z.literal('platform') }).strict(),
  z.object({ method: z.literal('api-key') }).strict(),
  z
    .object({
      method: z.literal('bearer'),
      /**
       * The Authorization scheme token placed before the credential. `Bearer`
       * is the standard and the default; a vendor that defines its own scheme
       * names it here — Discord, for instance, authenticates bot tokens as
       * `Authorization: Bot <token>` and rejects `Bearer` for them.
       */
      scheme: z
        .string()
        .regex(/^[A-Za-z][A-Za-z0-9-]*$/)
        .default('Bearer'),
    })
    .strict(),
  z.object({ method: z.literal('basic') }).strict(),
  z
    .object({
      method: z.literal('oauth2'),
      authorizeUrl: z.string().url(),
      tokenUrl: z.string().url(),
      scopes: z.array(z.string().min(1)).default([]),
      /**
       * Scopes the consent asks for on top of `scopes`, only for a credential
       * whose per-credential setting `<key>` (one of `configFields`) is set —
       * a permission some accounts cannot grant, asked of the credentials
       * that need it. Outlook asks for the shared-mailbox permissions only
       * when the credential names a `mailbox`: a personal Microsoft account
       * cannot grant them.
       */
      configScopes: z
        .record(configKeySchema, z.array(z.string().min(1)).min(1))
        .optional(),
    })
    .strict(),
  z
    .object({
      method: z.literal('client-credentials'),
      /** The token endpoint. `{tenantId}` in it is replaced by the
       * credential's directory (tenant) id, which the credential then
       * requires. */
      tokenUrl: z
        .string()
        .url()
        .refine(
          (url) => url.startsWith('https://'),
          'a client-credentials token URL is https — the client secret travels to it',
        ),
      scopes: z.array(z.string().min(1)).default([]),
    })
    .strict(),
]);

/** The placeholder a `client-credentials` token URL carries where the
 * credential's directory (tenant) id goes. */
export const CLIENT_CREDENTIALS_TENANT_PLACEHOLDER = '{tenantId}';
export type ConnectorAuthMethod = z.infer<typeof connectorAuthMethodSchema>;
export type ConnectorAuthMethodName = ConnectorAuthMethod['method'];
/** Auth methods a credential row can store — every method but `platform`,
 * which by definition never has a credential. */
export type StorableAuthMethodName = Exclude<
  ConnectorAuthMethodName,
  'platform'
>;

/** Whether an action changes the outside world — write actions gate behind
 * the approvals policy and are recorded as effects; read actions don't. */
const effectSchema = z.enum(['read', 'write']);
export type ConnectorEffect = z.infer<typeof effectSchema>;

/**
 * Where the connector's live endpoint comes from — same split the provider
 * connectors use:
 *
 *  - `fixed`          — one vendor API host; live bodies hardcode their URLs
 *                       and `allowedHosts` lists exact hosts.
 *  - `per-credential` — each credential names its own instance (Confluence
 *                       `<site>.atlassian.net`, Shopify `<store>.myshopify.com`);
 *                       the credential row carries an https `endpointUrl`, live
 *                       bodies read it as `ctx.endpoint` (origin, no trailing
 *                       slash), and `allowedHosts` entries are host SUFFIXES
 *                       (`atlassian.net` admits any subdomain of it).
 */
const endpointModeSchema = z.enum(['fixed', 'per-credential']);

/**
 * A non-secret per-credential setting a connector needs but which is neither a
 * secret nor an https origin — the IMAP/SMTP server host and port, a Shopify
 * API version, a region. It rides ALONGSIDE the auth method: `basic` still
 * means only username + password, so a connector-specific detail never
 * distorts what an auth method means.
 *
 * Kept deliberately small (string/number/boolean, with an optional enum and a
 * default) so it renders as one plain form field and validates structurally.
 * Secrets never belong here — they go in the encrypted credential payload.
 */
const configFieldSchema = z
  .object({
    key: configKeySchema,
    label: z.string().min(1).max(120),
    type: z.enum(['string', 'number', 'boolean']),
    description: z.string().max(2000).optional(),
    required: z.boolean().default(false),
    /**
     * Required only for a credential that signs in with one of these
     * methods — an app signing in as itself (`client-credentials`) has no
     * account of its own, so it must be told which one to act on, where a
     * person's sign-in falls back to that person's.
     */
    requiredFor: z
      .array(
        z.enum(['api-key', 'bearer', 'basic', 'oauth2', 'client-credentials']),
      )
      .min(1)
      .optional(),
    /** Closed set of accepted values, for a `string` field rendered as a select. */
    enum: z.array(z.string().min(1)).min(1).optional(),
    /** Numeric constraints for number fields. */
    integer: z.boolean().optional(),
    min: z.number().finite().optional(),
    max: z.number().finite().optional(),
    /** Applied when the field is absent; must match `type`. */
    default: z.union([z.string(), z.number(), z.boolean()]).optional(),
    /** Per-locale overrides of the label and description a form shows,
     * same locale chain as an action's `title`: exact tag, then base
     * language, then the authored English. */
    i18n: z
      .record(
        z.string().regex(LOCALE_RE),
        z
          .object({
            label: z.string().min(1).max(120).optional(),
            description: z.string().max(2000).optional(),
          })
          .strict(),
      )
      .optional(),
  })
  .strict();

/**
 * How an action's LIVE path runs. `yaml-js` carries a JS body run in the
 * CodeRunner sandbox; `native` names a platform module registered into the
 * engine slots (the backend id, e.g. `imap-smtp.send`). Mock-only actions
 * omit `backend` — they are invokable in mock mode and refuse live with a
 * clear error the dispatcher raises.
 */
const backendSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('yaml-js'), live: z.string().min(1) }).strict(),
  z
    .object({
      kind: z.literal('native'),
      impl: z
        .string()
        .min(1)
        .regex(
          /^[a-z][a-z0-9-]*\.[a-z][a-z0-9_]*$/,
          'native impl id is "<module>.<fn>" (e.g. imap-smtp.send)',
        ),
    })
    .strict(),
]);

/** A JSON-Schema object — validated structurally here, compiled by the
 * engine (ajv) at run time. */
const jsonSchemaObjectSchema = z
  .object({ type: z.literal('object') })
  .passthrough();

export const connectorActionSchema = z
  .object({
    name: actionNameSchema,
    /** The action in words, in English. A surface without one shows the
     * humanized action name instead. */
    title: actionTitleSchema.optional(),
    /** Per-locale overrides of `title`. The chain every declared text
     * follows: the exact tag (`de-CH`), then its base language (`de`), then
     * the English `title`. */
    i18n: z
      .record(
        z.string().regex(LOCALE_RE),
        z.object({ title: actionTitleSchema.optional() }).strict(),
      )
      .optional(),
    description: z.string().min(1).max(2000),
    /** JSON Schema for the action's `input` — machine-validated. */
    input: jsonSchemaObjectSchema,
    /** TS-style output signature, e.g. `{ number: number, url: string }` —
     * documentation only (the engine reads it as the output vocabulary). */
    output: z.string().min(1).max(2000),
    effects: effectSchema,
    /** Calling it twice with the same `ctx.idempotencyKey` has the effect of
     * calling it once — a set-style write, or a body that forwards the key to
     * a vendor that de-duplicates on it. A resumed automation run repeats
     * such a write when it cannot tell whether the first call reached the
     * vendor; any other write waits for a person instead. Absent = not. */
    idempotent: z.boolean().optional(),
    /** Deterministic mock body (JS): `input` in scope, returns the mock
     * output. Required — the authoring/test loop runs on it. */
    mock: z.string().min(1),
    /** Live backend; omitted for a mock-only action. */
    backend: backendSchema.optional(),
    /** Canonical example input for docs/example rendering. */
    exampleInput: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
export type ConnectorAction = z.infer<typeof connectorActionSchema>;

export const connectorSchema = z
  .object({
    name: slugSchema,
    displayName: displayNameSchema,
    /** Per-locale overrides of `displayName`, for a connector named with
     * ordinary words ("Tasks") rather than a brand ("GitHub"), which keeps its
     * name in every language. Same locale chain as an action's `title`. */
    i18n: z
      .record(
        z.string().regex(LOCALE_RE),
        z.object({ displayName: displayNameSchema.optional() }).strict(),
      )
      .optional(),
    description: z.string().min(1).max(2000),
    /** Grouping labels for the catalog (open vocabulary). */
    tags: z.array(z.string().min(1).max(64)).default([]),
    endpointMode: endpointModeSchema.default('fixed'),
    /** Hosts the live HTTP paths may reach — the SSRF allowlist for this
     * connector's `yaml-js` actions (exact hosts under `fixed`, host suffixes
     * under `per-credential`). Absent for purely native connectors. */
    allowedHosts: z.array(z.string().min(1)).default([]),
    /** Non-secret per-credential settings this connector needs (a mail server
     * host/port, an API version). A live/native body reads them as
     * `ctx.config.<key>`. Empty for connectors that need none. */
    configFields: z
      .array(configFieldSchema)
      .default([])
      .refine((f) => new Set(f.map((e) => e.key)).size === f.length, {
        message: 'config field keys must be unique per connector',
      }),
    auth: z
      .array(connectorAuthMethodSchema)
      .min(1)
      .refine((m) => new Set(m.map((e) => e.method)).size === m.length, {
        message: 'auth methods must be unique per connector',
      })
      .refine(
        (m) => !m.some((e) => e.method === 'platform') || m.length === 1,
        {
          message:
            'platform auth stands alone — a connector is either the platform itself or it holds vendor credentials, never both',
        },
      ),
    /**
     * Whether a call must act as a stored credential. `optional` lets a node
     * name none: the call then carries no credential at all — never the
     * organization's default one — and its native backend decides what such
     * a call may reach (the generic HTTP connector's public hosts).
     */
    credential: z.enum(['required', 'optional']).default('required'),
    /**
     * JavaScript every `yaml-js` live body of this connector starts with:
     * the helpers its actions share (Outlook's Graph mailbox root and its
     * refusal sentences), written once instead of copied into each body. It
     * runs in the body's own scope, with the same `input` and `ctx`, and
     * declares names the bodies then use; it returns nothing.
     */
    livePrelude: z.string().min(1).optional(),
    actions: z
      .array(connectorActionSchema)
      .min(1)
      .refine((a) => new Set(a.map((e) => e.name)).size === a.length, {
        message: 'action names must be unique per connector',
      }),
  })
  .strict()
  .refine(
    (connector) =>
      connector.credential === 'required' ||
      !connector.auth.some((method) => method.method === 'platform'),
    {
      message:
        'a connector that is the platform itself holds no credential to make optional',
      path: ['credential'],
    },
  )
  .superRefine((connector, context) => {
    const keys = new Set(connector.configFields.map((field) => field.key));
    const methods = new Set(connector.auth.map((entry) => entry.method));
    connector.auth.forEach((entry, index) => {
      if (entry.method !== 'oauth2' || entry.configScopes === undefined) return;
      for (const key of Object.keys(entry.configScopes))
        if (!keys.has(key))
          context.addIssue({
            code: 'custom',
            path: ['auth', index, 'configScopes', key],
            message: `configScopes names "${key}", which is not one of the connector's configFields`,
          });
    });
    connector.configFields.forEach((field, index) => {
      for (const method of field.requiredFor ?? [])
        if (!methods.has(method))
          context.addIssue({
            code: 'custom',
            path: ['configFields', index, 'requiredFor'],
            message: `requiredFor names ${method}, which the connector does not accept`,
          });
    });
  });
export type Connector = z.infer<typeof connectorSchema>;

/**
 * The program a `yaml-js` action's live path runs: its connector's
 * `livePrelude`, then the action's own body, in one scope. Every runner (in
 * process, out of process, a test) asks here, so a body never runs without
 * the helpers it was written against.
 */
export function connectorLiveBody(
  connector: Pick<Connector, 'livePrelude'>,
  live: string,
): string {
  return connector.livePrelude === undefined
    ? live
    : `${connector.livePrelude}\n${live}`;
}
