import { randomBytes } from 'node:crypto';

import { z } from 'zod';

import { externalDepError, preconditionError } from '../../utils/fail';
import {
  provisionStatePath,
  readProvisionState,
  readProvisionStateProof,
  writeProvisionState,
} from './provision-state';

export const identifier = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[^\x00-\x20\x7f]+(?![\s\S])/);
const redirectUri = z
  .string()
  .regex(/^[^\x00-\x20\x7f]+(?![\s\S])/)
  .url()
  .max(2048)
  .refine((value) => {
    const url = new URL(value);
    return (
      url.protocol === 'https:' && !url.username && !url.password && !url.hash
    );
  });
export const nativeOriginSchema = redirectUri
  .refine((value) => {
    const url = new URL(value);
    return url.pathname === '/' && !url.search;
  })
  .transform((value) => new URL(value).origin);
export const clientSchema = z.strictObject({
  key: z.string().regex(/^[a-z][a-z0-9-]{0,63}(?![\s\S])/),
  name: z
    .string()
    .min(1)
    .max(100)
    .refine(
      (value) => value.trim() === value && !/[\x00-\x1f\x7f]/.test(value),
    ),
  clientId: identifier.optional(),
  managed: z.literal(true).optional(),
  redirectUris: z
    .array(redirectUri)
    .min(1)
    .max(16)
    .refine((values) => new Set(values).size === values.length),
});
export const nativeClientsSchema = z
  .array(clientSchema)
  .max(16)
  .refine(
    (clients) =>
      new Set(clients.map((client) => client.key)).size === clients.length &&
      new Set(
        clients.flatMap((client) => (client.clientId ? [client.clientId] : [])),
      ).size === clients.filter((client) => client.clientId).length &&
      clients.every(
        (client) =>
          (client.clientId === undefined) !== (client.managed === undefined),
      ),
  );
export type NativeClientInput = z.infer<typeof clientSchema>;
export interface NativeClientResult {
  key: string;
  clientId: string;
  changed: boolean;
  credentials?: { path: string; sha256: string };
}
export interface NativeClientContext {
  origin: string;
  organization: { id: string; slug: string };
  request: (path: string, method?: string, body?: unknown) => Promise<Response>;
  requireJson: (response: Response, operation: string) => Promise<unknown>;
  headers: () => Headers;
  user?: { id: string };
}
const updateBodySchema = z.strictObject({
  client_id: identifier,
  update: z.strictObject({
    client_name: clientSchema.shape.name,
    redirect_uris: clientSchema.shape.redirectUris,
  }),
});
export interface NativeClientUpdateArgs {
  headers: Headers;
  body: z.infer<typeof updateBodySchema>;
}
export type NativeClientUpdate = (
  args: NativeClientUpdateArgs,
) => Promise<void>;

export const credentialSchema = z.strictObject({
  clientId: identifier,
  clientSecret: z.string().regex(/^[A-Za-z0-9_-]{43}(?![\s\S])/),
});
export type NativeClientCredentials = z.infer<typeof credentialSchema>;
const createBodySchema = z.strictObject({
  client_name: clientSchema.shape.name,
  software_id: clientSchema.shape.key,
  redirect_uris: clientSchema.shape.redirectUris,
  scope: z.literal('openid profile email tale:organization'),
  grant_types: z.tuple([z.literal('authorization_code')]),
  response_types: z.tuple([z.literal('code')]),
  token_endpoint_auth_method: z.literal('client_secret_post'),
  type: z.literal('web'),
  require_pkce: z.literal(true),
  skip_consent: z.literal(false),
  metadata: z.strictObject({ taleOrganizationId: identifier }),
});
export interface NativeClientCreateArgs {
  headers: Headers;
  body: z.infer<typeof createBodySchema>;
  credentials: NativeClientCredentials;
}
export type NativeClientCreate = (
  args: NativeClientCreateArgs,
) => Promise<void>;
export type NativeClientVerify = (
  credentials: NativeClientCredentials,
) => Promise<void>;
export interface ManagedClientOptions {
  stateDirectory?: string;
  create?: NativeClientCreate;
  verify?: NativeClientVerify;
}
export const intentSchema = z.strictObject({
  schemaVersion: z.literal(1),
  phase: z.enum(['pending', 'ready']),
  origin: nativeOriginSchema,
  organizationId: identifier,
  operatorUserId: identifier,
  body: createBodySchema,
  credentials: credentialSchema,
});
export type ClientIntent = z.infer<typeof intentSchema>;

