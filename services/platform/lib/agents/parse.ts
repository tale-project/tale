/**
 * An agent file ⇄ an {@link AgentDefinition}.
 *
 * The document is a plain YAML mapping — no fenced frontmatter, no body: an
 * agent is configuration, not a document, so everything it says is a field.
 * Parsing goes through the shared safe YAML loader (core schema only, bounded
 * alias expansion, size cap) and then the shared agent schema, so an agent
 * file is held to exactly the same parsing rules as every other org config
 * file.
 *
 * Every failure carries the file's path. An agent that cannot be read is a
 * misconfiguration an operator has to see, not a file to quietly skip: the
 * thrown error names the path and the offending field, and a key that was
 * REMOVED from the format is reported as what it is — a setting that no
 * longer exists, with what replaced it — rather than as an anonymous unknown
 * key.
 *
 * Pure: no filesystem, no Convex. Callers hand in text they read themselves.
 */

import { parseYaml, stringifyYaml } from '../shared/config/yaml';
import {
  agentDefinitionToRaw,
  findRetiredAgentSetting,
  MAX_AGENT_FILE_BYTES,
  validateAgentFile,
  type AgentDefinition,
} from '../shared/schemas/agents';
import { formatZodError } from '../shared/schemas/format-error';

/** An agent file that could not be read as one, with the path that produced it. */
export class AgentParseError extends Error {
  override readonly name = 'AgentParseError';
  /** Path of the offending file, as the caller knows it. */
  readonly path: string;
  /** What is wrong, without the path — for messages that name their own. */
  readonly detail: string;

  constructor(path: string, detail: string) {
    super(`${path}: ${detail}`);
    this.path = path;
    this.detail = detail;
  }
}

/**
 * Parse an agent file into a validated definition. Throws
 * {@link AgentParseError} — naming `path` — for anything that is not a
 * well-formed, schema-valid agent.
 */
export function parseAgentYaml(content: string, path: string): AgentDefinition {
  const parsed = parseYaml(content, { maxBytes: MAX_AGENT_FILE_BYTES });
  if (!parsed.ok) {
    throw new AgentParseError(path, parsed.error);
  }

  // Named first: "supported-models is not a setting any more" is an answer,
  // where "unrecognized key" would just be a shrug.
  const retired = findRetiredAgentSetting(parsed.data);
  if (retired !== null) {
    throw new AgentParseError(path, retired);
  }

  const validated = validateAgentFile(parsed.data);
  if (!validated.ok) {
    throw new AgentParseError(path, formatZodError(validated.error));
  }
  return validated.agent;
}

/**
 * Serialize a definition back into the on-disk form. Key order is fixed by
 * {@link agentDefinitionToRaw}, so an edit that changes one field leaves the
 * rest of the file exactly where it was.
 */
export function serializeAgentYaml(agent: AgentDefinition): string {
  return stringifyYaml(agentDefinitionToRaw(agent));
}
