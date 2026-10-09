import { brandingFormSchema } from '@tale/shared/schemas/branding';
import { deploymentConfigSchema } from '@tale/shared/schemas/deployment';
import {
  FILE_POLICY_TYPES,
  POLICY_SCHEMAS,
} from '@tale/shared/schemas/governance';
import { knowledgeEmbeddingWriteSchema } from '@tale/shared/schemas/knowledge';
import {
  managedAgentInstructionsSchema,
  managedAgentToolsSchema,
  managedProjectInstructionsSchema,
  managedTaskInstructionsSchema,
} from '@tale/shared/schemas/managed-configuration';
import {
  providerDefinitionSchema,
  providerEnvironmentCredentialSchema,
} from '@tale/shared/schemas/providers';
import {
  GOVERNANCE_KEYS_NOT_OVER_MCP,
  SETTINGS_EFFECTS,
  SETTINGS_KINDS,
  SETTINGS_KINDS_NOT_OVER_MCP,
  type SettingsEffect,
  type SettingsKind,
} from '@tale/shared/schemas/settings-kinds';
import { z } from 'zod';

/**
 * The settings reference (`get_docs {topic: "settings"}`,
 * `tale://docs/settings`): how an agent reads, plans and changes the
 * organization's settings, every kind with its config's fields, what each
 * effect of a plan means, and every refusal the settings tools answer.
 * Built from the descriptors the registry routes by and the schemas each
 * kind's writer checks a config against, so a new kind, policy or field is
 * listed the day it can be changed.
 */

/** What each effect a plan names does, in the words an agent repeats to
 * the person. */
const EFFECT_MEANINGS: Readonly<Record<SettingsEffect, string>> = {
  'signs-out-members': 'members are signed out, or sooner than before',
  'may-lock-out-members':
    'members may be unable to sign in until they act — a stricter password, a second factor, failed sign-ins counted',
  'removes-human-approval':
    "something that waited for a person's approval or review no longer does",
  'changes-serving-account':
    "the organization's requests go to another endpoint, or are served with another credential",
  'breaks-dependents': 'something that uses the resource stops working',
  'requires-empty-corpus':
    'taken only while the knowledge base holds no document and no website',
  're-embeds-documents': 'what is indexed is turned into vectors again',
  'restart-required': 'takes effect once the deployment restarts',
  'sends-email': 'an email goes out',
  'revokes-access': 'someone loses access',
  irreversible: 'cannot be undone',
  'erases-personal-data': 'personal data is erased',
  'staged-cooldown': 'takes effect only after a waiting period',
  'reaches-vendor': "the organization's key is sent to the provider",
  'ends-running-work': 'work that is running is stopped',
};

/** Every refusal the settings tools answer of their own; a kind's writer
 * answers its own codes too, each with its sentence and a hint. */
