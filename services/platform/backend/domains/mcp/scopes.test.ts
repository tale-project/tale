// @vitest-environment node

/**
 * Whether the access a coding agent's connection holds covers a call
 * [MCP-R40, MCP-R41]: a scope narrows the person's role and never widens it.
 */

import { describe, expect, it } from 'vitest';

import { findMcpTool, MCP_TOOLS } from '../../../lib/mcp/tools';
import type { McpCaller } from './caller';
import {
  insufficientScope,
  scopeRefusal,
  scopeShortfalls,
  scopeVerdict,
} from './scopes';

function agent(scopes: readonly string[], role = 'developer'): McpCaller {
  return {
    organizationId: 'org-1',
    orgSlug: 'acme',
    userId: 'user-ada',
    role,
    credential: {
      kind: 'agent',
      connectionId: 'conn-1',
      clientId: 'https://claude.example.test/client.json',
      clientName: 'Claude Code',
      scopes: new Set(scopes),
    },
  };
}

const key: McpCaller = {
  organizationId: 'org-1',
  orgSlug: 'acme',
  userId: 'user-ada',
  role: 'developer',
  credential: { kind: 'api-key', apiKeyId: 'key-1' },
};

const READ = ['tale:mcp', 'offline_access'];
const EDIT = [...READ, 'tale:automations.write'];
const DEPLOY = [...EDIT, 'tale:automations.deploy'];

function tool(name: string) {
  const found = findMcpTool(name);
  if (found === undefined) throw new Error(`${name} is not in the inventory`);
  return found;
}

function call(id: number | undefined, name: string, args: unknown = {}) {
  return {
    jsonrpc: '2.0',
    ...(id === undefined ? {} : { id }),
    method: 'tools/call',
    params: { name, arguments: args },
  };
}

describe('whether a connection covers a call [MCP-R40]', () => {
  it('covers every call made with an API key: a key holds no scopes, its role decides', () => {
    for (const spec of MCP_TOOLS) {
      expect(scopeVerdict(key, spec, {}), spec.name).toEqual({
        kind: 'covered',
      });
    }
  });

  it('covers what the connection was allowed and asks for what it was not', () => {
    expect(scopeVerdict(agent(READ), tool('get_docs'), {})).toEqual({
      kind: 'covered',
    });
    expect(scopeVerdict(agent(READ), tool('save_automation'), {})).toEqual({
      kind: 'ask',
      ask: 'tale:automations.write',
      needs: ['tale:automations.write'],
    });
    expect(scopeVerdict(agent(EDIT), tool('save_automation'), {})).toEqual({
      kind: 'covered',
    });
    expect(scopeVerdict(agent(EDIT), tool('deploy_automation'), {})).toEqual({
      kind: 'ask',
      ask: 'tale:automations.deploy',
      needs: ['tale:automations.deploy'],
    });
    expect(scopeVerdict(agent(DEPLOY), tool('deploy_automation'), {})).toEqual({
      kind: 'covered',
    });
  });

  it('lets a mock start through on reading alone, and asks for deploying on a live one', () => {
    const start = tool('start_run');
    expect(scopeVerdict(agent(READ), start, { mode: 'mock' }).kind).toBe(
      'covered',
    );
    expect(scopeVerdict(agent(READ), start, {}).kind).toBe('ask');
    expect(scopeVerdict(agent(READ), start, { mode: 'live' }).kind).toBe('ask');
  });

  it('takes either settings scope for reading settings, and asks for the lower one', () => {
    const get = tool('get_settings');
    expect(
      scopeVerdict(agent([...READ, 'tale:settings.read']), get, {}).kind,
    ).toBe('covered');
    expect(
      scopeVerdict(agent([...READ, 'tale:settings.write']), get, {}).kind,
    ).toBe('covered');
    expect(scopeVerdict(agent(READ), get, {})).toMatchObject({
      kind: 'ask',
      ask: 'tale:settings.read',
    });
    expect(
      scopeVerdict(
        agent([...READ, 'tale:settings.read']),
        tool('apply_settings'),
        {},
      ),
    ).toMatchObject({ kind: 'ask', ask: 'tale:settings.write' });
  });

  it('does not count a scope that is not an access an agent can hold', () => {
    expect(
      scopeVerdict(agent(['offline_access', 'openid']), tool('get_docs'), {})
        .kind,
    ).toBe('ask');
  });

  it('says a role that could never hold the access cannot be asked for it: a member’s agent reads, tests and reads settings', () => {
    const member = agent([...READ, 'tale:settings.read'], 'member');
    expect(scopeVerdict(member, tool('save_automation'), {})).toMatchObject({
      kind: 'role',
    });
    expect(scopeVerdict(member, tool('invoke_capability'), {})).toMatchObject({
      kind: 'role',
    });
    expect(scopeVerdict(member, tool('apply_settings'), {})).toMatchObject({
      kind: 'role',
    });
    // Reading settings is within a member's ceiling, so it can be asked for.
    expect(
      scopeVerdict(agent(READ, 'member'), tool('get_settings'), {}),
    ).toEqual({
      kind: 'ask',
      ask: 'tale:settings.read',
      needs: ['tale:settings.read', 'tale:settings.write'],
    });
    for (const role of ['editor', 'member']) {
      expect(
        scopeVerdict(agent(READ, role), tool('deploy_automation'), {}).kind,
        role,
      ).toBe('role');
    }
    // A seat that was switched off can be asked for nothing: the door
    // refuses it first, and here there is no access left to ask for.
    expect(
      scopeVerdict(agent(READ, 'disabled'), tool('get_settings'), {}).kind,
    ).toBe('role');
  });
});

