import { lstat, readFile, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';

import { stringify } from 'yaml';
import { z } from 'zod';

import { readDomainConfigFile } from '../../../../../services/platform/backend/core/lib/config_store/read_domain_file';
import { checkProviderHostPolicy } from '../../../../../services/platform/lib/net/host-policy';
import { normalizeCatalogPayload } from '../../../../../services/platform/lib/shared/providers/catalog_normalize';
import {
  policyTypeToFileBase,
  visionModelConfigSchema,
} from '../../../../../services/platform/lib/shared/schemas/governance';
import {
  KNOWLEDGE_CONFIG_DOMAIN,
  KNOWLEDGE_EMBEDDING_KEY,
  knowledgeEmbeddingSchema,
} from '../../../../../services/platform/lib/shared/schemas/knowledge';
import { providerDefinitionSchema } from '../../../../../services/platform/lib/shared/schemas/providers';
import {
  CliError,
  externalDepError,
  preconditionError,
} from '../../utils/fail';
import { sha256, valueHash } from '../config/releases/identity';
import { sha, slug } from '../config/releases/model';
import { createImmutable } from '../config/releases/release';
import {
  boundedJson,
  privateDirectory,
  readOptionalJson,
  readPrivateJson,
  writePrivateJson,
} from '../state/private-files';
import { verifyDeploymentBundle } from './bundle';
import { type ProvisionContext } from './identity';
import { modelSettingsSchema, type ModelSettings } from './model-settings';
import { boundedResponse } from './model-settings-http';

const credentialSchema = z.object({
  id: z.string().min(1).max(256),
  providerSlug: z.string(),
  authMethod: z.string(),
  name: z.string(),
  envName: z.string().nullable(),
  endpointUrl: z.string().nullable(),
  modelAllowlist: z.array(z.string()).nullable(),
  isDefault: z.boolean(),
  status: z.enum(['active', 'disabled']),
});
const credentialsSchema = z.object({
  credentials: z.array(credentialSchema).max(256),
});
const receiptSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal('tale-native-model-settings'),
  phase: z.enum(['pending', 'ready']),
  organizationId: z.string(),
  organizationSlug: slug,
  userId: z.string(),
  deploymentBundleSha256: sha,
  settingsSha256: sha,
});
type Options = {
  deploymentBundleSha256: string;
  organizationSlug: string;
  stateDirectory: string;
  configRoot?: string;
  environment?: NodeJS.ProcessEnv;
  catalogFetch?: (input: string, init: RequestInit) => Promise<Response>;
};

async function configDirectory(
  rootInput: string | undefined,
  organization: string,
): Promise<string> {
  if (
    !rootInput ||
    !isAbsolute(rootInput) ||
    resolve(rootInput) !== rootInput ||
    rootInput === '/'
  )
    throw preconditionError(
      'Native model-settings requires the backend TALE_CONFIG_DIR.',
    );
  const root = await lstat(rootInput);
  if (
    !root.isDirectory() ||
    root.isSymbolicLink() ||
    (root.mode & 0o022) !== 0 ||
    (await realpath(rootInput)) !== rootInput
  )
    throw preconditionError(
      'Native model-settings configuration root is not a safe owned directory.',
    );
  const org = join(rootInput, organization);
  const info = await lstat(org);
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    info.uid !== root.uid ||
    (info.mode & 0o022) !== 0
  )
    throw preconditionError(
      'Native model-settings organization config directory differs.',
    );
  return org;
}
async function directoryExistsSafe(
  path: string,
  owner: number,
): Promise<boolean> {
  try {
    const info = await lstat(path);
    if (
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      info.uid !== owner ||
      (info.mode & 0o022) !== 0
    )
      throw preconditionError(
        'Native model-settings config has a foreign or writable directory.',
      );
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
      return false;
    throw error;
  }
}
function same(left: unknown, right: unknown) {
  return valueHash(left) === valueHash(right);
}

/** The native command creates this private directory under its existing lock.
 * Verify the path before reading any recovery state, including ancestor links. */
