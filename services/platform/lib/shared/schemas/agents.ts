/**
 * Schema for an agent file — the on-disk shape of the `agents` org config
 * domain (`<orgSlug>/agents/<slug>.yml`, one flat file per agent).
 *
 * An agent is a PERSONA, not a runtime. It says who is answering — a name, a
 * description, instructions, what it may reach for, and who in the org may
 * use it — and nothing about how a turn executes. Everything that decided
 * execution is deliberately absent and may not come back:
 *
 *  - **model** — the person composing the turn picks the model, explicitly,
 *    every time. An agent that pinned one silently overrode that choice.
 *  - **timeouts / step and call ceilings** — an execution ceiling is a
 *    property of the host that runs the turn, not a per-persona policy.
 *  - **agent type / behavior / runtime kind / auth mode** — whether a turn
 *    runs in a sandbox is decided in the conversation (and some credentials
 *    force a harness), so a persona cannot pre-commit to one.
 *  - **environment variables and secrets** — an agent holds no credentials;
 *    credentials belong to the organization's provider and integration
 *    records, where they can be rotated and audited in one place.
 *  - **routing metadata** — nothing picks an agent on the user's behalf.
 *  - **conversation starters** — the composer is the entry point.
 *
 * Files carrying any of those keys are REJECTED with a message naming the key
 * (see {@link RETIRED_AGENT_SETTINGS}) rather than silently ignored: a file
 * that still says `model:` reads, to whoever wrote it, like a file that still
 * pins a model. The conversion that produced this format keeps every dropped
 * value under `metadata.retired`, so rejecting the top-level key loses
 * nothing.
 *
 * Wire format is kebab-case (`display-name`, `i18n.<locale>.display-name`),
 * matching the rest of the YAML config constitution; internal code consumes
 * the camelCase {@link AgentDefinition} shape.
 *
 * Layer A: imports ONLY `zod/v4` and sibling schema modules — no `node:*`, no
 * `convex/_generated` — so it is safe to import from V8 Convex code, `'use
 * node'` actions, Bun scripts, vitest, and the browser alike.
 */

import { z } from 'zod/v4';

import { SKILL_SLUG_REGEX } from './skills';

/**
 * Canonical shape of an agent slug — its file stem. Underscores are allowed
 * beside hyphens because agent slugs are quoted by things outside the config
 * tree (a webhook's target, a mention), so an existing `code_reviewer` has to
 * keep reading as itself rather than being renamed under its own references.
 */
export const AGENT_SLUG_REGEX = /^[a-z0-9]+([_-][a-z0-9]+)*$/;

/** Upper bound on a slug, matching the filename budget on disk. */
export const MAX_AGENT_SLUG_LENGTH = 64;

/** Cap on a whole agent file. Generous for instructions, small enough that a
 *  runaway document is rejected before the YAML parser walks it. */
export const MAX_AGENT_FILE_BYTES = 256 * 1024;

/** Cap on the instructions block, top-level or per locale. */
export const MAX_AGENT_INSTRUCTIONS_LENGTH = 20_000;

/**
 * How many skills one agent may bind. A binding list is a hard allowlist an
 * operator maintains by hand; past a handful it stops being one.
 */
export const MAX_AGENT_SKILL_BINDINGS = 10;

/** How many capabilities one agent may name in its allowlist. */
export const MAX_AGENT_TOOL_BINDINGS = 100;

/** How an agent is shared inside its organization. */
export const AGENT_VISIBILITIES = ['private', 'org'] as const;
export type AgentVisibility = (typeof AGENT_VISIBILITIES)[number];

/**
 * Default when a file carries no `visibility`. An agent file in an org's tree
 * was put there deliberately, and defaulting to `private` would make an
 * ownerless one usable by nobody at all.
 */
export const DEFAULT_AGENT_VISIBILITY: AgentVisibility = 'org';

/**
 * Which knowledge an agent's retrieval may read. The three non-`none` values
 * are exactly the corpus selector the retrieval layer takes: `documents` is
 * the organization's own uploads, `web` the pages fetched on its behalf, and
 * `all` both, fused. `none` means the agent is offered no knowledge tool at
 * all. Every corpus is per-organization, so widening the scope never crosses
 * a tenant boundary — it only decides how much of the org's own material this
 * persona is pointed at.
 */
export const AGENT_KNOWLEDGE_SCOPES = [
  'none',
  'documents',
  'web',
  'all',
] as const;
export type AgentKnowledgeScope = (typeof AGENT_KNOWLEDGE_SCOPES)[number];