const REFUSALS: ReadonlyArray<readonly [code: string, meaning: string]> = [
  [
    'INVALID_ARGUMENTS',
    'The call is malformed, or `expected` misses a changed resource or names one no change changes: fix every problem in data.issues.',
  ],
  [
    'SETTINGS_INVALID',
    "A config is not the kind's: data.issues names every problem by its pointer, a field the setting does not have among them.",
  ],
  [
    'SETTINGS_ID_REQUIRED',
    'A change names no resource: give its id, or the config that carries it.',
  ],
  [
    'SETTINGS_ID_INVALID',
    "The id is not the kind's form, or names another resource than the config does.",
  ],
  [
    'SETTINGS_IDS_REQUIRED',
    'The kind reads only the resources a call names: pass ids.',
  ],
  [
    'SETTINGS_NOT_FOUND',
    'An act names a resource that does not exist: get_settings lists what does.',
  ],
  [
    'SETTINGS_DUPLICATE',
    'One call changes a resource twice: send one change per resource, its whole config as it should end.',
  ],
  [
    'SETTINGS_STALE',
    'A resource changed since it was read: read it again, plan against what is stored, and apply with data.currentHash.',
  ],
  [
    'SETTINGS_KIND_UNAVAILABLE',
    'This deployment does not serve the kind over MCP: the person changes it in Tale.',
  ],
  [
    'SETTINGS_TALE_ONLY',
    'The change is made in Tale alone — a secret entered there, or a workflow of its own: tell the person where.',
  ],
  [
    'SECRET_ARGUMENT_REFUSED',
    'A change carries a secret, or a masked value where nothing is stored: data.places names where, never the value. A person enters a secret in Tale.',
  ],
  ['INVALID_CURSOR', 'Pass the nextCursor a listing answered, or none.'],
  [
    'UNKNOWN_POLICY_TYPE',
    'The id names no policy the governance kind takes: the governance section above lists them.',
  ],
  [
    'PROVIDER_IN_USE',
    'Credentials still name the provider: remove them first (kind provider-credential).',
  ],
  [
    'CREDENTIAL_IN_USE',
    'The embedding model uses the credential: point the knowledge-embedding setting at another first.',
  ],
  [
    'PROJECT_AGENT_MANAGED',
    'Tale manages the agent: it changes in Tale alone.',
  ],
  [
    'FORBIDDEN',
    "The person's role cannot make the change in the app either: say so; do not retry.",
  ],
  [
    'EMBEDDING_CORPUS_NOT_EMPTY',
    'The embedding model changes only while the knowledge base is empty; data names how many documents and websites it holds.',
  ],
  [
    'BRANDING_IMAGE_UNKNOWN',
    'A branding file name names no image uploaded to the organization: images are uploaded in Tale.',
  ],
  [
    'CATALOG_REFRESH_FAILED',
    "A provider's catalog could not be read: check its endpoint and credential, then refresh again.",
  ],
  [
    'RATE_LIMITED',
    "apply_settings drew on the key holder's settings budget once too often: wait data.retryAfterMs.",
  ],
  [
    'INTERNAL_ERROR',
    'A writer failed unexpectedly: read what landed with get_settings, and give data.requestId to whoever runs Tale.',
  ],
];

/** The schema each kind's config is read through; `governance` reads each
 * policy through its own. */
const CONFIG_SCHEMAS: Readonly<
  Record<Exclude<SettingsKind, 'governance'>, z.ZodType>
> = {
  provider: providerDefinitionSchema,
  'provider-credential': providerEnvironmentCredentialSchema,
  'knowledge-embedding': knowledgeEmbeddingWriteSchema,
  branding: brandingFormSchema,
  'project-instructions': managedProjectInstructionsSchema,
  'agent-instructions': managedAgentInstructionsSchema,
  'agent-tools': managedAgentToolsSchema,
  'task-instructions': managedTaskInstructionsSchema,
  deployment: deploymentConfigSchema,
};

/** A config's fields as JSON Schema, compact. A check JSON Schema cannot
 * state reads as no constraint: the writer still makes it. */
function fieldsOf(schema: z.ZodType): string {
  const { $schema: _dialect, ...json } = z.toJSONSchema(schema, {
    target: 'draft-2020-12',
    io: 'input',
    unrepresentable: 'any',
  });
  return ['```json', JSON.stringify(json), '```'].join('\n');
}

