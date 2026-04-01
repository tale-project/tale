/**
 * Agent name validation.
 *
 * Runtime-agnostic — safe to import from both Node.js and edge runtimes.
 */

const AGENT_NAME_REGEX = /^[a-z0-9][a-z0-9_-]*$/;

export function validateAgentName(name: string): boolean {
  return AGENT_NAME_REGEX.test(name);
}
