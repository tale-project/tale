import { z } from 'zod';

import {
  CliError,
  externalDepError,
  preconditionError,
  usageError,
} from '../../utils/fail';
import {
  emailAttestationProofSchema,
  type EmailAttestation,
  type EmailAttestationProof,
} from './email-attestation';
import {
  nativeClientsSchema,
  nativeOriginSchema,
  reconcileNativeClients,
  type NativeClientContext,
  type NativeClientResult,
  type NativeClientUpdate,
  type ManagedClientOptions,
} from './native-client';
import {
  provisionStatePath,
  readProvisionState,
  writeProvisionState,
} from './provision-state';

export const PRIVATE_INPUT_LIMIT = 64 * 1024;
const RESPONSE_LIMIT = 1024 * 1024;
const API_URL = 'http://127.0.0.1:3005';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const identifier = z.string().min(1).max(256);
const inputSchema = z
  .strictObject({
    bootstrap: z.literal('fresh').optional(),
    emailVerification: z.literal('operator-attested').optional(),
    origin: nativeOriginSchema,
    email: z.email().max(254),
    password: z.string().min(1).max(4096),
    // Matches the native immutable organization slug boundary.
    slug: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}(?![\s\S])/),
    name: z
      .string()
      .min(1)
      .max(200)
      .refine(
        (value) => value.trim() === value && !/[\x00-\x1f\x7f]/.test(value),
      ),
    ssoEnabled: z.boolean().default(true),
    tenantId: z.string().max(256).optional(),
    clientId: z.string().max(500).optional(),
    clientSecret: z.string().max(5000).optional(),
    nativeClients: nativeClientsSchema.default([]),
  })
  .refine((input) => !input.emailVerification || input.bootstrap === 'fresh')
  .refine(
    (input) =>
      !input.ssoEnabled ||
      (Boolean(input.tenantId && uuid.test(input.tenantId)) &&
        Boolean(input.clientId) &&
        Boolean(input.clientSecret)),
  );
export type InstanceInput = z.infer<typeof inputSchema>;
export interface ProvisionContext extends NativeClientContext {
  baseUrl: string;
  user: { id: string };
  stateDirectory?: string;
}
export interface InstanceOptions {
  fetchImpl?: (url: string, init: RequestInit) => Promise<Response>;
  nativeUpdate?: NativeClientUpdate;
  managedClients?: Omit<ManagedClientOptions, 'stateDirectory'>;
  emailAttestation?: EmailAttestation;
  stateDirectory?: string;
  provision?: (context: ProvisionContext) => Promise<void>;
}
export interface InstanceResult {
  organizationId: string;
  organizationSlug: string;
  userId: string;
  ssoEnabled: boolean;
  nativeClients: NativeClientResult[];
  emailVerification?: EmailAttestationProof;
}

/** Invalid private input must never reach a parser error containing its text. */
export function parseInstanceInput(value: unknown): InstanceInput {
  const parsed = inputSchema.safeParse(value);
  if (!parsed.success)
    throw usageError('Invalid native instance provisioning input.');
  return parsed.data;
}
export function parsePrivateInstanceJson(raw: string): InstanceInput {
  if (Buffer.byteLength(raw, 'utf8') > PRIVATE_INPUT_LIMIT)
    throw usageError('Native instance provisioning input exceeds 64 KiB.');
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw usageError('Invalid native instance provisioning JSON.');
  }
  return parseInstanceInput(value);
}

const sessionSchema = z.object({
  user: z.object({ id: identifier, email: z.string() }),
  session: z.object({
    userId: identifier,
    activeOrganizationId: z.string().nullable().optional(),
  }),
});
const organizationSchema = z.object({ id: identifier, slug: z.string() });
const connectionSchema = z
  .object({
    configured: z.boolean(),
    enabled: z.boolean(),
    otherOrgsEnabled: z.boolean(),
    protocol: z.string().nullable().optional(),
    displayName: z.string().nullable().optional(),
    oidc: z
      .object({ providerId: z.string(), issuer: z.string() })
      .passthrough()
      .nullable()
      .optional(),
  })
  .passthrough();
