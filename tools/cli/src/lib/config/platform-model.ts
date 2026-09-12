import { brandingFormSchema } from '@tale/shared/schemas/branding';
import { deploymentConfigSchema } from '@tale/shared/schemas/deployment';
import {
  FILE_POLICY_TYPES,
  POLICY_SCHEMAS,
} from '@tale/shared/schemas/governance';
import { knowledgeEmbeddingSchema } from '@tale/shared/schemas/knowledge';
import {
  modelCatalogFileSchema,
  providerDefinitionSchema,
  providerEnvironmentCredentialSchema,
} from '@tale/shared/schemas/providers';
import { z } from 'zod';

import { usageError } from '../../utils/fail';
import { valueHash } from './releases/identity';
import { sha } from './releases/model';

// The platform owns the fields and defaults. This envelope only selects a
// native resource; adding a policy to the platform does not require a CLI copy.
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
    // The platform keeps a stored `minSimilarity` when a save omits it and
    // clears it only on an explicit null (the Settings form never carries
    // the knob) — so the declaration speaks the same three ways: a number
    // sets the floor, `null` clears it, omitted leaves whatever is stored.
    config: knowledgeEmbeddingSchema.strict().extend({
      minSimilarity: z.number().min(0).max(1).nullable().optional(),
    }),
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

export function parsePlatformConfiguration(
  input: unknown,
): PlatformConfiguration {
  const parsed = platformConfigurationSchema.safeParse(input);
  if (!parsed.success || discardedKeys(input, parsed.data))
    throw usageError(
      'Platform configuration contains unsupported resources or invalid native fields.',
    );
  return parsed.data;
}

// Hashes and opaque native revisions make a plan safe to save and review: it
// carries neither a session cookie nor arbitrary configuration/secret values.
export const configurationTargetSchema = z.strictObject({
  origin: z.string().url(),
  organizationId: z.string().min(1).max(128),
  organizationSlug: z.string().min(1).max(64),
});
export const configurationPlanSchema = z.strictObject({
  schemaVersion: z.literal(1),
  configurationSha256: sha,
  target: configurationTargetSchema,
  resources: z
    .array(
      z.strictObject({
        id: z.string().min(1).max(1024),
        scope: z.enum(['organization', 'instance']),
        currentSha256: sha,
        desiredSha256: sha,
        revision: z.string().max(200).nullable(),
        action: z.enum(['create', 'update', 'unchanged']),
        effects: z.array(
          z.enum(['restart-required', 'embedding-configuration']),
        ),
      }),
    )
    .min(1)
    .max(128),
});
export type ConfigurationPlan = z.infer<typeof configurationPlanSchema>;
export const sameConfiguration = (left: unknown, right: unknown) =>
  valueHash(left) === valueHash(right);

function withoutKey(value: unknown, key: string): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  return Object.fromEntries(
    Object.entries(value).filter(([entry]) => entry !== key),
  );
}

/**
 * Whether the native state already IS what the declaration asks for — the
 * one comparison plan, apply and readback all use, so a resource whose
 * write semantics are not "replace the whole object" converges on the
 * platform's own terms rather than never at all.
 *
 * Every resource compares whole, except the embedding floor: the platform
 * keeps a stored `minSimilarity` when the write omits it and clears it on
 * an explicit null, so a declaration that omits the floor converges with
 * ANY stored floor, one that declares `null` converges only once none is
 * stored, and a declared number must match exactly.
 */
export function resourceConverged(
  resource: PlatformResource,
  current: unknown,
): boolean {
  if (resource.kind !== 'knowledge-embedding') {
    return sameConfiguration(current, resource.config);
  }
  const declared = resource.config.minSimilarity;
  const stored =
    current && typeof current === 'object' && !Array.isArray(current)
      ? Reflect.get(current, 'minSimilarity')
      : undefined;
  if (declared === undefined) {
    return sameConfiguration(
      withoutKey(current, 'minSimilarity'),
      resource.config,
    );
  }
  if (declared === null) {
    return (
      stored === undefined &&
      sameConfiguration(current, withoutKey(resource.config, 'minSimilarity'))
    );
  }
  return sameConfiguration(current, resource.config);
}
