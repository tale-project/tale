import { z } from 'zod';

import { brandingFormSchema } from '../schemas/branding';
import { deploymentConfigSchema } from '../schemas/deployment';
import { FILE_POLICY_TYPES, POLICY_SCHEMAS } from '../schemas/governance';
import {
  KNOWLEDGE_EMBEDDING_KEPT_KEYS,
  knowledgeEmbeddingWriteSchema,
} from '../schemas/knowledge';
import { managedPlatformResourceSchema } from '../schemas/managed-configuration';
import {
  modelCatalogFileSchema,
  providerDefinitionSchema,
  providerEnvironmentCredentialSchema,
} from '../schemas/providers';
import { configurationHash } from '../utils/configuration-hash';

/**
 * The native platform resource model: the configuration resources one
 * declaration (`tale config platform`, a managed deployment) or one MCP
 * settings change names, how each is identified, which cross-resource rules a
 * declaration obeys, and when the stored state already IS what was asked for.
 * The platform owns every field, default, permission, lock and side effect;
 * this envelope only selects a native resource.
 *
 * Server-only: identity and convergence compare `configurationHash` digests
 * (Node's crypto), which is why it lives outside the browser-safe `schemas/`.
 */

// Adding a policy to the platform does not require a copy here: the key
// selects the platform's own schema.
const governance = z
  .strictObject({
    kind: z.literal('governance'),
    key: z
      .enum(FILE_POLICY_TYPES)
      .refine(
        (key) => !['retention_policy', 'dsar_governance'].includes(key),
        'This policy requires its dedicated native workflow',
      ),
    config: z.unknown(),
  })
  .transform((resource, context) => {
    const parsed = POLICY_SCHEMAS[resource.key].safeParse(resource.config);
    if (!parsed.success) {
      context.addIssue({
        code: 'custom',
        message: 'Invalid native policy configuration',
      });
      return z.NEVER;
    }
    return { ...resource, config: parsed.data };
  });

export const platformResourceSchema = z.union([
  managedPlatformResourceSchema,
  governance,
  z.strictObject({
    kind: z.literal('branding'),
    config: brandingFormSchema.strict(),
  }),
  z.strictObject({
    kind: z.literal('deployment'),
    config: deploymentConfigSchema,
  }),
  z.strictObject({
    kind: z.literal('knowledge-embedding'),
    // The platform keeps a stored similarity floor or serving limit
    // (`minSimilarity`, `maxConcurrentRequests`, `minTokensPerSecond`,
    // `maxTokensPerMinute`, `maxRequestsPerMinute`) when
    // a save omits it and clears it only on an explicit null (the Settings
    // form never carries them) — so the declaration speaks the same three
    // ways: a value sets it, `null` clears it, omitted leaves what is stored.
    config: knowledgeEmbeddingWriteSchema.strict(),
  }),
  z.strictObject({
    kind: z.literal('provider'),
    config: providerDefinitionSchema,
    expectedModels: modelCatalogFileSchema
      .refine((models) => models.length <= 200)
      .optional(),
  }),
  z.strictObject({
    kind: z.literal('provider-credential'),
    config: providerEnvironmentCredentialSchema,
  }),
]);
export type PlatformResource = z.infer<typeof platformResourceSchema>;

export function resourceId(resource: PlatformResource): string {
  switch (resource.kind) {
    case 'project-instructions':
      return `project-instructions/${resource.config.projectId}`;
    case 'agent-instructions':
    case 'agent-tools':
    case 'agent-model':
      return `${resource.kind}/${resource.config.projectId}/${resource.config.agentId}`;
    case 'task-instructions':
      return `task-instructions/${resource.config.projectId}/${resource.config.taskId}`;
    case 'task-review-context':
      return `task-review-context/${resource.config.projectId}/${resource.config.taskId}`;
    case 'automation-definition':
    case 'automation-deployment':
    case 'automation-schedule':
      return `${resource.kind}/${resource.config.projectId}/${resource.config.name}`;
    case 'governance':
      return `governance/${resource.key}`;
    case 'provider':
      return `provider/${resource.config.name}`;
    case 'provider-credential':
      return `provider-credential/${resource.config.providerSlug}/${encodeURIComponent(resource.config.name)}`;
    default:
      return resource.kind;
  }
}

const declarationSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    resources: z.array(platformResourceSchema).min(1).max(128),
  })
  .superRefine((configuration, context) => {
    const ids = configuration.resources.map(resourceId);
    const fail = (message: string) =>
      context.addIssue({ code: 'custom', message });
    if (new Set(ids).size !== ids.length)
      fail('Duplicate native configuration resource');
    for (const resource of configuration.resources) {
      if (
        resource.kind !== 'automation-deployment' &&
        resource.kind !== 'automation-schedule'
      )
        continue;
      const definition = configuration.resources.find(
        (candidate) =>
          candidate.kind === 'automation-definition' &&
          candidate.config.name === resource.config.name &&
          candidate.config.projectId === resource.config.projectId,
      );
      if (
        !definition ||
        (resource.kind === 'automation-deployment' &&
          configurationHash(definition.config) !==
            resource.config.definitionSha256)
      )
        fail(
          'Managed automation deployment requires its exact declared definition',
        );
      if (
        resource.kind === 'automation-schedule' &&
        !configuration.resources.some(
          (candidate) =>
            candidate.kind === 'automation-deployment' &&
            candidate.config.name === resource.config.name &&
            candidate.config.projectId === resource.config.projectId,
        )
      )
        fail('Managed schedule requires its declared automation deployment');
    }
    const managedNames = configuration.resources
      .filter((resource) => resource.kind === 'automation-definition')
      .map((resource) => resource.config.name);
    if (new Set(managedNames).size !== managedNames.length)
      fail(
        'An organization-wide automation cannot have two managed project owners',
      );
    const providers = configuration.resources.filter(
      (resource) => resource.kind === 'provider',
    );
    const defaults = configuration.resources
      .filter((resource) => resource.kind === 'provider-credential')
      .filter(
        (resource) =>
          resource.config.isDefault && resource.config.status === 'active',
      );
    if (
      configuration.resources.some(
        (resource) =>
          resource.kind === 'provider-credential' &&
          resource.config.isDefault &&
          resource.config.status !== 'active',
      )
    )
      fail('A default credential must be active');
    if (
      new Set(defaults.map((resource) => resource.config.providerSlug)).size !==
      defaults.length
    )
      fail('A provider cannot have two declared default credentials');
    for (const provider of providers)
      if (
        provider.expectedModels?.some(
          (model) => model.provider !== provider.config.name,
        )
      )
        fail('Expected catalog belongs to another provider');
    for (const resource of configuration.resources) {
      if (resource.kind === 'knowledge-embedding') {
        const provider = providers.find(
          (entry) => entry.config.name === resource.config.providerSlug,
        );
        if (
          provider &&
          (provider.config.embedding !== 'supported' ||
            (provider.config.baseUrl &&
              resource.config.baseUrl !== provider.config.baseUrl) ||
            (provider.expectedModels &&
              !provider.expectedModels.some(
                (model) =>
                  model.id === resource.config.model &&
                  model.tags.includes('embedding'),
              )))
        )
          fail(
            'Embedding selection differs from its declared provider and catalog',
          );
      }
      if (resource.kind === 'governance' && resource.key === 'vision_model') {
        const vision = POLICY_SCHEMAS.vision_model.parse(resource.config);
        const provider = providers.find(
          (entry) => entry.config.name === vision.providerSlug,
        );
        if (
          provider?.expectedModels &&
          !provider.expectedModels.some(
            (model) => model.id === vision.modelId && model.supportsVision,
          )
        )
          fail('Vision selection differs from its declared catalog');
      }
      if (
        resource.kind === 'governance' &&
        resource.key === 'transcription_model'
      ) {
        const transcription = POLICY_SCHEMAS.transcription_model.parse(
          resource.config,
        );
        const provider = providers.find(
          (entry) => entry.config.name === transcription.providerSlug,
        );
        if (
          provider &&
          (provider.config.apiFormat !== 'openai' ||
            (provider.expectedModels &&
              !provider.expectedModels.some(
                (model) =>
                  model.id === transcription.modelId &&
                  model.tags.includes('transcription'),
              )))
        )
          fail(
            'Transcription selection differs from its declared provider and catalog',
          );
      }
      if (
        resource.kind === 'governance' &&
        resource.key === 'image_generation'
      ) {
        const image = POLICY_SCHEMAS.image_generation.parse(resource.config);
        const provider = providers.find(
          (entry) => entry.config.name === image.providerSlug,
        );
        // The same admission a turn applies: an OpenAI-format provider, and
        // a pinned model its declared catalog lists as an image generator.
        if (
          provider &&
          (provider.config.apiFormat !== 'openai' ||
            (provider.expectedModels &&
              !provider.expectedModels.some(
                (model) =>
                  model.id === image.modelId &&
                  model.tags.includes('image-generation'),
              )))
        )
          fail(
            'Image generation selection differs from its declared provider and catalog',
          );
      }
    }
  });