export const existingSchema = z.object({
  software_id: z.string(),
  client_id: z.string(),
  client_name: z.string(),
  redirect_uris: z.array(z.string()),
  disabled: z.boolean(),
  require_pkce: z.boolean(),
  skip_consent: z.boolean(),
  token_endpoint_auth_method: z.string(),
  grant_types: z.array(z.string()),
  response_types: z.array(z.string()),
  scope: z.string(),
  type: z.string(),
  taleOrganizationId: z.string(),
});
type ExistingClient = z.infer<typeof existingSchema>;
const scopes = ['openid', 'profile', 'email', 'tale:organization'].sort();

/** Shared native OAuth security policy for reconciliation and read-only export. */
export function assertNativeClientPolicy(
  client: ExistingClient,
  organizationId: string,
): void {
  if (
    client.disabled ||
    !client.require_pkce ||
    client.skip_consent ||
    client.token_endpoint_auth_method !== 'client_secret_post' ||
    client.grant_types.join(' ') !== 'authorization_code' ||
    client.response_types.join(' ') !== 'code' ||
    client.type !== 'web' ||
    JSON.stringify(client.scope.split(' ').sort()) !== JSON.stringify(scopes) ||
    client.taleOrganizationId !== organizationId
  )
    throw preconditionError(
      'Existing native client security policy does not match.',
    );
}
function matches(client: ExistingClient, desired: NativeClientInput): boolean {
  return (
    client.client_name === desired.name &&
    JSON.stringify(client.redirect_uris) ===
      JSON.stringify(desired.redirectUris)
  );
}

/** Existing exact IDs retain their adoption behavior. Explicit managed clients
 * additionally bind one prewritten credential intent; uncertain creates never
 * repeat, and only authenticated native readback can complete their handoff. */
