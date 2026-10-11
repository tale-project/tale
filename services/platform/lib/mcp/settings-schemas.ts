import { brandingFormSchema } from '@tale/shared/schemas/branding';
import { deploymentConfigSchema } from '@tale/shared/schemas/deployment';
import {
  isFilePolicyType,
  POLICY_SCHEMAS,
} from '@tale/shared/schemas/governance';
import { knowledgeEmbeddingWriteSchema } from '@tale/shared/schemas/knowledge';
import {
  managedAgentInstructionsSchema,
  managedAgentModelSchema,
  managedAgentToolsSchema,
  managedProjectInstructionsSchema,
  managedTaskInstructionsSchema,
  managedTaskReviewContextSchema,
} from '@tale/shared/schemas/managed-configuration';
import {
  providerDefinitionSchema,
  providerEnvironmentCredentialSchema,
} from '@tale/shared/schemas/providers';
import type { SettingsKind } from '@tale/shared/schemas/settings-kinds';
import { z } from 'zod';

/**
 * The schema each settings kind's config is read through — the one its
 * writer checks a change against — for every reader that needs a kind's
 * shape: the settings reference lists each kind's fields from it, and the
 * settings tools read from it which member names a config declares, so a
 * declared field is never taken for a secret by its name alone.
 */

/** Each kind's schema; `governance` reads each policy through its own. */
export const SETTINGS_CONFIG_SCHEMAS: Readonly<
  Record<Exclude<SettingsKind, 'governance'>, z.ZodType>
> = {
  provider: providerDefinitionSchema,
  'provider-credential': providerEnvironmentCredentialSchema,
  'knowledge-embedding': knowledgeEmbeddingWriteSchema,
  branding: brandingFormSchema,
  'project-instructions': managedProjectInstructionsSchema,
  'agent-instructions': managedAgentInstructionsSchema,
  'agent-tools': managedAgentToolsSchema,
  'agent-model': managedAgentModelSchema,
  'task-instructions': managedTaskInstructionsSchema,
  'task-review-context': managedTaskReviewContextSchema,
  deployment: deploymentConfigSchema,
};

/** The schema a resource's config is read through: its kind's, or for a
 * policy its own; null for an id that names no policy. */
export function settingsConfigSchema(
  kind: SettingsKind,
  id: string | null,
): z.ZodType | null {
  if (kind !== 'governance') return SETTINGS_CONFIG_SCHEMAS[kind];
  return id !== null && isFilePolicyType(id) ? POLICY_SCHEMAS[id] : null;
}

/** Every member name a JSON Schema declares as a property, at any depth.
 * A map's keys (`additionalProperties`, `propertyNames`) are no
 * declaration. */
function propertyNames(node: unknown, into: Set<string>): void {
  if (Array.isArray(node)) {
    for (const item of node) propertyNames(item, into);
    return;
  }
  if (node === null || typeof node !== 'object') return;
  for (const [key, value] of Object.entries(node)) {
    if (key === 'properties' && value !== null && typeof value === 'object') {
      for (const [name, property] of Object.entries(value)) {
        into.add(name);
        propertyNames(property, into);
      }
    } else {
      propertyNames(value, into);
    }
  }
}

const DECLARED = new Map<string, ReadonlySet<string>>();

const NONE: ReadonlySet<string> = new Set();

/**
 * Every member name a resource's schema declares, at any depth — the
 * names whose meaning the kind defines. The keys of a map the schema
 * leaves open, such as a header's name, are not among them. Read once per
 * kind and policy.
 */
export function declaredSettingsNames(
  kind: SettingsKind,
  id: string | null,
): ReadonlySet<string> {
  const schema = settingsConfigSchema(kind, id);
  if (schema === null) return NONE;
  const key = kind === 'governance' ? `${kind}/${id ?? ''}` : kind;
  const known = DECLARED.get(key);
  if (known !== undefined) return known;
  const names = new Set<string>();
  propertyNames(
    z.toJSONSchema(schema, {
      target: 'draft-2020-12',
      io: 'input',
      unrepresentable: 'any',
    }),
    names,
  );
  DECLARED.set(key, names);
  return names;
}