describe('the calls that make a request refused whole [MCP-R41]', () => {
  it('names each tool the connection lacks the access for, once, in the order asked', () => {
    expect(
      scopeShortfalls(agent(READ), [
        call(1, 'get_docs'),
        call(2, 'deploy_automation'),
        call(3, 'save_automation'),
        call(4, 'deploy_automation'),
      ]),
    ).toEqual([
      { tool: 'deploy_automation', ask: 'tale:automations.deploy' },
      { tool: 'save_automation', ask: 'tale:automations.write' },
    ]);
  });

  it('counts only a call that would be answered: not a notification, an unknown tool or another method', () => {
    expect(
      scopeShortfalls(agent(READ), [
        call(undefined, 'deploy_automation'),
        call(1, 'no_such_tool'),
        { jsonrpc: '2.0', id: 2, method: 'tools/list' },
        // A name that is a tool's in a message that calls none.
        {
          jsonrpc: '2.0',
          id: 4,
          method: 'prompts/get',
          params: { name: 'deploy_automation' },
        },
        { jsonrpc: '2.0', id: 3, method: 'tools/call', params: [] },
        // A message the protocol layer refuses on its own must not make the
        // look-ahead throw.
        { jsonrpc: '2.0', id: 5, method: 'tools/call', params: null },
        { jsonrpc: '2.0', id: 6, method: 'tools/call' },
        { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 7 } },
        'not a message',
        null,
      ]),
    ).toEqual([]);
  });

  it('leaves out a call whose role could never hold the access: it is refused as a tool error when it is reached', () => {
    expect(
      scopeShortfalls(agent(READ, 'member'), [
        call(1, 'save_automation'),
        call(2, 'invoke_capability'),
        call(3, 'get_settings'),
      ]),
    ).toEqual([{ tool: 'get_settings', ask: 'tale:settings.read' }]);
  });

  it('finds nothing in a request made with a key', () => {
    expect(
      scopeShortfalls(key, [
        call(1, 'deploy_automation'),
        call(2, 'apply_settings'),
      ]),
    ).toEqual([]);
  });

  it('reads the arguments as sent: a mock start passes, a look-alike does not', () => {
    expect(
      scopeShortfalls(agent(READ), [call(1, 'start_run', { mode: 'mock' })]),
    ).toEqual([]);
    expect(
      scopeShortfalls(agent(READ), [call(1, 'start_run', { mode: 'Mock' })]),
    ).toEqual([{ tool: 'start_run', ask: 'tale:automations.deploy' }]);
  });
});