const WORKFLOW = [
  '## How a change is made',
  '',
  '1. get_settings without kinds: the catalog — each kind, its operations and acts, its base risk, the Settings pages it covers, whether this deployment serves it, and whether your role may read and change it.',
  '2. get_settings with kinds (and ids): each resource with its `key`, its `config` and its `hash`. A listing that has more answers `nextCursor`.',
  '3. plan_settings with the changes: for each, the `action` (create, update, delete, act or unchanged), the `diff`, its `effects` and its `risk`, or why it is refused. Nothing is written. Show the plan to the person, the effects and the risk first.',
  '4. apply_settings with the same changes and `expected`: every changed resource by its key, with the hash you read (null for one you create). Every change is planned again against what is stored now; one refusal or one resource that moved applies nothing.',
  '',
  "A change is `{kind, id, op, config}`: `set` replaces the whole resource with `config` — send every field it should keep, as you read it; `delete` removes it; `act` runs one of the kind's acts. A resource's key is `<kind>/<id>`, or the kind alone for a kind with one resource.",
  '',
  "Changes run in a fixed order across kinds, so what a resource names exists first; the first failure stops the rest, and the answer says what was applied, what failed and what was skipped. Nothing that landed is undone. Every change is in the audit log as the person's, made through MCP.",
  '',
  '## Secrets',
  '',
  'No secret goes into or comes out of a settings call. A stored secret, and any credential found in a stored setting, reads as `{masked: true, preview}`; send that value back unchanged to keep what is stored there. A secret in a change is refused, naming where it was found. A person enters a new secret in Tale.',
];

function effectsSection(): string[] {
  return [
    '## Effects and risk',
    '',
    "A plan's risk is the highest of its kind's base risk and its effects'.",
    '',
    '| Effect | Risk | What happens |',
    '| --- | --- | --- |',
    ...Object.entries(SETTINGS_EFFECTS).map(
      ([effect, risk]) =>
        `| ${effect} | ${risk} | ${Reflect.get(EFFECT_MEANINGS, effect)} |`,
    ),
  ];
}

function kindSection(descriptor: (typeof SETTINGS_KINDS)[number]): string[] {
  const header = [
    `### ${descriptor.kind}`,
    '',
    descriptor.description,
    '',
    `Scope: ${descriptor.scope}. Operations: ${descriptor.ops.join(', ')}${descriptor.acts.length > 0 ? `; acts: ${descriptor.acts.join(', ')}` : ''}. Base risk: ${descriptor.baseRisk}.${descriptor.areas.length > 0 ? ` In Tale: Settings > ${descriptor.areas.join(', ')}.` : ''}`,
    '',
  ];
  if (descriptor.kind !== 'governance') {
    return [
      ...header,
      'Config:',
      '',
      fieldsOf(CONFIG_SCHEMAS[descriptor.kind]),
      '',
    ];
  }
  const policies = FILE_POLICY_TYPES.filter(
    (key) => !Object.hasOwn(GOVERNANCE_KEYS_NOT_OVER_MCP, key),
  ).toSorted();
  return [
    ...header,
    'Each policy, by its key (the id), with its config:',
    '',
    ...policies.flatMap((key) => [
      `- \`${key}\``,
      '',
      fieldsOf(POLICY_SCHEMAS[key]),
      '',
    ]),
    'Not over MCP:',
    '',
    ...Object.entries(GOVERNANCE_KEYS_NOT_OVER_MCP).map(
      ([key, reason]) => `- \`${key}\` ${reason}.`,
    ),
    '',
  ];
}

export function settingsReference(): string {
  return [
    '# Settings reference',
    '',
    "What a coding agent may read and change of the organization's settings through get_settings, plan_settings and apply_settings: the same changes the person's role allows in Tale, through the code Tale's own Settings pages use.",
    '',
    ...WORKFLOW,
    '',
    ...effectsSection(),
    '',
    '## Kinds',
    '',
    ...SETTINGS_KINDS.flatMap(kindSection),
    'Not settings kinds, on purpose:',
    '',
    ...SETTINGS_KINDS_NOT_OVER_MCP.map(
      (entry) => `- \`${entry.kind}\`: ${entry.reason}`,
    ),
    '',
    '## Refusals',
    '',
    "A refusal is data `{error, code, hint, data}`. Besides each kind's own codes:",
    '',
    '| Code | What it means |',
    '| --- | --- |',
    ...REFUSALS.map(([code, meaning]) => `| ${code} | ${meaning} |`),
    '',
  ].join('\n');
}
