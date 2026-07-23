/**
 * Resolving an agent for ONE turn: which words it speaks in the member's
 * language, and what it is allowed to reach for.
 *
 * Resolution is a pure function of the agent file and the turn's locale.
 * Nothing about the model, the harness, or an execution ceiling appears here
 * — those are decided where the turn actually runs, and an agent has no say
 * in them.
 *
 * Localization precedence is the one every other resolver in the platform
 * uses: the exact locale, then its base language (`de-CH` → `de`), then the
 * authored English, then the field as written at the top level. A locale that
 * overrides only the display name therefore still gets the authored
 * instructions rather than nothing.
 *
 * Binding lists follow ONE rule, stated once here and enforced by the two
 * predicates below: an ABSENT list means "not narrowed" — the agent may reach
 * everything the organization offers its members — while an EMPTY list means
 * exactly nothing. That is what makes a narrowing visible in the file: you
 * cannot accidentally restrict an agent by leaving a key out, and you cannot
 * accidentally widen one by writing an empty list.
 */

import type {
  AgentDefinition,
  AgentKnowledgeScope,
  AgentTranslations,
} from '../shared/schemas/agents';
import { narrowBcp47 } from '../shared/utils/narrow-bcp47';
import { pickField } from '../shared/utils/pick-field';

/** An agent as one turn sees it. */
export interface ResolvedAgent {
  readonly slug: string;
  /** The label for this turn's locale. */
  readonly displayName: string;
  readonly description?: string;
  /** Instructions for this turn's locale; absent when the agent adds none. */
  readonly instructions?: string;
  /** Hard capability allowlist; `undefined` means "not narrowed". */
  readonly tools?: readonly string[];
  /** Hard skill allowlist; `undefined` means "not narrowed". */
  readonly skills?: readonly string[];
  /** Which knowledge this agent's retrieval may read. */
  readonly knowledge: AgentKnowledgeScope;
}

/** Read one translatable field across the locale layers, best match first. */
function resolveTranslated(
  agent: AgentDefinition,
  locale: string,
  field: keyof AgentTranslations,
  authored: string | undefined,
): string | undefined {
  const base = narrowBcp47(locale);
  return pickField([
    agent.i18n?.[locale]?.[field],
    base ? agent.i18n?.[base]?.[field] : undefined,
    agent.i18n?.en?.[field],
    authored,
  ]);
}

/**
 * Resolve `agent` for a turn answered in `locale`. Pure: same agent, same
 * locale, same result — no clock, no I/O.
 */
export function resolveAgentForTurn(
  agent: AgentDefinition,
  locale: string,
): ResolvedAgent {
  const resolved: {
    slug: string;
    displayName: string;
    description?: string;
    instructions?: string;
    tools?: readonly string[];
    skills?: readonly string[];
    knowledge: AgentKnowledgeScope;
  } = {
    slug: agent.name,
    // The authored display name is required by the schema, so a locale that
    // overrides nothing still has a label to show.
    displayName:
      resolveTranslated(agent, locale, 'displayName', agent.displayName) ??
      agent.displayName,
    knowledge: agent.knowledge,
  };

  const description = resolveTranslated(
    agent,
    locale,
    'description',
    agent.description,
  );
  if (description !== undefined) resolved.description = description;

  const instructions = resolveTranslated(
    agent,
    locale,
    'instructions',
    agent.instructions,
  );
  if (instructions !== undefined) resolved.instructions = instructions;

  if (agent.tools !== undefined) resolved.tools = [...agent.tools];
  if (agent.skills !== undefined) resolved.skills = [...agent.skills];

  return resolved;
}

/** True when this turn may call `capabilityId` (see the binding rule above). */
export function allowsCapability(
  agent: ResolvedAgent,
  capabilityId: string,
): boolean {
  return agent.tools === undefined || agent.tools.includes(capabilityId);
}

/** True when this turn may expand the skill `slug`. */
export function allowsSkill(agent: ResolvedAgent, slug: string): boolean {
  return agent.skills === undefined || agent.skills.includes(slug);
}
