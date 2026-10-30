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
    case 'project-dispatch':
      return `project-dispatch/${resource.config.projectId}`;
    case 'project':
      return `project/${resource.config.projectId}`;
    case 'project-label':
      return `project-label/${resource.config.projectId}/${encodeURIComponent(resource.config.name)}`;
    case 'project-agent':
      return `project-agent/${resource.config.projectId}/${resource.config.agentId}`;
    case 'task':
      return `task/${resource.config.projectId}/${resource.config.taskId}`;
    case 'agent-secret':
      return `agent-secret/${resource.config.name}`;
    case 'connector-credential':
      return `connector-credential/${resource.config.connector}/${encodeURIComponent(resource.config.name)}`;
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

/** The most resources one declaration holds, its included files' among
 * them. A plan, its journal and a deployment's receipt hold as many. */
export const PLATFORM_RESOURCES_MAX = 512;

/** The path of every key of `input` that parsing left out of `parsed`, and
 * of each key under one, which went with it. */
function discardedKeys(
  input: unknown,
  parsed: unknown,
  path: readonly PropertyKey[] = [],
): PropertyKey[][] {
  if (Array.isArray(input))
    return input.flatMap((entry, index) =>
      discardedKeys(entry, Array.isArray(parsed) ? parsed[index] : undefined, [
        ...path,
        index,
      ]),
    );
  if (!isObject(input)) return [];
  return Object.entries(input).flatMap(([key, value]) => {
    const at = [...path, key];
    return isObject(parsed) && Object.hasOwn(parsed, key)
      ? discardedKeys(value, Reflect.get(parsed, key), at)
      : [at].concat(discardedKeys(value, undefined, at));
  });
}

/** `input` with `value` in place of what sits at `path`. */
function replacedAt(
  input: unknown,
  path: readonly PropertyKey[],
  value: unknown,
): unknown {
  if (path.length === 0) return value;
  const [key, ...rest] = path;
  if (Array.isArray(input))
    return input.map((entry, index) =>
      index === key ? replacedAt(entry, rest, value) : entry,
    );
  return isObject(input)
    ? { ...input, [key]: replacedAt(Reflect.get(input, key), rest, value) }
    : input;
}

/** A declaration is JSON, which holds no symbol: no field that checks its
 * value takes this one. */
const UNREADABLE = Symbol('unreadable');

/**
 * Normalization may add native defaults and leave out a field it read that
 * says nothing (a repeat window that spans the whole week), but must not
 * hide misspelled fields. A schema strips a key it does not know whatever
 * its value, so a left-out key the resource still parses with
 * {@link UNREADABLE} in its place was never read.
 */
function hidesMisspelledField(input: unknown, parsed: unknown): boolean {
  return discardedKeys(input, parsed).some(
    (path) =>
      platformResourceSchema.safeParse(replacedAt(input, path, UNREADABLE))
        .success,
  );
}

/** A resource as a declaration names it, read through its native schema.
 * The declaration around it is strict, so whatever parsing leaves out sits
 * in a resource and is weighed against that resource alone. */
const declaredResourceSchema = z.unknown().transform((input, context) => {
  const parsed = platformResourceSchema.safeParse(input);
  if (!parsed.success || hidesMisspelledField(input, parsed.data)) {
    context.addIssue({
      code: 'custom',
      message: 'Unsupported resource or invalid native configuration fields',
    });
    return z.NEVER;
  }
  return parsed.data;
});

const declarationSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    resources: z
      .array(declaredResourceSchema)
      .min(1)
      .max(PLATFORM_RESOURCES_MAX),
  })
  .superRefine((configuration, context) => {
    const ids = configuration.resources.map(resourceId);
    const fail = (message: string) =>
      context.addIssue({ code: 'custom', message });
    if (new Set(ids).size !== ids.length)
      fail('Duplicate native configuration resource');
    // A label and a connector credential are one whatever their name's case.
    const folded = configuration.resources.flatMap((resource) =>
      resource.kind === 'project-label'
        ? [
            `label/${resource.config.projectId}/${resource.config.name.toLowerCase()}`,
          ]
        : resource.kind === 'connector-credential'
          ? [
              `credential/${resource.config.connector}/${resource.config.name.toLowerCase()}`,
            ]
          : [],
    );
    if (new Set(folded).size !== folded.length)
      fail('Duplicate native configuration resource');
    for (const resource of configuration.resources) {
      // An agent is created with its runtime and model, which `agent-model`
      // owns: creating one takes its declared serving.
      if (
        resource.kind === 'project-agent' &&
        resource.createIfMissing === true &&
        !configuration.resources.some(
          (candidate) =>
            candidate.kind === 'agent-model' &&
            candidate.config.projectId === resource.config.projectId &&
            candidate.config.agentId === resource.config.agentId,
        )
      )
        fail('A created project agent requires its declared agent-model');
    }
    const connectorDefaults = configuration.resources
      .filter((resource) => resource.kind === 'connector-credential')
      .filter((resource) => resource.config.isDefault === true)
      .map((resource) => resource.config.connector);
    if (new Set(connectorDefaults).size !== connectorDefaults.length)
      fail('A connector cannot have two declared default credentials');
    // A pin names the credential exactly as Tale stores its name, which is
    // how a declared credential spells it: one spelled otherwise is refused
    // by the platform, and would never read back as declared.
    for (const resource of configuration.resources) {
      if (resource.kind !== 'project-agent') continue;
      for (const [connector, pin] of Object.entries(
        resource.config.connectorCredentials ?? {},
      )) {
        const respelled = configuration.resources.find(
          (candidate) =>
            candidate.kind === 'connector-credential' &&
            candidate.config.connector === connector &&
            candidate.config.name !== pin &&
            candidate.config.name.toLowerCase() === pin.toLowerCase(),
        );
        if (respelled?.kind === 'connector-credential')
          fail(
            `A project agent pins "${pin}" for ${connector}, which this declaration names "${respelled.config.name}": spell the pin as the credential`,
          );
      }
    }
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

export const platformConfigurationSchema = z
  .unknown()
  .transform((input, context) => {
    const parsed = declarationSchema.safeParse(input);
    if (!parsed.success) {
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

/**
 * The fields a declaration of each kind may leave out to keep what is
 * stored. The platform keeps such a field when a write omits it and clears
 * it on an explicit `null` where the field takes one, so a declaration that
 * omits one converges with ANY stored value, one that declares `null`
 * converges only once none is stored, and a declared value must match
 * exactly — each field on its own. Every other field compares whole.
 */
const KEPT_WHEN_OMITTED: Readonly<
  Partial<Record<PlatformResource['kind'], readonly string[]>>
> = {
  'knowledge-embedding': keptSettings,
  project: ['description', 'teamIds'],
  'project-agent': [
    'connectors',
    'secrets',
    'skills',
    'connectorCredentials',
    'gitIdentity',
  ],
  task: ['labels', 'assigneeAgentId', 'priority'],
  'connector-credential': ['endpoint', 'isDefault'],
};

/** The fields a declaration of `kind` may leave out to keep what is
 * stored; empty for a kind that compares whole. */
export function keptWhenOmitted(
  kind: PlatformResource['kind'],
): readonly string[] {
  return KEPT_WHEN_OMITTED[kind] ?? [];
}

/** A config without the given fields. */
function without(
  value: object,
  keys: readonly string[],
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => !keys.includes(key)),
  );
}

/** An embedding config without the settings a write keeps when it omits
 * them: what remains names the model — provider, credential, tag, width and
 * endpoint. */
function embeddingModelOf(value: object): Record<string, unknown> {
  return without(value, keptSettings);
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
 * Every resource compares whole, except the fields its kind keeps when a
 * declaration omits them ({@link keptWhenOmitted}): the embedding's
 * similarity floor and serving limits, a project's description and teams,
 * a project agent's equipment, a task's labels, assignee and priority, a
 * connector credential's endpoint and default.
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
 * satisfies, including the kept fields' preserve/clear semantics. */
export function resourceConvergedWithHash(
  resource: PlatformResource,
  current: unknown,
  desiredSha256: string,
): boolean {
  return convergedWithHash(resource.kind, current, desiredSha256);
}

/** Whether `current` satisfies the declaration of `kind` whose hash is
 * `desiredSha256`: every declaration this state satisfies, each kept field
 * either omitted (whatever is stored stays) or stated as what is stored —
 * `null` when nothing is. */
export function convergedWithHash(
  kind: PlatformResource['kind'],
  current: unknown,
  desiredSha256: string,
): boolean {
  const kept = keptWhenOmitted(kind);
  if (kept.length === 0 || !isObject(current))
    return configurationHash(current) === desiredSha256;
  let readings = [without(current, kept)];
  for (const key of kept) {
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