const entraScopes = [
  'openid',
  'profile',
  'email',
  'https://graph.microsoft.com/User.Read',
];
const provisioning = {
  autoProvisionRole: false,
  defaultRole: 'member',
  roleMappingRules: [],
  autoProvisionTeam: false,
  excludeGroups: [],
};
export const bootstrapSchema = z.strictObject({
  schemaVersion: z.literal(1),
  phase: z.enum(['pending', 'ready']),
  origin: nativeOriginSchema,
  email: z.email(),
  slug: z.string(),
  name: z.string(),
  userId: identifier.optional(),
  organizationId: identifier.optional(),
  signupAttempted: z.literal(true).optional(),
  organizationCreateAttempted: z.literal(true).optional(),
  emailVerification: z.literal('operator-attested').optional(),
});

/** Account/provider writes use supported native HTTP. The caller can inject a
 * narrow backend-local client updater; session credentials remain in memory. */
export async function configureInstance(
  raw: unknown,
  options: InstanceOptions = {},
): Promise<InstanceResult> {
  const input = parseInstanceInput(raw);
  if (
    input.emailVerification &&
    (!options.emailAttestation || !options.stateDirectory)
  )
    throw preconditionError(
      'Operator email attestation requires private managed native verification.',
    );
  if (
    input.nativeClients.some((client) => client.managed) &&
    !options.stateDirectory
  )
    throw preconditionError(
      'Fresh native clients require private managed deployment state.',
    );
  let bootstrap:
    | { file: string; intent: z.infer<typeof bootstrapSchema> }
    | undefined;
  if (input.bootstrap === 'fresh') {
    if (!options.stateDirectory)
      throw preconditionError(
        'Fresh bootstrap requires private managed deployment state.',
      );
    const file = provisionStatePath(options.stateDirectory, 'bootstrap.json');
    const existing = readProvisionState(file, bootstrapSchema);
    if (
      existing &&
      (existing.origin !== input.origin ||
        existing.email !== input.email.toLowerCase() ||
        existing.slug !== input.slug ||
        existing.name !== input.name ||
        existing.emailVerification !== input.emailVerification)
    )
      throw preconditionError(
        'Fresh bootstrap intent differs from the configured identity.',
      );
    const intent =
      existing ??
      bootstrapSchema.parse({
        schemaVersion: 1,
        phase: 'pending',
        origin: input.origin,
        email: input.email.toLowerCase(),
        slug: input.slug,
        name: input.name,
        ...(input.emailVerification
          ? { emailVerification: input.emailVerification }
          : {}),
      });
    if (!existing) {
      provisionStatePath(options.stateDirectory, 'bootstrap.json', true);
      writeProvisionState(file, intent, true);
    }
    bootstrap = { file, intent };
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const cookies = new Map<string, string>();
  const headers = () =>
    new Headers({
      'content-type': 'application/json',
      origin: input.origin,
      cookie: [...cookies]
        .map(([name, value]) => `${name}=${value}`)
        .join('; '),
    });
  async function request(
    path: string,
    method = 'GET',
    body?: unknown,
  ): Promise<Response> {
    // The callback gets only this scoped request, never a credential-bearing
    // general URL fetch. URL normalization must not escape the native API.
    const target = new URL(path, API_URL);
    if (
      !path.startsWith('/api/') ||
      target.origin !== API_URL ||
      !target.pathname.startsWith('/api/') ||
      target.hash
    )
      throw preconditionError('Invalid native provisioning request path.');
    let response: Response;
    try {
      response = await fetchImpl(target.href, {
        method,
        headers: headers(),
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(30_000),
        redirect: 'error',
      });
    } catch {
      throw externalDepError(
        'Native provisioning request failed or timed out.',
      );
    }
    const incoming = response.headers.getSetCookie();
    if (incoming.join('').length > 16 * 1024)
      throw externalDepError(
        'Native authentication returned oversized cookies.',
      );
    for (const value of incoming) {
      const pair = value.split(';', 1)[0];
      const index = pair.indexOf('=');
      if (index < 1)
        throw externalDepError(
          'Native authentication returned an invalid cookie.',
        );
      const name = pair.slice(0, index);
      const content = pair.slice(index + 1);
      if (!content || /;\s*max-age=0(?:;|$)/i.test(value)) cookies.delete(name);
      else cookies.set(name, content);
    }
    return response;
  }
  async function requireJson(
    response: Response,
    operation: string,
  ): Promise<unknown> {
    if (!response.ok)
      throw externalDepError(`${operation} failed (HTTP ${response.status}).`);
    try {
      if (!response.body) throw new Error('Missing response');
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const item = await reader.read();
          if (item.done) break;
          size += item.value.byteLength;
          if (size > RESPONSE_LIMIT) {
            await reader.cancel();
            throw new Error('Response too large');
          }
          chunks.push(item.value);
        }
      } finally {
        reader.releaseLock();
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    } catch {
      throw externalDepError(
        `${operation} returned invalid or oversized JSON.`,
      );
    }
  }
  async function session(expectedOrg?: string) {
    const value = sessionSchema.safeParse(
      await requireJson(
        await request('/api/auth/get-session'),
        'Administrator session',
      ),
    );
    if (
      !value.success ||
      value.data.user.email.toLowerCase() !== input.email.toLowerCase() ||
      value.data.session.userId !== value.data.user.id ||
      (expectedOrg !== undefined &&
        value.data.session.activeOrganizationId !== expectedOrg)
    )
      throw preconditionError(
        'Administrator session does not match the configured local account and organization.',
      );
    return value.data;
  }
  let result: InstanceResult | undefined;
  let failure: unknown;
  try {
    let login = await request('/api/auth/sign-in/email', 'POST', {
      email: input.email,
      password: input.password,
    });
    if (login.status === 401 && bootstrap?.intent.userId)
      throw preconditionError(
        'The retained bootstrap account could not authenticate; no replacement account was created.',
      );
    // Local-only migrations must prove the original local account, never create
    // a replacement. Public Entra mode retains native first-boot semantics.
    if (
      login.status === 401 &&
      (input.ssoEnabled || input.bootstrap === 'fresh')
    ) {
      if (bootstrap?.intent.signupAttempted)
        throw preconditionError(
          'Bootstrap account creation is uncertain; review its retained intent before retrying.',
        );
      if (bootstrap) {
        bootstrap.intent = { ...bootstrap.intent, signupAttempted: true };
        writeProvisionState(bootstrap.file, bootstrap.intent);
      }
      login = await request('/api/auth/sign-up/email', 'POST', {
        email: input.email,
        password: input.password,
        name: 'Tale Administrator',
      });
    }
    const authenticated = z
      .object({ twoFactorRedirect: z.boolean().optional() })
      .safeParse(await requireJson(login, 'Administrator authentication'));
    if (!authenticated.success)
      throw preconditionError(
        'Unexpected administrator authentication response.',
      );
    if (authenticated.data.twoFactorRedirect)
      throw preconditionError(
        'Administrator MFA requires an interactive operator session.',
      );
    if (cookies.size === 0)
      throw preconditionError(
        'Administrator authentication returned no session.',
      );
    const verifiedSession = await session();
    if (
      bootstrap?.intent.userId &&
      bootstrap.intent.userId !== verifiedSession.user.id
    )
      throw preconditionError(
        'Fresh bootstrap account differs from its retained identity.',
      );
    if (bootstrap && !bootstrap.intent.userId) {
      bootstrap.intent = {
        ...bootstrap.intent,
        userId: verifiedSession.user.id,
      };
      writeProvisionState(bootstrap.file, bootstrap.intent);
    }
    let emailVerification: EmailAttestationProof | undefined;
    if (input.emailVerification) {
      if (!options.emailAttestation || !options.stateDirectory)
        throw preconditionError('Managed email verification is unavailable.');
      emailVerification = emailAttestationProofSchema.parse(
        await options.emailAttestation({
          userId: verifiedSession.user.id,
          email: input.email,
          headers: headers(),
          stateDirectory: options.stateDirectory,
        }),
      );
      if (
        emailVerification.userId !== verifiedSession.user.id ||
        emailVerification.email !== input.email.toLowerCase() ||
        emailVerification.receipt.path !==
          provisionStatePath(options.stateDirectory, 'email-attestation.json')
      )
        throw preconditionError(
          'Native email verification differs from the declared operator.',
        );
    }
    const organizations = z
      .array(organizationSchema)
      .max(1000)
      .safeParse(
        await requireJson(
          await request('/api/auth/organization/list'),
          'Organization lookup',
        ),
      );
    if (!organizations.success)
      throw preconditionError('Unexpected organization response.');
    const matches = organizations.data.filter(
      (value) => value.slug === input.slug,
    );
    if (matches.length > 1)
      throw preconditionError('Ambiguous managed organization.');
    let organization = matches[0];
    if (!organization) {
      if (bootstrap?.intent.organizationId)
        throw preconditionError(
          'The retained bootstrap organization is missing; no replacement was created.',
        );
      if (bootstrap?.intent.organizationCreateAttempted)
        throw preconditionError(
          'Bootstrap organization creation is uncertain; review its retained intent before retrying.',
        );
      if (!input.ssoEnabled && input.bootstrap !== 'fresh')
        throw preconditionError(
          'Existing managed organization is required for local-only mode.',
        );
      if (bootstrap) {
        bootstrap.intent = {
          ...bootstrap.intent,
          organizationCreateAttempted: true,
        };
        writeProvisionState(bootstrap.file, bootstrap.intent);
      }
      const created = organizationSchema.safeParse(
        await requireJson(
          await request('/api/auth/organization/create', 'POST', {
            name: input.name,
            slug: input.slug,
          }),
          'Organization bootstrap',
        ),
      );
      if (!created.success || created.data.slug !== input.slug)
        throw preconditionError('Unexpected managed organization identity.');
      organization = created.data;
    }
    if (
      bootstrap?.intent.organizationId &&
      bootstrap.intent.organizationId !== organization.id
    )
      throw preconditionError(
        'Fresh bootstrap organization differs from its retained identity.',
      );
    if (verifiedSession.session.activeOrganizationId !== organization.id) {
      await requireJson(
        await request('/api/auth/organization/set-active', 'POST', {
          organizationId: organization.id,
        }),
        'Select managed organization',
      );
      const selected = await session(organization.id);
      if (selected.user.id !== verifiedSession.user.id)
        throw preconditionError(
          'Administrator identity changed while selecting the managed organization.',
        );
    }
    if (bootstrap && !bootstrap.intent.organizationId) {
      bootstrap.intent = {
        ...bootstrap.intent,
        organizationId: organization.id,
      };
      writeProvisionState(bootstrap.file, bootstrap.intent);
    }
    const configPath = `/api/app/sso/config?orgId=${encodeURIComponent(organization.id)}`;
    if (input.ssoEnabled) {
      await requireJson(
        await request(
          `/api/app/sso/config/oidc?orgId=${encodeURIComponent(organization.id)}`,
          'PUT',
          {
            displayName: 'Microsoft Entra ID',
            providerId: 'entra-id',
            issuer: `https://login.microsoftonline.com/${input.tenantId}/v2.0`,
            clientId: input.clientId,
            clientSecret: input.clientSecret,
            scopes: entraScopes,
            pkce: true,
            ...provisioning,
          },
        ),
        'Entra SSO configuration',
      );
    } else {
      const connection = connectionSchema.safeParse(
        await requireJson(
          await request(configPath),
          'SSO configuration lookup',
        ),
      );
      if (!connection.success)
        throw preconditionError('Unexpected SSO configuration response.');
      const config = connection.data;
      if (config.otherOrgsEnabled)
        throw preconditionError(
          'Only the managed Entra connection may be removed; another organization has SSO.',
        );
      if (config.configured) {
        if (
          config.protocol !== 'oidc' ||
          config.displayName !== 'Microsoft Entra ID' ||
          config.oidc?.providerId !== 'entra-id' ||
          !/^https:\/\/login\.microsoftonline\.com\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/v2\.0$/i.test(
            config.oidc.issuer,
          )
        )
          throw preconditionError(
            'Refusing to remove an unrecognized managed Entra connection.',
          );
        await requireJson(
          await request(configPath, 'DELETE'),
          'Managed Entra removal',
        );
      }
      const after = connectionSchema.safeParse(
        await requireJson(
          await request(configPath),
          'SSO removal verification',
        ),
      );
      if (
        !after.success ||
        after.data.configured ||
        after.data.enabled ||
        after.data.otherOrgsEnabled
      )
        throw preconditionError('Managed Entra connection remains configured.');
    }
    const status = z
      .object({ enabled: z.boolean(), multiple: z.boolean().optional() })
      .safeParse(
        await requireJson(
          await request('/api/app/sso/discovery/configured'),
          'SSO discovery',
        ),
      );
    if (
      !status.success ||
      (input.ssoEnabled
        ? !status.data.enabled || status.data.multiple !== false
        : status.data.enabled)
    )
      throw preconditionError(
        'SSO discovery does not match the destination policy.',
      );
    const context: ProvisionContext = {
      baseUrl: API_URL,
      origin: input.origin,
      organization,
      user: { id: verifiedSession.user.id },
      request,
      requireJson,
      headers,
      ...(options.stateDirectory
        ? { stateDirectory: options.stateDirectory }
        : {}),
    };
    const nativeClients = await reconcileNativeClients(
      context,
      input.nativeClients,
      options.nativeUpdate,
      { ...options.managedClients, stateDirectory: options.stateDirectory },
    );
    if (options.provision) {
      try {
        await options.provision(context);
      } catch {
        throw externalDepError('Native configuration provisioning failed.');
      }
    }
    result = {
      organizationId: organization.id,
      organizationSlug: organization.slug,
      userId: verifiedSession.user.id,
      ssoEnabled: input.ssoEnabled,
      nativeClients,
      ...(emailVerification ? { emailVerification } : {}),
    };
    if (bootstrap && bootstrap.intent.phase !== 'ready')
      writeProvisionState(bootstrap.file, {
        ...bootstrap.intent,
        phase: 'ready',
        userId: result.userId,
        organizationId: result.organizationId,
      });
  } catch (error) {
    failure =
      error instanceof CliError
        ? error
        : externalDepError('Native instance provisioning failed.');
  } finally {
    if (cookies.size > 0) {
      let cleanupFailed = false;
      try {
        const cleaned = z
          .object({ success: z.literal(true) })
          .safeParse(
            await requireJson(
              await request('/api/auth/sign-out', 'POST', {}),
              'Bootstrap session cleanup',
            ),
          );
        cleanupFailed = !cleaned.success;
      } catch {
        cleanupFailed = true;
      } finally {
        cookies.clear();
      }
      if (cleanupFailed)
        failure = externalDepError(
          failure
            ? 'Native instance provisioning failed; temporary session cleanup also failed.'
            : 'Temporary native session cleanup failed.',
        );
    }
  }
  if (failure) throw failure;
  if (!result)
    throw externalDepError('Native instance provisioning did not complete.');
  return result;
}
