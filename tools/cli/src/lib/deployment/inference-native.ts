import { lstat, readFile, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';

import { stringify } from 'yaml';
import { z } from 'zod';

import { readDomainConfigFile } from '../../../../../services/platform/backend/core/lib/config_store/read_domain_file';
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
} from '../inference/files';
import { boundedResponse } from '../inference/http';
import { type InferenceFetch, type InferenceSpec } from '../inference/model';
import { inferenceModelCatalog } from '../inference/router';
import { inferenceApiKey } from '../inference/settings';
import { verifyDeploymentBundle } from './bundle';
import { type ProvisionContext } from './identity';
import { verifyManagedInference } from './inference';
import { INFERENCE_NATIVE_KEY_ENV } from './inference-apply';
import { desiredNativeInference } from './inference-native-proof';

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
  kind: z.literal('tale-native-inference'),
  phase: z.enum(['pending', 'ready']),
  organizationId: z.string(),
  organizationSlug: slug,
  userId: z.string(),
  companionSha256: sha,
  desiredSha256: sha,
});
type Options = {
  companionSha256: string;
  stateDirectory: string;
  configRoot?: string;
  environment?: NodeJS.ProcessEnv;
  catalogFetch?: InferenceFetch;
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
      'Native inference requires the backend TALE_CONFIG_DIR.',
    );
  const root = await lstat(rootInput);
  if (
    !root.isDirectory() ||
    root.isSymbolicLink() ||
    (root.mode & 0o022) !== 0 ||
    (await realpath(rootInput)) !== rootInput
  )
    throw preconditionError(
      'Native inference configuration root is not a safe owned directory.',
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
      'Native inference organization config directory differs.',
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
        'Native inference config has a foreign or writable directory.',
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
      'Native inference recovery state is not a canonical owned directory.',
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
        'Native inference recovery state has an unsafe owner, mode or ancestor.',
      );
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

/** Caller holds the native deployment lock and has proved this session's exact
 * organization/user. No existing provider/policy is overwritten to force a fit. */
export async function configureNativeInference(
  spec: InferenceSpec,
  context: ProvisionContext,
  options: Options,
) {
  try {
    return await configureNativeInferenceInternal(spec, context, options);
  } catch (error) {
    if (error instanceof CliError) throw error;
    // Files and external JSON may contain private/untrusted text. Their parser
    // diagnostics never become CLI output, including verbose error rendering.
    throw preconditionError(
      'Native inference metadata is invalid or unreadable. Review the retained state.',
    );
  }
}