describe('what a request refused for want of access says [MCP-R41]', () => {
  it('names the one tool, the access to ask for and what the connection holds', () => {
    const refusal = insufficientScope(agent(READ), [
      { tool: 'save_automation', ask: 'tale:automations.write' },
    ]);
    expect(refusal.body).toEqual({
      error:
        'save_automation ("Edit") needs access this connection does not hold. Connect the agent again and allow it.',
      code: 'INSUFFICIENT_SCOPE',
      data: {
        tools: ['save_automation'],
        requiredScopes: ['tale:automations.write'],
        grantedScopes: ['offline_access', 'tale:mcp'],
      },
    });
    expect(refusal.description).toBe(
      'save_automation needs the Edit access, which this connection does not hold',
    );
  });

  it('asks for what the agent holds and what it lacks together, so asking again never drops access', () => {
    const refusal = insufficientScope(agent(EDIT), [
      { tool: 'deploy_automation', ask: 'tale:automations.deploy' },
      { tool: 'apply_settings', ask: 'tale:settings.write' },
    ]);
    expect(refusal.scope).toEqual([
      'tale:mcp',
      'tale:automations.write',
      'tale:automations.deploy',
      'tale:settings.write',
      'offline_access',
    ]);
    expect(refusal.body).toMatchObject({
      error:
        'deploy_automation ("Edit and deploy"), apply_settings ("Change settings") need access this connection does not hold. Connect the agent again and allow it.',
      data: {
        tools: ['deploy_automation', 'apply_settings'],
        requiredScopes: ['tale:automations.deploy', 'tale:settings.write'],
      },
    });
    expect(refusal.description).toBe(
      '2 tools in this request need access this connection does not hold',
    );
  });

  it('keeps offline access out of the ask when the connection never had it', () => {
    expect(
      insufficientScope(agent(['tale:mcp']), [
        { tool: 'save_automation', ask: 'tale:automations.write' },
      ]).scope,
    ).toEqual(['tale:mcp', 'tale:automations.write']);
  });

  it('asks for the first access that would do among those its role could hold, not one it could not', () => {
    // A tool several accesses open — here edit or read settings — asked of a
    // member's agent, whose role holds the second and not the first.
    const either = {
      ...tool('get_settings'),
      scopes: ['tale:automations.write', 'tale:settings.read'] as const,
    };
    const verdict = scopeVerdict(agent(READ, 'member'), either, {});
    expect(verdict).toEqual({
      kind: 'ask',
      ask: 'tale:settings.read',
      needs: ['tale:automations.write', 'tale:settings.read'],
    });
    if (verdict.kind === 'covered') throw new Error('it needs access');
    expect(scopeRefusal(either, verdict)).toMatchObject({
      error:
        'get_settings needs the "Read settings" access, which this connection does not hold',
    });
  });

  it('tells a tool call apart by whether reconnecting can help', () => {
    const save = tool('save_automation');
    expect(
      scopeRefusal(save, {
        kind: 'ask',
        ask: 'tale:automations.write',
        needs: ['tale:automations.write'],
      }),
    ).toEqual({
      error:
        'save_automation needs the "Edit" access, which this connection does not hold',
      code: 'INSUFFICIENT_SCOPE',
      hint: 'ask the person to connect the agent again and allow "Edit"; a connection holds only what its person allowed',
      data: {
        tool: 'save_automation',
        requiredScopes: ['tale:automations.write'],
      },
    });
    expect(
      scopeRefusal(save, { kind: 'role', needs: ['tale:automations.write'] }),
    ).toMatchObject({
      code: 'INSUFFICIENT_SCOPE',
      hint: 'a connection made by a person with this role cannot hold "Edit"; tell the person instead of retrying',
    });
  });
});
