import { defineAbilityFor } from '../permissions/ability';

/**
 * What a coding agent may be given when a person connects it to Tale by
 * signing in from the agent (OAuth on the MCP endpoint): the scopes it asks
 * for, the access levels the consent page offers, and the most a role may
 * grant. The authorization server, the consent gate, the MCP door and the
 * consent page all read it here, so the page never offers what the server
 * would refuse and the door never honours what the page could not offer.
 *
 * A scope never widens a role: every call checks the person's live role
 * first and the granted scopes second.
 */

/** Where the MCP endpoint answers, under a deployment's base path. */
export const MCP_PATH = '/api/v1/mcp';

/** The scopes an agent connection can hold, in the order they are taught:
 * read and test, then what edits automations, then settings, then
 * subscriptions. `tale:mcp` is part of every connection. */
export const AGENT_SCOPES = [
  'tale:mcp',
  'tale:automations.write',
  'tale:automations.deploy',
  'tale:settings.read',
  'tale:settings.write',
  'tale:subscriptions.connect',
] as const;

export type AgentScope = (typeof AGENT_SCOPES)[number];

/** The OAuth scope that keeps a connection signed in past its first token
 * (a refresh token): shown as "Stays connected", never a choice. */
export const OFFLINE_ACCESS = 'offline_access';

/** The scopes the MCP endpoint takes as an OAuth resource: a connection's,
 * and the one that keeps it signed in. */
export const MCP_RESOURCE_SCOPES: readonly string[] = [
  ...AGENT_SCOPES,
  OFFLINE_ACCESS,
];

const AGENT_SCOPE_SET: ReadonlySet<string> = new Set(AGENT_SCOPES);

export function isAgentScope(scope: string): scope is AgentScope {
  return AGENT_SCOPE_SET.has(scope);
}

/** The words of an OAuth `scope` parameter (RFC 6749 §3.3: space-separated),
 * blanks dropped. */
export function scopesOf(scope: string | null | undefined): string[] {
  return (scope ?? '').split(' ').filter((word) => word !== '');
}

/** Whether a request asks for anything an agent connection grants — what
 * tells an agent's sign-in from an application's single sign-on. */
export function requestsAgentAccess(scopes: Iterable<string>): boolean {
  for (const scope of scopes) {
    if (AGENT_SCOPE_SET.has(scope)) return true;
  }
  return false;
}

/**
 * The access levels the consent page offers, each adding to the one before:
 * read and test (validate, mock runs, reads), edit (save new versions — the
 * person still deploys), and edit and deploy (deploy, triggers, live runs,
 * answers to runs, capabilities, installing and deleting automations).
 */
export const ACCESS_LEVELS = {
  read: ['tale:mcp'],
  edit: ['tale:mcp', 'tale:automations.write'],
  deploy: ['tale:mcp', 'tale:automations.write', 'tale:automations.deploy'],
} as const satisfies Record<string, readonly AgentScope[]>;

export type AccessLevel = keyof typeof ACCESS_LEVELS;

const LEVELS_HIGHEST_FIRST: readonly AccessLevel[] = ['deploy', 'edit', 'read'];

/** The highest level a set of scopes holds whole, or null when it lacks
 * `tale:mcp` (no connection holds less than reading and testing). */
export function levelOf(scopes: Iterable<string>): AccessLevel | null {
  const held = new Set(scopes);
  return (
    LEVELS_HIGHEST_FIRST.find((level) =>
      ACCESS_LEVELS[level].every((scope) => held.has(scope)),
    ) ?? null
  );
}

/** A scope in the words the consent page uses for the access it gives —
 * what a refusal that tells an agent to ask for more names it by. */
const SCOPE_WORDS: Readonly<Record<AgentScope, string>> = {
  'tale:mcp': 'Read and test',
  'tale:automations.write': 'Edit',
  'tale:automations.deploy': 'Edit and deploy',
  'tale:settings.read': 'Read settings',
  'tale:settings.write': 'Change settings',
  'tale:subscriptions.connect': 'Connect subscriptions',
};

export function describeAgentScope(scope: AgentScope): string {
  return SCOPE_WORDS[scope];
}

/** The scopes that write, deploy, change settings or connect a subscription
 * — the ones that take the developer bar. */
const DEVELOPER_SCOPES: ReadonlySet<string> = new Set<AgentScope>([
  'tale:automations.write',
  'tale:automations.deploy',
  'tale:settings.write',
  'tale:subscriptions.connect',
]);

/**
 * The most a role may grant an agent, read from the same abilities the app
 * checks — never a second role table: a role that may see the developer
 * settings (owner, admin, developer) may grant every scope; any other active
 * role reads and tests and reads the settings it can see (each settings
 * kind filters by role); a disabled seat or an unknown role grants nothing.
 */
export function scopeCeilingForRole(role: string | null): AgentScope[] {
  const ability = defineAbilityFor(role);
  if (!ability.can('read', 'knowledgeRead')) return [];
  const developer = ability.can('read', 'developerSettings');
  return AGENT_SCOPES.filter(
    (scope) => developer || !DEVELOPER_SCOPES.has(scope),
  );
}

/** Whether granting these scopes needs a sign-in from the last day: any
 * access beyond reading and testing and reading settings changes something
 * in Tale. */
export function needsFreshSession(scopes: Iterable<string>): boolean {
  for (const scope of scopes) {
    if (DEVELOPER_SCOPES.has(scope)) return true;
  }
  return false;
}