export async function reconcileNativeClients(
  context: NativeClientContext,
  input: unknown,
  update?: NativeClientUpdate,
  managed: ManagedClientOptions = {},
): Promise<NativeClientResult[]> {
  const parsed = nativeClientsSchema.safeParse(input);
  if (!parsed.success)
    throw preconditionError('Invalid managed native client input.');
  const desiredClients = parsed.data;
  if (!desiredClients.length) return [];
  const fresh =
    managed.stateDirectory &&
    managed.create &&
    managed.verify &&
    context.user?.id
      ? {
          directory: managed.stateDirectory,
          create: managed.create,
          verify: managed.verify,
          userId: context.user.id,
        }
      : undefined;
  if (desiredClients.some((client) => client.managed) && !fresh)
    throw preconditionError(
      'Fresh native clients require private managed state and backend-local adapters.',
    );
  const states = desiredClients.map((desired) => {
    if (!desired.managed) return undefined;
    if (!fresh)
      throw preconditionError('Fresh native client adapters are missing.');
    const file = provisionStatePath(
      fresh.directory,
      `client-${desired.key}.json`,
    );
    const intent = readProvisionState(file, intentSchema);
    if (
      intent &&
      (intent.origin !== context.origin ||
        intent.organizationId !== context.organization.id ||
        intent.operatorUserId !== context.user?.id ||
        intent.body.software_id !== desired.key ||
        intent.body.metadata.taleOrganizationId !== context.organization.id ||
        (intent.phase === 'pending' &&
          (intent.body.client_name !== desired.name ||
            JSON.stringify(intent.body.redirect_uris) !==
              JSON.stringify(desired.redirectUris))))
    )
      throw preconditionError(
        'Private native client intent differs from the verified target.',
      );
    return { file, intent };
  });
  const path = `/api/app/identity/clients?orgId=${encodeURIComponent(context.organization.id)}`;
  async function read(
    allowFresh = false,
  ): Promise<(ExistingClient | undefined)[]> {
    const raw = await context.requireJson(
      await context.request(path),
      'Native client lookup',
    );
    const list = z
      .object({ clients: z.array(z.unknown()).max(100) })
      .safeParse(raw);
    if (!list.success)
      throw preconditionError('Invalid native client response.');
    let missing = 0;
    const found = desiredClients.map((desired, index) => {
      const candidates = list.data.clients.filter(
        (value) =>
          typeof value === 'object' &&
          value !== null &&
          'software_id' in value &&
          value.software_id === desired.key,
      );
      const intent = states[index]?.intent;
      if (!candidates.length && desired.managed && allowFresh && !intent) {
        missing++;
        return undefined;
      }
      const checked =
        candidates.length === 1
          ? existingSchema.safeParse(candidates[0])
          : null;
      if (
        !checked?.success ||
        checked.data.client_id !==
          (intent?.credentials.clientId ?? desired.clientId)
      )
        throw preconditionError(
          'Existing native client identity does not match the configured client.',
        );
      const client = checked.data;
      assertNativeClientPolicy(client, context.organization.id);
      return client;
    });
    if (list.data.clients.length + missing > 100)
      throw preconditionError('Native client limit would be exceeded.');
    return found;
  }
  const before = await read(true);
  if (
    !update &&
    before.some(
      (client, index) => client && !matches(client, desiredClients[index]),
    )
  )
    throw preconditionError(
      'Native client changes require the managed backend-local compatibility adapter.',
    );
  async function verifySecret(intent: ClientIntent) {
    try {
      if (!fresh) throw new Error('Missing native credential verifier');
      await fresh.verify(intent.credentials);
    } catch {
      throw preconditionError(
        'Native client credential verification failed; retained credentials were not changed.',
      );
    }
  }
  // Admit every retained identity and credential before creating/updating any client.
  for (const state of states)
    if (state?.intent) await verifySecret(state.intent);
  const results: NativeClientResult[] = [];
  let after = before;
  for (const [index, desired] of desiredClients.entries()) {
    const state = states[index];
    let changed = !before[index] || !matches(before[index], desired);
    if (!before[index]) {
      if (!fresh || !state)
        throw preconditionError('Fresh native client state is missing.');
      const body = createBodySchema.parse({
        client_name: desired.name,
        software_id: desired.key,
        redirect_uris: desired.redirectUris,
        scope: 'openid profile email tale:organization',
        grant_types: ['authorization_code'],
        response_types: ['code'],
        token_endpoint_auth_method: 'client_secret_post',
        type: 'web',
        require_pkce: true,
        skip_consent: false,
        metadata: { taleOrganizationId: context.organization.id },
      });
      const intent = intentSchema.parse({
        schemaVersion: 1,
        phase: 'pending',
        origin: context.origin,
        organizationId: context.organization.id,
        operatorUserId: fresh.userId,
        body,
        credentials: {
          clientId: randomBytes(32).toString('base64url'),
          clientSecret: randomBytes(32).toString('base64url'),
        },
      });
      provisionStatePath(fresh.directory, `client-${desired.key}.json`, true);
      writeProvisionState(state.file, intent, true);
      state.intent = intent;
      try {
        await fresh.create({
          headers: context.headers(),
          body,
          credentials: intent.credentials,
        });
      } catch {
        throw externalDepError(
          'Native client creation did not complete; retained intent requires exact readback before recovery.',
        );
      }
      after = await read(true);
      if (!after[index] || !matches(after[index], desired))
        throw preconditionError('Native client creation did not converge.');
      await verifySecret(intent);
    } else if (changed) {
      if (!update)
        throw preconditionError('Native client update adapter is missing.');
      try {
        await update({
          headers: context.headers(),
          body: {
            client_id: before[index].client_id,
            update: {
              client_name: desired.name,
              redirect_uris: desired.redirectUris,
            },
          },
        });
      } catch {
        throw externalDepError('Native client update failed.');
      }
      after = await read(true);
      if (!after[index] || !matches(after[index], desired))
        throw preconditionError(
          'Native client callback update did not converge.',
        );
    }
    let credentials: NativeClientResult['credentials'];
    if (state?.intent) {
      if (state.intent.phase === 'pending') {
        changed = true;
        state.intent = { ...state.intent, phase: 'ready' };
        credentials = writeProvisionState(state.file, state.intent);
      } else {
        // The receipt proves exact existing bytes without changing the journal.
        const retained = readProvisionStateProof(state.file, intentSchema);
        if (
          !retained ||
          JSON.stringify(retained.value) !== JSON.stringify(state.intent)
        )
          throw preconditionError(
            'Private native client intent changed during verification.',
          );
        credentials = { path: state.file, sha256: retained.sha256 };
      }
    }
    const client = after[index];
    if (!client)
      throw preconditionError('Native client creation did not converge.');
    results.push({
      key: desired.key,
      clientId: client.client_id,
      changed,
      ...(credentials ? { credentials } : {}),
    });
  }
  if (
    after.some(
      (client, index) => !client || !matches(client, desiredClients[index]),
    )
  )
    throw preconditionError('Native client callback update did not converge.');
  for (const state of states)
    if (state?.intent) await verifySecret(state.intent);
  return results;
}

