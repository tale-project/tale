// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { defineAbilityFor } from '../permissions/ability';
import {
  ACCESS_LEVELS,
  AGENT_SCOPES,
  type AgentScope,
  describeAgentScope,
  EXTRA_SCOPES,
  isAgentScope,
  levelOf,
  MCP_PATH,
  needsFreshSession,
  OFFLINE_ACCESS,
  requestsAgentAccess,
  scopeCeilingForRole,
  scopesOf,
} from './agent-access';

const WRITE_SCOPES: AgentScope[] = [
  'tale:automations.write',
  'tale:automations.deploy',
  'tale:settings.write',
  'tale:subscriptions.connect',
];

describe('the scopes a coding agent asks for', () => {
  it('are the six Tale scopes, each named under tale:', () => {
    expect(AGENT_SCOPES).toEqual([
      'tale:mcp',
      'tale:automations.write',
      'tale:automations.deploy',
      'tale:settings.read',
      'tale:settings.write',
      'tale:subscriptions.connect',
    ]);
    expect(OFFLINE_ACCESS).toBe('offline_access');
    expect(MCP_PATH).toBe('/api/v1/mcp');
  });

  it('tells an agent scope from an OIDC or an unknown one', () => {
    expect(isAgentScope('tale:settings.write')).toBe(true);
    expect(isAgentScope('tale:organization')).toBe(false);
    expect(isAgentScope('openid')).toBe(false);
    expect(isAgentScope(OFFLINE_ACCESS)).toBe(false);
  });

  it('reads a scope parameter as its words, without blanks', () => {
    expect(scopesOf('  tale:mcp   offline_access ')).toEqual([
      'tale:mcp',
      'offline_access',
    ]);
    expect(scopesOf('')).toEqual([]);
    expect(scopesOf(null)).toEqual([]);
    expect(scopesOf(undefined)).toEqual([]);
  });

  it('marks a request as an agent request when it names any agent scope', () => {
    expect(requestsAgentAccess(['openid', 'tale:mcp'])).toBe(true);
    expect(requestsAgentAccess(['tale:settings.read'])).toBe(true);
    expect(
      requestsAgentAccess(['openid', 'profile', 'email', 'tale:organization']),
    ).toBe(false);
    expect(requestsAgentAccess([OFFLINE_ACCESS])).toBe(false);
  });
});

describe('the access levels the consent page offers', () => {
  it('are cumulative, each one adding to the one before', () => {
    expect(ACCESS_LEVELS.read).toEqual(['tale:mcp']);
    expect(ACCESS_LEVELS.edit).toEqual(['tale:mcp', 'tale:automations.write']);
    expect(ACCESS_LEVELS.deploy).toEqual([
      'tale:mcp',
      'tale:automations.write',
      'tale:automations.deploy',
    ]);
    for (const scope of ACCESS_LEVELS.read) {
      expect(ACCESS_LEVELS.edit).toContain(scope);
    }
    for (const scope of ACCESS_LEVELS.edit) {
      expect(ACCESS_LEVELS.deploy).toContain(scope);
    }
  });

  it('names the highest level a set of scopes holds, and none without tale:mcp', () => {
    expect(levelOf(['tale:mcp'])).toBe('read');
    expect(levelOf(['tale:mcp', 'tale:settings.read', OFFLINE_ACCESS])).toBe(
      'read',
    );
    expect(levelOf(['tale:mcp', 'tale:automations.write'])).toBe('edit');
    // Deploying without saving is no level of its own: the level is edit's
    // ceiling, read.
    expect(levelOf(['tale:mcp', 'tale:automations.deploy'])).toBe('read');
    expect(
      levelOf([
        'tale:mcp',
        'tale:automations.write',
        'tale:automations.deploy',
      ]),
    ).toBe('deploy');
    expect(levelOf(['tale:automations.write'])).toBeNull();
    expect(levelOf([])).toBeNull();
  });
});

describe('the most a role may grant an agent', () => {
  it('derives every ceiling from the role abilities the app checks', () => {
    for (const role of [
      'owner',
      'admin',
      'developer',
      'editor',
      'member',
      'disabled',
      'OWNER',
      'unknown',
    ]) {
      const ability = defineAbilityFor(role);
      const ceiling = scopeCeilingForRole(role);
      const developer = ability.can('read', 'developerSettings');
      const active = ability.can('read', 'knowledgeRead');
      expect(ceiling.includes('tale:mcp')).toBe(active);
      expect(ceiling.includes('tale:settings.read')).toBe(active);
      for (const scope of WRITE_SCOPES) {
        expect(ceiling.includes(scope)).toBe(developer);
      }
    }
  });

  it('lets owners, admins and developers grant everything, editors and members read and test, and a disabled seat nothing', () => {
    expect(scopeCeilingForRole('owner')).toEqual(AGENT_SCOPES);
    expect(scopeCeilingForRole('admin')).toEqual(AGENT_SCOPES);
    expect(scopeCeilingForRole('developer')).toEqual(AGENT_SCOPES);
    expect(scopeCeilingForRole('editor')).toEqual([
      'tale:mcp',
      'tale:settings.read',
    ]);
    expect(scopeCeilingForRole('member')).toEqual([
      'tale:mcp',
      'tale:settings.read',
    ]);
    expect(scopeCeilingForRole('disabled')).toEqual([]);
    expect(scopeCeilingForRole(null)).toEqual([]);
  });
});

describe('the words a refusal uses for a scope', () => {
  it('give every scope its own, so two are never mistaken for each other', () => {
    const words = AGENT_SCOPES.map(describeAgentScope);
    expect(new Set(words).size).toBe(AGENT_SCOPES.length);
    expect(words.every((word) => word.trim() !== '')).toBe(true);
  });

  it('call the three access levels what the consent page calls them', () => {
    expect(describeAgentScope('tale:mcp')).toBe('Read and test');
    expect(describeAgentScope('tale:automations.write')).toBe('Edit');
    expect(describeAgentScope('tale:automations.deploy')).toBe(
      'Edit and deploy',
    );
  });
});

describe('the access that needs a fresh sign-in at consent', () => {
  it('is anything beyond reading and testing, reading settings and staying connected', () => {
    expect(needsFreshSession(['tale:mcp'])).toBe(false);
    expect(
      needsFreshSession(['tale:mcp', 'tale:settings.read', OFFLINE_ACCESS]),
    ).toBe(false);
    for (const scope of WRITE_SCOPES) {
      expect(needsFreshSession(['tale:mcp', scope])).toBe(true);
    }
  });
});

describe('the extras beside an access level', () => {
  it('are the settings scopes and subscriptions, in the order they are taught', () => {
    expect(EXTRA_SCOPES).toEqual([
      'tale:settings.read',
      'tale:settings.write',
      'tale:subscriptions.connect',
    ]);
  });

  it('are scopes of their own: every one is an agent scope and no level holds one', () => {
    for (const extra of EXTRA_SCOPES) {
      expect(isAgentScope(extra)).toBe(true);
      for (const scopes of Object.values(ACCESS_LEVELS)) {
        expect(scopes as readonly string[]).not.toContain(extra);
      }
    }
  });

  it('with the levels cover every scope a connection can hold', () => {
    const covered = new Set<string>([
      ...Object.values(ACCESS_LEVELS).flat(),
      ...EXTRA_SCOPES,
    ]);
    expect([...covered].sort()).toEqual([...AGENT_SCOPES].sort());
  });
});