/**
 * Default when a file names no knowledge scope. Absent means "not narrowed",
 * the same rule the tool and skill allowlists follow: state a narrower scope
 * to narrow it, state `none` to switch retrieval off.
 */
export const DEFAULT_AGENT_KNOWLEDGE_SCOPE: AgentKnowledgeScope = 'all';

/**
 * Settings an agent no longer has, mapped to what replaced them. Both the
 * kebab-case spelling this format would use and the camelCase spelling the
 * previous JSON format used resolve to the same entry (see
 * {@link retiredAgentSetting}), so a hand-converted file gets the same
 * explanation as a stale one.
 */
export const RETIRED_AGENT_SETTINGS: Readonly<Record<string, string>> = {
  model:
    'the model is chosen per turn in the composer, never pinned by an agent',
  models:
    'the model is chosen per turn in the composer, never pinned by an agent',
  'supported-models':
    'the model is chosen per turn in the composer, never pinned by an agent',
  provider:
    'the model is chosen per turn in the composer, so the provider follows from it',
  'vision-model':
    'image reading follows the model chosen for the turn, not the agent',
  'timeout-ms':
    'an execution ceiling belongs to the host that runs the turn, not to a persona',
  'max-steps':
    'an execution ceiling belongs to the host that runs the turn, not to a persona',
  'output-reserve':
    'the context budget is derived from the model chosen for the turn',
  'max-integration-calls-per-run':
    'an execution ceiling belongs to the host that runs the turn, not to a persona',
  'max-concurrent-tasks':
    'concurrency is an organization-level limit, not a per-agent one',
  budget: 'spend limits are enforced per organization, not per agent',
  'primary-behavior':
    'an agent has one behaviour; sandbox execution is chosen in the conversation',
  'agent-kind':
    'the harness is chosen in the conversation, and some credentials force one',
  'auth-mode':
    'credentials belong to the organization, so there is nothing to switch per agent',
  'native-web-tools':
    'web access is a capability the agent may be allowed, not a runtime flag',
  runtime: 'sandbox execution is chosen in the conversation, not pre-committed',
  'prefer-durable-step-for-tasks':
    'how a run is hosted is decided when it starts, not by the persona',
  'is-router': 'nothing picks an agent on the user’s behalf any more',
  routing: 'nothing picks an agent on the user’s behalf any more',
  'conversation-starters':
    'the composer is the entry point; an agent ships no canned openers',
  env: 'an agent holds no credentials; they belong to the organization',
  secrets: 'an agent holds no credentials; they belong to the organization',
  'personalization-mode':
    'memories are an explicit tool a member approves, never injected',
  'structured-responses-enabled':
    'response shape is decided by what the caller asked for',
  'composer-mode': 'the composer decides how it presents itself',
  'role-restriction': 'use `visibility` to decide who may reach this agent',
  'visible-in-chat': 'use `visibility` to decide who may reach this agent',
  'ui-configurable':
    'every agent file in an organization’s tree is editable by it',
  'knowledge-mode':
    'retrieval happens only when the agent calls for it; use `knowledge` for its scope',
  'web-search-mode':
    'retrieval happens only when the agent calls for it; use `knowledge` for its scope',
  'include-org-knowledge': 'use `knowledge` for the retrieval scope',
  'include-team-knowledge': 'use `knowledge` for the retrieval scope',
  'knowledge-top-k': 'how many passages to read is decided per search',
  'avatar-url': 'use `icon` for the agent’s visual identity',
  'system-instructions': 'renamed to `instructions`',
  'tool-names': 'renamed to `tools`',
  'skill-bindings': 'renamed to `skills`',
  'integration-bindings':
    'integrations are reached as capabilities; name them in `tools`',
  workflows: 'automations are reached as capabilities; name them in `tools`',
  slug: 'the file name is the slug; `name` must match it',
};