const backendModules = {
  auth: '/app/backend/auth/auth.ts',
  sql: '/app/backend/db/sql.ts',
  api: '/app/node_modules/better-auth/dist/api/index.mjs',
  context: '/app/node_modules/@better-auth/core/dist/context/index.mjs',
} as const;
type BackendModulePath = (typeof backendModules)[keyof typeof backendModules];
interface Pool {
  end: () => Promise<unknown>;
}
interface NativeAuth {
  api: {
    adminUpdateOAuthClient: (args: NativeClientUpdateArgs) => Promise<unknown>;
  };
  options: { database: Pool; plugins?: unknown[] };
  $context?: Promise<unknown>;
}
interface AuthOptions {
  databaseUrl: string;
  secret: string;
  baseUrl: string;
  sql: Pool;
}
export interface BackendAdapterOptions {
  origin: string;
  env?: { DATABASE_URL?: string; BETTER_AUTH_SECRET?: string };
  /** Dependency injection for isolated tests, never read from private input. */
  loadModule?: (id: BackendModulePath) => Promise<unknown>;
}
const poolSchema = z.object({
  end: z.custom<Pool['end']>((value) => typeof value === 'function'),
});

/** Only fixed in-container modules are loaded. Each operation owns an isolated
 * auth instance; no running server singleton, public route, or raw SQL changes. */
export async function withBackendAuth(
  options: BackendAdapterOptions,
  operation: (auth: NativeAuth) => Promise<void>,
): Promise<void> {
  const env = options.env ?? process.env;
  const origin = nativeOriginSchema.safeParse(options.origin);
  if (!origin.success)
    throw preconditionError(
      'Native client changes require a valid managed origin.',
    );
  if (!env.DATABASE_URL || !env.BETTER_AUTH_SECRET)
    throw preconditionError(
      'Native client changes require the managed backend environment.',
    );
  const load =
    options.loadModule ?? (async (id) => import(id) as Promise<unknown>);
  let sql: Pool | undefined;
  let auth: NativeAuth | undefined;
  let failed = false;
  try {
    const sqlModule = z
      .object({
        createSql: z.custom<(url: string) => Pool>(
          (value) => typeof value === 'function',
        ),
      })
      .parse(await load(backendModules.sql));
    const authModule = z
      .object({
        createAuth: z.custom<(input: AuthOptions) => NativeAuth>(
          (value) => typeof value === 'function',
        ),
      })
      .parse(await load(backendModules.auth));
    const createdSql = sqlModule.createSql(env.DATABASE_URL);
    if (typeof createdSql?.end !== 'function')
      throw new Error('Invalid backend pool');
    sql = createdSql;
    auth = authModule.createAuth({
      databaseUrl: env.DATABASE_URL,
      secret: env.BETTER_AUTH_SECRET,
      baseUrl: origin.data,
      sql,
    });
    if (
      !z
        .object({
          options: z.object({ database: poolSchema }),
          api: z.object({}),
        })
        .safeParse(auth).success
    )
      throw new Error('Invalid backend auth');
    await operation(auth);
  } catch {
    failed = true;
  } finally {
    const sqlPool = sql;
    const authPool = auth?.options?.database;
    const cleanup = await Promise.allSettled([
      ...(sqlPool ? [Promise.resolve().then(() => sqlPool.end())] : []),
      ...(authPool && typeof authPool.end === 'function' && authPool !== sqlPool
        ? [Promise.resolve().then(() => authPool.end())]
        : []),
    ]);
    if (cleanup.some((result) => result.status === 'rejected')) failed = true;
  }
  if (failed) throw externalDepError('Native client update failed.');
}

export function createBackendNativeUpdate(
  options: BackendAdapterOptions,
): NativeClientUpdate {
  return async (args) => {
    const body = updateBodySchema.safeParse(args.body);
    if (!body.success)
      throw preconditionError('Invalid managed native client update.');
    await withBackendAuth(options, async (auth) => {
      if (typeof auth.api.adminUpdateOAuthClient !== 'function')
        throw new Error('Missing native update');
      await auth.api.adminUpdateOAuthClient({
        headers: args.headers,
        body: body.data,
      });
    });
  };
}