async function configureNativeInferenceInternal(
  spec: InferenceSpec,
  context: ProvisionContext,
  options: Options,
) {
  if (
    context.organization.slug !== spec.organization ||
    !context.organization.id ||
    !context.user.id
  )
    throw preconditionError(
      'Native inference context belongs to another organization.',
    );
  const environment = options.environment ?? process.env;
  inferenceApiKey(environment[INFERENCE_NATIVE_KEY_ENV]);
  if (environment.TALE_ALLOW_PRIVATE_PROVIDER_HOSTS !== '1')
    throw preconditionError(
      'Native inference requires the explicit private provider-host policy.',
    );
  const orgDirectory = await configDirectory(
    options.configRoot ?? environment.TALE_CONFIG_DIR,
    spec.organization,
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
  if (
    new Set(spec.models.map((model) => model.capability)).size !==
    spec.models.length
  )
    throw preconditionError(
      'Native inference requires one declared model per capability; use replicas for multiple nodes.',
    );
  const {
    providers,
    vision: desiredVision,
    embedding: desiredEmbedding,
  } = desiredNativeInference(spec);
  const desiredSha256 = valueHash({
    providers: providers.map((entry) => entry.definition),
    models: spec.models,
    vision: desiredVision ?? null,
    embedding: desiredEmbedding ?? null,
    envName: INFERENCE_NATIVE_KEY_ENV,
  });
  const planned = receiptSchema.parse({
    schemaVersion: 1,
    kind: 'tale-native-inference',
    phase: 'pending',
    organizationId: context.organization.id,
    organizationSlug: spec.organization,
    userId: context.user.id,
    companionSha256: options.companionSha256,
    desiredSha256,
  });
  const receiptPath = join(options.stateDirectory, 'inference.json');
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
      'Native inference receipt differs from this bundle, organization or operator. Review the retained state.',
    );
  const request = async (path: string, method = 'GET', body?: unknown) =>
    context.requireJson(
      await context.request(
        `${path}${path.includes('?') ? '&' : '?'}orgId=${encodeURIComponent(context.organization.id)}`,
        method,
        body,
      ),
      'Native inference configuration',
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
        'An active unmanaged provider credential prevents exclusive local inference provisioning.',
      );
    for (const { definition, model } of providers) {
      const matches = rows.filter(
        (row) => row.providerSlug === definition.name,
      );
      if (
        matches.length > 1 ||
        (complete && matches.length !== 1) ||
        matches.some(
          (row) =>
            row.name !== 'Tale local inference' ||
            row.authMethod !== 'env' ||
            row.envName !== INFERENCE_NATIVE_KEY_ENV ||
            row.endpointUrl !== null ||
            !same(row.modelAllowlist, [model.apiModel]) ||
            row.status !== 'active' ||
            !row.isDefault,
        )
      )
        throw preconditionError(
          'An existing native inference credential differs; no key or default was changed.',
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
  // All known conflicts are checked before the first write. A lost response
  // retains pending state; the next invocation re-reads exact unique names.
  if (previous?.phase === 'ready' && !unchanged) {
    const history = join(options.stateDirectory, 'inference-history');
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
        'Internal inference catalog is unavailable. No public catalog fallback was attempted.',
      );
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw externalDepError(
        'Internal inference catalog refused its readback.',
      );
    }
    const actualCatalog = normalizeCatalogPayload(
      await boundedResponse(response, 65536),
      entry.definition.name,
    );
    const expectedCatalog = normalizeCatalogPayload(
      inferenceModelCatalog(entry.model),
      entry.definition.name,
    );
    if (!same(actualCatalog, expectedCatalog))
      throw preconditionError(
        'Internal inference catalog differs from the exact declared model capabilities.',
      );
    if (
      !credentials.some((row) => row.providerSlug === entry.definition.name)
    ) {
      await request('/api/app/provider-credentials/', 'POST', {
        providerSlug: entry.definition.name,
        authMethod: 'env',
        name: 'Tale local inference',
        envName: INFERENCE_NATIVE_KEY_ENV,
        modelAllowlist: [entry.model.apiModel],
      });
      credentials = await listCredentials();
      assertCredentials(credentials);
      if (
        !credentials.some((row) => row.providerSlug === entry.definition.name)
      )
        throw preconditionError(
          'Native inference credential creation was not observed.',
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
    organizationSlug: spec.organization,
    companionSha256: options.companionSha256,
    providers: await Promise.all(
      providerFiles.map(async (entry) => ({
        name: entry.definition.name,
        model: entry.model.apiModel,
        capability: entry.model.capability,
        providerFileSha256: sha256(await readFile(entry.file)),
      })),
    ),
    vision: desiredVision ?? null,
    embedding: desiredEmbedding ?? null,
    unchanged,
    runtimeReadiness: 'reported-separately-by-the-inference-node',
  };
}

export async function provisionDeploymentInference(
  directory: string,
  context: ProvisionContext,
) {
  const deployment = await verifyDeploymentBundle(directory);
  if (!deployment.spec.inference) return undefined;
  const companion = await verifyManagedInference(
    join(directory, 'inference'),
    deployment.spec,
  );
  return configureNativeInference(companion.bundle.spec, context, {
    companionSha256: companion.identity,
    stateDirectory: join(
      '/app/data/ops/tale-deployments',
      deployment.spec.name,
    ),
  });
}