async function privateStateDirectory(directory: string, owner: number) {
  if (
    !isAbsolute(directory) ||
    resolve(directory) !== directory ||
    (await realpath(directory)) !== directory
  )
    throw preconditionError(
      'Native model-settings recovery state is not a canonical owned directory.',
    );
  let current = directory;
  for (;;) {
    const info = await lstat(current);
    if (
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      (info.uid !== owner && info.uid !== 0) ||
      ((info.mode & 0o022) !== 0 && (info.mode & 0o1000) === 0) ||
      (current === directory &&
        (info.uid !== owner || (info.mode & 0o077) !== 0))
    )
      throw preconditionError(
        'Native model-settings recovery state has an unsafe owner, mode or ancestor.',
      );
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

/** Caller holds the native deployment lock and has proved this session's exact
 * organization/user. No existing provider/policy is overwritten to force a fit. */
export async function configureNativeModelSettings(
  spec: ModelSettings,
  context: ProvisionContext,
  options: Options,
) {
  try {
    slug.parse(options.organizationSlug);
    return await configureNativeModelSettingsInternal(
      modelSettingsSchema.parse(spec),
      context,
      options,
    );
  } catch (error) {
    if (error instanceof CliError) throw error;
    // Files and external JSON may contain private/untrusted text. Their parser
    // diagnostics never become CLI output, including verbose error rendering.
    throw preconditionError(
      'Native model-settings metadata is invalid or unreadable. Review the retained state.',
    );
  }
}

async function configureNativeModelSettingsInternal(
  spec: ModelSettings,
  context: ProvisionContext,
  options: Options,
) {
  if (
    context.organization.slug !== options.organizationSlug ||
    !context.organization.id ||
    !context.user.id
  )
    throw preconditionError(
      'Native model-settings context belongs to another organization.',
    );
  const environment = options.environment ?? process.env;
  for (const { definition, credential } of spec.providers) {
    const key = environment[credential.envName];
    if (!key || key.length > 8192 || /[\x00-\x1f\x7f]/.test(key))
      throw preconditionError(
        'A declared provider credential environment value is missing or invalid.',
      );
    if (!definition.baseUrl)
      throw preconditionError('Declared provider endpoint is missing.');
    checkProviderHostPolicy(definition.baseUrl);
  }
  const orgDirectory = await configDirectory(
    options.configRoot ?? environment.TALE_CONFIG_DIR,
    options.organizationSlug,
  );
  const owner = (await lstat(orgDirectory)).uid;
  await privateStateDirectory(options.stateDirectory, owner);
  const providersDirectory = join(orgDirectory, 'providers');
  const governanceDirectory = join(orgDirectory, 'governance');
  const knowledgeDirectory = join(orgDirectory, KNOWLEDGE_CONFIG_DOMAIN);
  for (const directory of [
    providersDirectory,
    governanceDirectory,
    knowledgeDirectory,
  ])
    await directoryExistsSafe(directory, owner);
  const {
    providers,
    vision: desiredVision,
    embedding: desiredEmbedding,
  } = spec;
  const settingsSha256 = valueHash(spec);
  const planned = receiptSchema.parse({
    schemaVersion: 1,
    kind: 'tale-native-model-settings',
    phase: 'pending',
    organizationId: context.organization.id,
    organizationSlug: options.organizationSlug,
    userId: context.user.id,
    deploymentBundleSha256: options.deploymentBundleSha256,
    settingsSha256,
  });
  const receiptPath = join(options.stateDirectory, 'model-settings.json');
  const previousRaw = await readOptionalJson(receiptPath);
  const previous =
    previousRaw === undefined
      ? undefined
      : receiptSchema.parse(await readPrivateJson(receiptPath, owner));
  const unchanged =
    previous?.phase === 'ready' &&
    same({ ...previous, phase: 'pending' }, planned);
  if (
    previous &&
    (previous.organizationId !== planned.organizationId ||
      previous.organizationSlug !== planned.organizationSlug ||
      previous.userId !== planned.userId ||
      (previous.phase === 'pending' && !same(previous, planned)))
  )
    throw preconditionError(
      'Native model-settings receipt differs from this bundle, organization or operator. Review the retained state.',
    );
  const request = async (path: string, method = 'GET', body?: unknown) =>
    context.requireJson(
      await context.request(
        `${path}${path.includes('?') ? '&' : '?'}orgId=${encodeURIComponent(context.organization.id)}`,
        method,
        body,
      ),
      'Native model-settings configuration',
    );
  const listCredentials = async () =>
    credentialsSchema.parse(await request('/api/app/provider-credentials/'))
      .credentials;
  let credentials = await listCredentials();
  const assertCredentials = (
    rows: z.infer<typeof credentialSchema>[],
    complete = false,
  ) => {
    if (
      rows.some(
        (row) =>
          row.status === 'active' &&
          !providers.some(
            (entry) => entry.definition.name === row.providerSlug,
          ),
      )
    )
      throw preconditionError(
        'An active unmanaged provider credential prevents exclusive provider provisioning.',
      );
    for (const { definition, models, credential } of providers) {
      const matches = rows.filter(
        (row) => row.providerSlug === definition.name,
      );
      if (
        matches.length > 1 ||
        (complete && matches.length !== 1) ||
        matches.some(
          (row) =>
            row.name !== credential.name ||
            row.authMethod !== 'env' ||
            row.envName !== credential.envName ||
            row.endpointUrl !== null ||
            !same(
              row.modelAllowlist,
              models.map((model) => model.id),
            ) ||
            row.status !== 'active' ||
            !row.isDefault,
        )
      )
        throw preconditionError(
          'An existing native model-settings credential differs; no key or default was changed.',
        );
    }
  };
  // A completed deployment is an adoption proof, not permission to recreate
  // missing native state. Pending initial work alone may finish known creates.
  assertCredentials(credentials, previous?.phase === 'ready');
  const providerFiles = [];
  for (const entry of providers) {
    const file = join(providersDirectory, `${entry.definition.name}.yml`);
    const prior = await readDomainConfigFile(
      providersDirectory,
      entry.definition.name,
      65536,
      (data) => providerDefinitionSchema.parse(data),
    );
    if (
      (!prior.ok &&
        (prior.error !== 'not_found' || previous?.phase === 'ready')) ||
      (prior.ok &&
        (prior.format !== 'yaml' || !same(prior.data, entry.definition)))
    )
      throw preconditionError(
        'Existing native provider file differs or is unreadable; it was preserved.',
      );
    providerFiles.push({
      ...entry,
      file,
      present: prior.ok,
      content: stringify(entry.definition),
    });
  }
  const priorVision = await readDomainConfigFile(
    governanceDirectory,
    policyTypeToFileBase('vision_model'),
    65536,
    (data) => visionModelConfigSchema.parse(data),
  );
  if (!priorVision.ok && priorVision.error !== 'not_found')
    throw preconditionError(
      'Native vision policy is unreadable; automatic selection was not assumed.',
    );
  if (
    previous?.phase === 'ready' &&
    desiredVision &&
    (!priorVision.ok || !same(priorVision.data, desiredVision))
  )
    throw preconditionError(
      'The previously configured native vision policy is missing or changed.',
    );
  if (
    desiredVision &&
    priorVision.ok &&
    priorVision.data.providerSlug &&
    !same(priorVision.data, desiredVision)
  )
    throw preconditionError(
      'Existing native vision model differs; its policy was preserved.',
    );
  const visionApi = z
    .object({
      policy: z
        .object({
          key: z.literal('vision_model'),
          config: visionModelConfigSchema,
        })
        .nullable(),
    })
    .parse(await request('/api/app/governance/policies/vision_model'));
  if (
    !same(
      visionApi.policy?.config ?? null,
      priorVision.ok ? priorVision.data : null,
    )
  )
    throw preconditionError(
      'Native vision policy disk and API readback disagree.',
    );
  const embeddingFile = join(
    knowledgeDirectory,
    `${KNOWLEDGE_EMBEDDING_KEY}.json`,
  );
  const priorEmbeddingRaw = await readOptionalJson(embeddingFile);
  const priorEmbedding =
    priorEmbeddingRaw === undefined
      ? undefined
      : knowledgeEmbeddingSchema.parse(priorEmbeddingRaw);
  if (previous?.phase === 'ready' && desiredEmbedding && !priorEmbedding)
    throw preconditionError(
      'The previously configured native embedding model is missing.',
    );
  if (
    desiredEmbedding &&
    priorEmbedding &&
    !same(priorEmbedding, desiredEmbedding)
  )
    throw preconditionError(
      'Existing embedding model or dimensions differ; migration and corpus review are required.',
    );
  const embeddingApi = z
    .object({ configured: z.boolean() })
    .passthrough()
    .parse(await request('/api/app/knowledge/embedding'));
  const { configured, ...embeddingFields } = embeddingApi;
  if (
    configured !== Boolean(priorEmbedding) ||
    (configured &&
      !same(knowledgeEmbeddingSchema.parse(embeddingFields), priorEmbedding))
  )
    throw preconditionError('Native embedding disk and API readback disagree.');
  if (desiredEmbedding && !priorEmbedding) {
    const documents = z
      .object({ page: z.array(z.unknown()).max(1), isDone: z.boolean() })
      .parse(await request('/api/app/documents/paginated?numItems=1'));
    if (documents.page.length || !documents.isDone)
      throw preconditionError(
        'Initial embedding setup requires an empty native document corpus; existing documents need a reviewed indexing migration.',
      );
  }
  for (const entry of providerFiles) {
    const url = `${entry.definition.baseUrl}/models`;
    let response: Response;
    try {
      response = await (options.catalogFetch ?? fetch)(url, {
        redirect: 'error',
        signal: AbortSignal.timeout(10000),
        headers: { accept: 'application/json' },
      });
    } catch {
      throw externalDepError(
        'Declared provider catalog is unavailable. No catalog fallback was attempted.',
      );
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw externalDepError('Declared provider catalog refused its readback.');
    }
    const actualCatalog = normalizeCatalogPayload(
      await boundedResponse(response, 65536),
      entry.definition.name,
    );
    const expectedCatalog = { entries: entry.models, droppedCount: 0 };
    if (!same(actualCatalog, expectedCatalog))
      throw preconditionError(
        'Declared provider catalog differs from the exact declared model capabilities.',
      );
  }
  // All known conflicts are checked before the first write. A lost response
  // retains pending state; the next invocation re-reads exact unique names.
  if (previous?.phase === 'ready' && !unchanged) {
    const history = join(options.stateDirectory, 'model-settings-history');
    await privateDirectory(history, options.stateDirectory, owner);
    const retained = await readFile(receiptPath);
    createImmutable(join(history, `${sha256(retained)}.json`), retained);
  }
  if (!previous || !unchanged) await writePrivateJson(receiptPath, planned);
  await privateDirectory(providersDirectory, orgDirectory, owner);
  for (const entry of providerFiles)
    if (!entry.present) createImmutable(entry.file, entry.content);
  for (const entry of providerFiles) {
    const actual = await readDomainConfigFile(
      providersDirectory,
      entry.definition.name,
      65536,
      (data) => providerDefinitionSchema.parse(data),
    );
    if (
      !actual.ok ||
      actual.format !== 'yaml' ||
      !same(actual.data, entry.definition)
    )
      throw preconditionError('Native provider file did not converge.');
    if (
      !credentials.some((row) => row.providerSlug === entry.definition.name)
    ) {
      await request('/api/app/provider-credentials/', 'POST', {
        providerSlug: entry.definition.name,
        authMethod: 'env',
        name: entry.credential.name,
        envName: entry.credential.envName,
        modelAllowlist: entry.models.map((model) => model.id),
      });
      credentials = await listCredentials();
      assertCredentials(credentials);
      if (
        !credentials.some((row) => row.providerSlug === entry.definition.name)
      )
        throw preconditionError(
          'Native model-settings credential creation was not observed.',
        );
    }
  }
  if (
    desiredVision &&
    (!priorVision.ok || !same(priorVision.data, desiredVision))
  )
    await request('/api/app/governance/policies/vision_model', 'POST', {
      config: desiredVision,
    });
  if (desiredEmbedding && !priorEmbedding) {
    const result = z
      .object({ ok: z.literal(true), requeued: z.literal(0) })
      .safeParse(
        await request('/api/app/knowledge/embedding', 'POST', desiredEmbedding),
      );
    if (!result.success)
      throw preconditionError(
        'Embedding setup observed unexpected indexing work; review the retained pending state.',
      );
  }
  const finalVision = await readDomainConfigFile(
    governanceDirectory,
    policyTypeToFileBase('vision_model'),
    65536,
    (data) => visionModelConfigSchema.parse(data),
  );
  if (
    desiredVision &&
    (!finalVision.ok || !same(finalVision.data, desiredVision))
  )
    throw preconditionError('Native vision policy did not converge.');
  if (
    desiredEmbedding &&
    !same(
      knowledgeEmbeddingSchema.parse(await boundedJson(embeddingFile)),
      desiredEmbedding,
    )
  )
    throw preconditionError('Native embedding configuration did not converge.');
  credentials = await listCredentials();
  assertCredentials(credentials, true);
  for (const entry of providerFiles) {
    const actual = await readDomainConfigFile(
      providersDirectory,
      entry.definition.name,
      65536,
      (data) => providerDefinitionSchema.parse(data),
    );
    if (
      !actual.ok ||
      actual.format !== 'yaml' ||
      !same(actual.data, entry.definition)
    )
      throw preconditionError(
        'Native provider file changed during provisioning.',
      );
  }
  if (desiredVision) {
    const finalApi = z
      .object({
        policy: z
          .object({
            key: z.literal('vision_model'),
            config: visionModelConfigSchema,
          })
          .nullable(),
      })
      .parse(await request('/api/app/governance/policies/vision_model'));
    if (!same(finalApi.policy?.config ?? null, desiredVision))
      throw preconditionError(
        'Native vision policy API readback did not converge.',
      );
  }
  if (desiredEmbedding) {
    const finalApi = z
      .object({ configured: z.boolean() })
      .passthrough()
      .parse(await request('/api/app/knowledge/embedding'));
    if (
      !finalApi.configured ||
      !same(knowledgeEmbeddingSchema.parse(finalApi), desiredEmbedding)
    )
      throw preconditionError(
        'Native embedding API readback did not converge.',
      );
  }
  await writePrivateJson(receiptPath, { ...planned, phase: 'ready' });
  return {
    configured: true as const,
    organizationId: context.organization.id,
    organizationSlug: options.organizationSlug,
    deploymentBundleSha256: options.deploymentBundleSha256,
    providers: await Promise.all(
      providerFiles.map(async (entry) => ({
        name: entry.definition.name,
        models: entry.models.map((model) => model.id),
        providerFileSha256: sha256(await readFile(entry.file)),
      })),
    ),
    vision: desiredVision ?? null,
    embedding: desiredEmbedding ?? null,
    unchanged,
    settingsSha256,
  };
}

export async function provisionDeploymentModelSettings(
  directory: string,
  context: ProvisionContext,
) {
  const deployment = await verifyDeploymentBundle(directory);
  if (!deployment.spec.modelSettings) return undefined;
  const identity = deployment.spec.identity;
  if (!identity)
    throw preconditionError(
      'Native model settings require a declared organization identity.',
    );
  return configureNativeModelSettings(deployment.spec.modelSettings, context, {
    organizationSlug: identity.slug,
    deploymentBundleSha256: sha256(
      await readFile(join(directory, 'deployment.json')),
    ),
    stateDirectory: join(
      '/app/data/ops/tale-deployments',
      deployment.spec.name,
    ),
  });
}