interface ProviderOptions {
  generateClientId?: () => string;
  generateClientSecret?: () => string;
}
function providerOptions(auth: NativeAuth): ProviderOptions {
  const candidates = (auth.options.plugins ?? []).filter(
    (plugin) =>
      typeof plugin === 'object' &&
      plugin !== null &&
      'id' in plugin &&
      plugin.id === 'oauth-provider',
  );
  const policy = z.object({
    id: z.literal('oauth-provider'),
    options: z
      .object({
        allowDynamicClientRegistration: z.literal(false),
        allowUnauthenticatedClientRegistration: z.literal(false),
        disableJwtPlugin: z.literal(false),
        storeClientSecret: z.literal('hashed'),
        grantTypes: z.tuple([z.literal('authorization_code')]),
        scopes: z
          .array(z.string())
          .refine(
            (values) =>
              JSON.stringify([...values].sort()) === JSON.stringify(scopes),
          ),
        validAudiences: z.tuple([]),
        codeExpiresIn: z.literal(60),
        accessTokenExpiresIn: z.literal(300),
        idTokenExpiresIn: z.literal(300),
        prefix: z.undefined(),
        generateClientId: z.undefined(),
        generateClientSecret: z.undefined(),
        clientReference: z.custom((value) => typeof value === 'function'),
        clientPrivileges: z.custom((value) => typeof value === 'function'),
      })
      .passthrough(),
  });
  if (candidates.length !== 1 || !policy.safeParse(candidates[0]).success)
    throw new Error('Native provider policy differs');
  // Return the actual exposed opts object, not Zod's copy. The maintained
  // provider factory captures this very object in its endpoint closures.
  return (candidates[0] as { options: ProviderOptions }).options;
}
const freshApiSchema = z.object({
  adminCreateOAuthClient: z.custom<
    (args: {
      headers: Headers;
      body: z.infer<typeof createBodySchema>;
    }) => Promise<unknown>
  >((value) => typeof value === 'function'),
  oauth2Introspect: z.custom<
    (args: {
      body: {
        client_id: string;
        client_secret: string;
        token: string;
        token_type_hint: 'access_token';
      };
    }) => Promise<unknown>
  >((value) => typeof value === 'function'),
});

/** The supported generator callbacks bind stored credentials to a durable intent.
 * Introspection authenticates that exact secret using a nonexistent opaque token:
 * no token is issued, and native OAuth validation owns the hash comparison. */
export function createBackendNativeClients(
  options: BackendAdapterOptions,
): Required<Pick<ManagedClientOptions, 'create' | 'verify'>> {
  return {
    create: async (args) => {
      const body = createBodySchema.safeParse(args.body);
      const credentials = credentialSchema.safeParse(args.credentials);
      if (!body.success || !credentials.success)
        throw preconditionError('Invalid managed native client creation.');
      await withBackendAuth(options, async (auth) => {
        const native = freshApiSchema.parse(auth.api);
        const policy = providerOptions(auth);
        policy.generateClientId = () => credentials.data.clientId;
        policy.generateClientSecret = () => credentials.data.clientSecret;
        const created = z
          .object({ client_id: identifier, client_secret: z.string() })
          .parse(
            await native.adminCreateOAuthClient({
              headers: args.headers,
              body: body.data,
            }),
          );
        if (
          created.client_id !== credentials.data.clientId ||
          created.client_secret !== credentials.data.clientSecret
        )
          throw new Error('Native generated identity differs');
      });
    },
    verify: async (value) => {
      const credentials = credentialSchema.safeParse(value);
      if (!credentials.success)
        throw preconditionError('Invalid retained native credentials.');
      await withBackendAuth(options, async (auth) => {
        providerOptions(auth);
        const native = freshApiSchema.parse(auth.api);
        let proof: unknown;
        try {
          proof = await native.oauth2Introspect({
            body: {
              client_id: credentials.data.clientId,
              client_secret: credentials.data.clientSecret,
              token: `tale-provision-verification-${randomBytes(32).toString('base64url')}`,
              token_type_hint: 'access_token',
            },
          });
        } catch (error) {
          // Maintained OAuth provider versions authenticate first, but represent
          // an unknown opaque token as this exact APIError instead of active:false.
          // Never accept invalid_client, generic HTTP 400, or arbitrary failures.
          if (
            !z
              .object({
                status: z.literal('BAD_REQUEST'),
                statusCode: z.literal(400),
                body: z.strictObject({
                  error: z.literal('invalid_request'),
                  error_description: z.literal('Invalid access token'),
                }),
              })
              .safeParse(error).success
          )
            throw error;
          proof = { active: false };
        }
        if (
          !z.strictObject({ active: z.literal(false) }).safeParse(proof).success
        )
          throw new Error('Native credential verification did not converge');
      });
    },
  };
}
