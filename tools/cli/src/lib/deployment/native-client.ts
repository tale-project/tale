import { z } from 'zod';

import { externalDepError, preconditionError } from '../../utils/fail';

const identifier = z.string().min(1).max(256);
const redirectUri = z
  .string()
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
const clientSchema = z.strictObject({
  key: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
  name: z.string().trim().min(1).max(100),
  clientId: identifier,
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
      new Set(clients.map((client) => client.clientId)).size === clients.length,
  );
export type NativeClientInput = z.infer<typeof clientSchema>;
export interface NativeClientResult {
  key: string;
  clientId: string;
  changed: boolean;
}
export interface NativeClientContext {
  origin: string;
  organization: { id: string; slug: string };
  request: (path: string, method?: string, body?: unknown) => Promise<Response>;
  requireJson: (response: Response, operation: string) => Promise<unknown>;
  headers: () => Headers;
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

const existingSchema = z.object({
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
function matches(client: ExistingClient, desired: NativeClientInput): boolean {
  return (
    client.client_name === desired.name &&
    JSON.stringify(client.redirect_uris) ===
      JSON.stringify(desired.redirectUris)
  );
}

/** Only an existing org-owned client can converge; no registration or secret
 * rotation is reachable. All declared clients pass read-side admission first. */
export async function reconcileNativeClients(
  context: NativeClientContext,
  input: unknown,
  update?: NativeClientUpdate,
): Promise<NativeClientResult[]> {
  const parsed = nativeClientsSchema.safeParse(input);
  if (!parsed.success)
    throw preconditionError('Invalid managed native client input.');
  const desiredClients = parsed.data;
  if (desiredClients.length === 0) return [];
  const path = `/api/app/identity/clients?orgId=${encodeURIComponent(context.organization.id)}`;
  async function read(): Promise<ExistingClient[]> {
    const raw = await context.requireJson(
      await context.request(path),
      'Native client lookup',
    );
    const list = z
      .object({ clients: z.array(z.unknown()).max(100) })
      .safeParse(raw);
    if (!list.success)
      throw preconditionError('Invalid native client response.');
    return desiredClients.map((desired) => {
      const candidates = list.data.clients.filter(
        (value) =>
          typeof value === 'object' &&
          value !== null &&
          'software_id' in value &&
          value.software_id === desired.key,
      );
      const checked =
        candidates.length === 1
          ? existingSchema.safeParse(candidates[0])
          : null;
      if (!checked?.success || checked.data.client_id !== desired.clientId)
        throw preconditionError(
          'Existing native client identity does not match the configured client.',
        );
      const client = checked.data;
      if (
        client.disabled ||
        !client.require_pkce ||
        client.skip_consent ||
        client.token_endpoint_auth_method !== 'client_secret_post' ||
        client.grant_types.join(' ') !== 'authorization_code' ||
        client.response_types.join(' ') !== 'code' ||
        client.type !== 'web' ||
        JSON.stringify(client.scope.split(' ').sort()) !==
          JSON.stringify(scopes) ||
        client.taleOrganizationId !== context.organization.id
      )
        throw preconditionError(
          'Existing native client security policy does not match.',
        );
      return client;
    });
  }
  const before = await read();
  let after = before;
  if (
    !update &&
    before.some((client, index) => !matches(client, desiredClients[index]))
  )
    throw preconditionError(
      'Native client changes require the managed backend-local compatibility adapter.',
      'Run deploy provision inside the managed backend or supply a supported native update adapter.',
    );
  const results: NativeClientResult[] = [];
  for (const [index, desired] of desiredClients.entries()) {
    const changed = !matches(before[index], desired);
    if (changed && update) {
      try {
        await update({
          headers: context.headers(),
          body: {
            client_id: desired.clientId,
            update: {
              client_name: desired.name,
              redirect_uris: desired.redirectUris,
            },
          },
        });
      } catch {
        throw externalDepError('Native client update failed.');
      }
      after = await read();
      if (!matches(after[index], desired))
        throw preconditionError(
          'Native client callback update did not converge.',
        );
    }
    results.push({ key: desired.key, clientId: desired.clientId, changed });
  }
  // The last captured readback must attest all declared clients. A later
  // update must not hide drift in a client already converged by this command.
  if (after.some((client, index) => !matches(client, desiredClients[index])))
    throw preconditionError('Native client callback update did not converge.');
  return results;
}

const backendModules = {
  auth: '/app/backend/auth/auth.ts',
  sql: '/app/backend/db/sql.ts',
} as const;
type BackendModulePath = (typeof backendModules)[keyof typeof backendModules];
interface Pool {
  end: () => Promise<unknown>;
}
interface NativeAuth {
  api: {
    adminUpdateOAuthClient: (args: NativeClientUpdateArgs) => Promise<unknown>;
  };
  options: { database: Pool };
}
interface AuthOptions {
  databaseUrl: string;
  secret: string;
  baseUrl: string;
  sql: Pool;
}
interface BackendAdapterOptions {
  origin: string;
  env?: { DATABASE_URL?: string; BETTER_AUTH_SECRET?: string };
  /** Dependency injection for isolated tests, never read from private input. */
  loadModule?: (id: BackendModulePath) => Promise<unknown>;
}
const poolSchema = z.object({
  end: z.custom<Pool['end']>((value) => typeof value === 'function'),
});

/** Compatibility with maintained 0.5 backends: their admin update is server-only
 * and the public update endpoint is deliberately disabled. Load only the fixed
 * in-container modules, lazily for a required change; never execute raw SQL. */
export function createBackendNativeUpdate(
  options: BackendAdapterOptions,
): NativeClientUpdate {
  return async (args) => {
    const body = updateBodySchema.safeParse(args.body);
    if (!body.success)
      throw preconditionError('Invalid managed native client update.');
    const env = options.env ?? process.env;
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
      // postgres.js pools are callable objects, so validate only the end method.
      if (typeof createdSql?.end !== 'function')
        throw new Error('Invalid backend pool');
      sql = createdSql;
      auth = authModule.createAuth({
        databaseUrl: env.DATABASE_URL,
        secret: env.BETTER_AUTH_SECRET,
        baseUrl: options.origin,
        sql,
      });
      const checked = z
        .object({
          api: z.object({
            adminUpdateOAuthClient: z.custom<
              NativeAuth['api']['adminUpdateOAuthClient']
            >((value) => typeof value === 'function'),
          }),
          options: z.object({ database: poolSchema }),
        })
        .safeParse(auth);
      if (!checked.success) throw new Error('Invalid backend auth');
      await auth.api.adminUpdateOAuthClient({
        headers: args.headers,
        body: body.data,
      });
    } catch {
      failed = true;
    } finally {
      const sqlPool = sql;
      const authPool = auth?.options?.database;
      const cleanup = await Promise.allSettled([
        ...(sqlPool ? [Promise.resolve().then(() => sqlPool.end())] : []),
        ...(authPool && typeof authPool.end === 'function'
          ? [Promise.resolve().then(() => authPool.end())]
          : []),
      ]);
      if (cleanup.some((result) => result.status === 'rejected')) failed = true;
    }
    if (failed) throw externalDepError('Native client update failed.');
  };
}