/** camelCase → kebab-case, so a stale key is recognized either way. */
function toKebabCase(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

/**
 * Why `key` is not an agent setting any more, or `null` when it never was
 * one. Accepts either spelling of the key.
 */
export function retiredAgentSetting(key: string): string | null {
  return RETIRED_AGENT_SETTINGS[toKebabCase(key)] ?? null;
}

const agentSlugSchema = z
  .string()
  .min(1)
  .max(MAX_AGENT_SLUG_LENGTH)
  .regex(AGENT_SLUG_REGEX, {
    message:
      'name must be lowercase letters, digits and single hyphens or underscores (no leading, trailing or repeated separators)',
  });

const localeKeyRegex = /^[a-z]{2}(-[A-Z]{2})?$/;

/** The fields a locale may override. Everything else reads the same in every
 *  language. */
const translatedFieldsSchema = z
  .object({
    'display-name': z.string().min(1).max(200).optional(),
    description: z.string().max(1000).optional(),
    instructions: z.string().max(MAX_AGENT_INSTRUCTIONS_LENGTH).optional(),
  })
  .strict();

/**
 * Raw file contents exactly as they appear on disk. `.strict()` on purpose:
 * an agent file is written by this platform's own tooling, so an unknown key
 * is either a typo that would silently do nothing or a setting that was
 * deliberately removed — both are worth an error naming the key. Exported so
 * the org-config schema snapshot tracks it and a later narrowing is caught as
 * the data-incompatible change it would be.
 */
export const agentFileSchema = z
  .object({
    /** The agent's slug; must equal the file stem. */
    name: agentSlugSchema,
    /** The label a member sees. `i18n` overrides it per locale. */
    'display-name': z.string().min(1).max(200),
    description: z.string().max(1000).optional(),
    /**
     * Who may see and use this agent inside the org. Absent means
     * {@link DEFAULT_AGENT_VISIBILITY}.
     */
    visibility: z.enum(AGENT_VISIBILITIES).optional(),
    /**
     * The member who owns the agent, as a user id. Required for a `private`
     * agent (nobody could reach an ownerless one); on an `org` agent it is
     * attribution only.
     */
    owner: z.string().min(1).max(128).optional(),
    /** Iconify id (`set:name`) shown wherever the agent is offered. */
    icon: z
      .string()
      .max(128)
      .regex(/^[a-z0-9]+(-[a-z0-9]+)*:[a-z0-9]+(-[a-z0-9]+)*$/, {
        message:
          'icon must be an Iconify id like "lucide:bot" (a "set:name" pair of lowercase letters, digits and hyphens)',
      })
      .optional(),
    /** Display chips shown on the agent's card. */
    labels: z.array(z.string().min(1).max(40)).max(8).optional(),
    /**
     * The persona's own instructions, prepended to every turn it answers.
     * Optional: an agent that adds no instructions simply contributes no
     * instruction block.
     */
    instructions: z.string().max(MAX_AGENT_INSTRUCTIONS_LENGTH).optional(),
    /**
     * Hard allowlist of capability ids this agent may call. ABSENT means "not
     * narrowed" — every capability the organization offers. An EMPTY list
     * means none at all.
     */
    tools: z
      .array(z.string().min(1).max(120))
      .max(MAX_AGENT_TOOL_BINDINGS)
      .optional(),
    /**
     * Hard allowlist of skill slugs this agent may expand, each naming a
     * bundle in the org's `skills/` domain. ABSENT means "not narrowed"; an
     * EMPTY list means the agent expands no skills.
     */
    skills: z
      .array(z.string().min(1).max(64).regex(SKILL_SLUG_REGEX))
      .max(MAX_AGENT_SKILL_BINDINGS)
      .optional(),
    /** Which knowledge the agent's retrieval may read; absent means
     *  {@link DEFAULT_AGENT_KNOWLEDGE_SCOPE}. */
    knowledge: z.enum(AGENT_KNOWLEDGE_SCOPES).optional(),
    /** Per-locale overrides of the translatable fields. */
    i18n: z
      .record(z.string().regex(localeKeyRegex), translatedFieldsSchema)
      .optional(),
    /**
     * Free-form data the platform carries but does not interpret. The
     * conversion from the previous format parks everything an agent no longer
     * has under `metadata.retired`, so nothing is lost by removing a setting.
     */
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()
  .refine(
    (raw) => raw.visibility !== 'private' || raw.owner !== undefined,
    // A private agent with no owner would be reachable by nobody, so it is
    // rejected at the door rather than silently disappearing from listings.
    {
      message: 'owner is required when visibility is "private"',
      path: ['owner'],
    },
  );

type RawAgentFile = z.infer<typeof agentFileSchema>;

/** The translatable fields, as internal code reads them. */
export interface AgentTranslations {
  displayName?: string;
  description?: string;
  instructions?: string;
}

/** Normalized (camelCase) agent definition consumed by Tale code. */
export interface AgentDefinition {
  /** The agent's slug; equals its file stem. */
  name: string;
  displayName: string;
  description?: string;
  visibility: AgentVisibility;
  owner?: string;
  icon?: string;
  labels?: string[];
  instructions?: string;
  /** Hard capability allowlist; `undefined` means "not narrowed". */
  tools?: string[];
  /** Hard skill allowlist; `undefined` means "not narrowed". */
  skills?: string[];
  knowledge: AgentKnowledgeScope;
  i18n?: Record<string, AgentTranslations>;
  metadata?: Record<string, unknown>;
}

/** Validate already-parsed file data into the normalized shape. */
export function validateAgentFile(data: unknown):
  | {
      readonly ok: true;
      readonly agent: AgentDefinition;
    }
  | {
      readonly ok: false;
      readonly error: z.ZodError;
    } {
  const result = agentFileSchema.safeParse(data);
  if (!result.success) {
    return { ok: false, error: result.error };
  }
  return { ok: true, agent: normalizeAgentFile(result.data) };
}

/**
 * The first retired setting `data` still carries, phrased for whoever has to
 * fix the file. Checked BEFORE the schema so the operator is told what
 * happened to the setting instead of only that the key is unknown.
 */
export function findRetiredAgentSetting(data: unknown): string | null {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return null;
  }
  for (const key of Object.keys(data)) {
    const reason = retiredAgentSetting(key);
    if (reason !== null) {
      return `"${key}" is not an agent setting any more — ${reason}. A converted agent keeps its previous value under metadata.retired.`;
    }
  }
  return null;
}

function normalizeTranslations(
  raw: z.infer<typeof translatedFieldsSchema>,
): AgentTranslations {
  const translations: AgentTranslations = {};
  if (raw['display-name'] !== undefined) {
    translations.displayName = raw['display-name'];
  }
  if (raw.description !== undefined) translations.description = raw.description;
  if (raw.instructions !== undefined) {
    translations.instructions = raw.instructions;
  }
  return translations;
}

function normalizeAgentFile(raw: RawAgentFile): AgentDefinition {
  const agent: AgentDefinition = {
    name: raw.name,
    displayName: raw['display-name'],
    visibility: raw.visibility ?? DEFAULT_AGENT_VISIBILITY,
    knowledge: raw.knowledge ?? DEFAULT_AGENT_KNOWLEDGE_SCOPE,
  };
  if (raw.description !== undefined) agent.description = raw.description;
  if (raw.owner !== undefined) agent.owner = raw.owner;
  if (raw.icon !== undefined) agent.icon = raw.icon;
  if (raw.labels !== undefined) agent.labels = raw.labels;
  if (raw.instructions !== undefined) agent.instructions = raw.instructions;
  if (raw.tools !== undefined) agent.tools = raw.tools;
  if (raw.skills !== undefined) agent.skills = raw.skills;
  if (raw.i18n !== undefined) {
    agent.i18n = Object.fromEntries(
      Object.entries(raw.i18n).map(([locale, fields]) => [
        locale,
        normalizeTranslations(fields),
      ]),
    );
  }
  if (raw.metadata !== undefined) agent.metadata = raw.metadata;
  return agent;
}

/**
 * Turn a normalized definition back into the kebab-case on-disk mapping. Key
 * order is stable so an unchanged agent re-serializes byte-identically.
 */
export function agentDefinitionToRaw(
  agent: AgentDefinition,
): Record<string, unknown> {
  const raw: Record<string, unknown> = {
    name: agent.name,
    'display-name': agent.displayName,
  };
  if (agent.description !== undefined) raw.description = agent.description;
  raw.visibility = agent.visibility;
  if (agent.owner !== undefined) raw.owner = agent.owner;
  if (agent.icon !== undefined) raw.icon = agent.icon;
  if (agent.labels !== undefined) raw.labels = agent.labels;
  if (agent.instructions !== undefined) raw.instructions = agent.instructions;
  if (agent.tools !== undefined) raw.tools = agent.tools;
  if (agent.skills !== undefined) raw.skills = agent.skills;
  raw.knowledge = agent.knowledge;
  if (agent.i18n !== undefined) {
    raw.i18n = Object.fromEntries(
      Object.entries(agent.i18n).map(([locale, fields]) => {
        const translated: Record<string, unknown> = {};
        if (fields.displayName !== undefined) {
          translated['display-name'] = fields.displayName;
        }
        if (fields.description !== undefined) {
          translated.description = fields.description;
        }
        if (fields.instructions !== undefined) {
          translated.instructions = fields.instructions;
        }
        return [locale, translated];
      }),
    );
  }
  if (agent.metadata !== undefined) raw.metadata = agent.metadata;
  return raw;
}

/** True when `slug` is a usable agent file stem. */
export function isValidAgentSlug(slug: string): boolean {
  return agentSlugSchema.safeParse(slug).success;
}