export type PlatformConfiguration = z.infer<typeof platformConfigurationSchema>;

/** Normalization may add native defaults, but must not hide misspelled fields. */
function discardedKeys(input: unknown, parsed: unknown): boolean {
  if (Array.isArray(input))
    return (
      !Array.isArray(parsed) ||
      input.some((entry, i) => discardedKeys(entry, parsed[i]))
    );
  if (input && typeof input === 'object') {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      return true;
    return Object.entries(input).some(
      ([key, value]) =>
        !Object.hasOwn(parsed, key) ||
        discardedKeys(value, Reflect.get(parsed, key)),
    );
  }
  return false;
}

export const platformConfigurationSchema = z
  .unknown()
  .transform((input, context) => {
    const parsed = declarationSchema.safeParse(input);
    if (!parsed.success || discardedKeys(input, parsed.data)) {
      context.addIssue({
        code: 'custom',
        message: 'Unsupported resources or invalid native configuration fields',
      });
      return z.NEVER;
    }
    return parsed.data;
  });

export const sameConfiguration = (left: unknown, right: unknown) =>
  configurationHash(left) === configurationHash(right);

function isObject(value: unknown): value is object {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const keptSettings: readonly string[] = KNOWLEDGE_EMBEDDING_KEPT_KEYS;

/** An embedding config without the settings a write keeps when it omits
 * them: what remains names the model — provider, credential, tag, width and
 * endpoint. */
function embeddingModelOf(value: object): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => !keptSettings.includes(key)),
  );
}

/** Whether a declared embedding names the model already stored, so that it
 * changes at most the kept settings — the similarity floor and the serving
 * limits, none of which touches the vector space. */
export function sameEmbeddingModel(declared: object, current: unknown) {
  return (
    isObject(current) &&
    configurationHash(embeddingModelOf(declared)) ===
      configurationHash(embeddingModelOf(current))
  );
}

/**
 * Whether the native state already IS what the declaration asks for — the
 * one comparison plan, apply and readback all use, so a resource whose
 * write semantics are not "replace the whole object" converges on the
 * platform's own terms rather than never at all.
 *
 * Every resource compares whole, except the embedding's kept settings
 * (`minSimilarity`, `maxConcurrentRequests`, `minTokensPerSecond`,
 * `maxTokensPerMinute`, `maxRequestsPerMinute`): the
 * platform keeps a stored one when the write omits it and clears it on an
 * explicit null, so a declaration that omits one converges with ANY stored
 * value, one that declares `null` converges only once none is stored, and a
 * declared value must match exactly — each setting on its own.
 */
export function resourceConverged(
  resource: PlatformResource,
  current: unknown,
): boolean {
  return resourceConvergedWithHash(
    resource,
    current,
    configurationHash(resource.config),
  );
}

/** A retained plan holds the declaration hash, not its original secret-free
 * object. Compare that hash with precisely the declarations native readback
 * satisfies, including the kept settings' preserve/clear semantics. */
export function resourceConvergedWithHash(
  resource: PlatformResource,
  current: unknown,
  desiredSha256: string,
): boolean {
  if (resource.kind !== 'knowledge-embedding' || !isObject(current))
    return configurationHash(current) === desiredSha256;
  // Every declaration this state satisfies: each kept setting either
  // omitted (whatever is stored stays) or stated as what is stored — `null`
  // when nothing is.
  let readings = [embeddingModelOf(current)];
  for (const key of keptSettings) {
    const stored: unknown = Reflect.get(current, key);
    readings = readings.flatMap((reading) => [
      reading,
      { ...reading, [key]: stored ?? null },
    ]);
  }
  return readings.some(
    (reading) => configurationHash(reading) === desiredSha256,
  );
}
