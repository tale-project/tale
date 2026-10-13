// @vitest-environment node

/**
 * A coding agent that signed in calls the endpoint with the access its
 * person allowed [MCP-R40, MCP-R41, MCP-R42]: the connection's scopes narrow
 * the person's role and never widen it, a request that needs access the
 * connection lacks runs nothing and says which to ask for, and what the call
 * leaves behind names the connection. The door that proves the connection is
 * `rest/agent-door.ts`; these tests drive the protocol layer with a
 * hand-built caller, like `protocol.test.ts`.
 */

import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { currentRequestChannel } from '../../lib/request-channel';
import type { McpCallRecord } from './activity';
import { callerOrigin, type McpCaller } from './caller';
import { handleMcpRequest, type McpRequestOptions } from './protocol';

const READ = ['tale:mcp', 'offline_access'];
const EDIT = [...READ, 'tale:automations.write'];

function agent(
  scopes: readonly string[] = READ,
  role = 'developer',
): McpCaller {
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

function key(role = 'developer'): McpCaller {
  return {
    organizationId: 'org-1',
    orgSlug: 'acme',
    userId: 'user-ada',
    role,
    credential: { kind: 'api-key', apiKeyId: 'key-1' },
  };
}

function toolCall(id: number | undefined, name: string, args: unknown = {}) {
  return {
    jsonrpc: '2.0',
    ...(id === undefined ? {} : { id }),
    method: 'tools/call',
    params: { name, arguments: args },
  };
}

const SAVE = toolCall(1, 'save_automation', {
  automation: { name: 'billing/dunning', nodes: [] },
});

function serve(
  caller: McpCaller,
  body: unknown,
  extra: Partial<McpRequestOptions> = {},
) {
  const dispatch = vi.fn().mockResolvedValue({ ok: true });
  const response = handleMcpRequest(
    caller,
    new Request('https://tale.example.test/api/v1/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    {
      host: { engine: dispatch, platform: dispatch, capability: dispatch },
      ...extra,
    },
  );
  return { response, dispatch };
}

/** What a refused request carries under `data`. */
const refusedData = z.looseObject({
  data: z.looseObject({
    tools: z.array(z.string()),
    requiredScopes: z.array(z.string()),
  }),
});

/** A reply that is a tool result: whether it is an error, and the JSON its
 * text carries (the answer, or the refusal). */
const toolReply = z
  .looseObject({
    result: z.looseObject({
      isError: z.boolean(),
      content: z.array(z.looseObject({ text: z.string() })).min(1),
    }),
  })
  .transform(({ result }) => ({
    isError: result.isError,
    text: z
      .looseObject({
        code: z.string().optional(),
        hint: z.string().optional(),
      })
      .parse(JSON.parse(result.content[0]?.text ?? 'null')),
  }));

/** A reply that is a JSON-RPC error. */
const errorReply = z.looseObject({
  error: z.looseObject({ code: z.number(), message: z.string() }),
});

const challenge: NonNullable<McpRequestOptions['scopeChallenge']> = ({
  scope,
  description,
}) =>
  `Bearer error="insufficient_scope", scope="${scope.join(' ')}", error_description="${description}"`;

describe('a request that needs access the connection lacks [MCP-R41]', () => {
  it('is refused whole with 403 and the challenge naming what to ask for, and runs nothing', async () => {
    const { response, dispatch } = serve(agent(), SAVE, {
      scopeChallenge: challenge,
    });
    const answered = await response;
    expect(answered.status).toBe(403);
    expect(answered.headers.get('www-authenticate')).toBe(
      'Bearer error="insufficient_scope", scope="tale:mcp tale:automations.write offline_access", error_description="save_automation needs the Edit access, which this connection does not hold"',
    );
    expect(await answered.json()).toEqual({
      error:
        'save_automation ("Edit") needs access this connection does not hold. Connect the agent again and allow it.',
      code: 'INSUFFICIENT_SCOPE',
      data: {
        tools: ['save_automation'],
        requiredScopes: ['tale:automations.write'],
        grantedScopes: ['offline_access', 'tale:mcp'],
      },
    });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('refuses a whole batch for one call it cannot cover: the calls it could cover do not run either', async () => {
    const { response, dispatch } = serve(agent(), [
      toolCall(1, 'get_docs'),
      toolCall(2, 'list_automations'),
      toolCall(3, 'deploy_automation', { name: 'billing/dunning' }),
    ]);
    const answered = await response;
    expect(answered.status).toBe(403);
    expect(refusedData.parse(await answered.json()).data.tools).toEqual([
      'deploy_automation',
    ]);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('answers without a challenge when the door gave none to send', async () => {
    const { response } = serve(agent(), SAVE);
    expect((await response).headers.get('www-authenticate')).toBeNull();
  });

  it('counts as a refused call of the connection, so it reads as used', async () => {
    const seen: McpCallRecord[] = [];
    const { response } = serve(agent(), SAVE, {
      observe: async (record) => {
        seen.push(record);
      },
    });
    await response;
    expect(seen).toEqual([
      {
        method: 'tools/call',
        tool: 'save_automation',
        outcome: 'refused',
        code: 'INSUFFICIENT_SCOPE',
        ms: expect.any(Number),
      },
    ]);
  });

  it('never refuses what is not a call to a tool: the handshake, the lists and a notification', async () => {
    for (const message of [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      { jsonrpc: '2.0', id: 3, method: 'ping' },
      toolCall(undefined, 'deploy_automation'),
    ]) {
      const { response } = serve(agent(), message);
      expect((await response).status, JSON.stringify(message)).not.toBe(403);
    }
  });

  it('leaves a name the endpoint does not serve to its own error', async () => {
    const { response } = serve(agent(), toolCall(1, 'no_such_tool'));
    const answered = await response;
    expect(answered.status).toBe(200);
    expect(errorReply.parse(await answered.json()).error.code).toBe(-32602);
  });

  it('never refuses a request made with an API key, whatever it calls', async () => {
    const { response, dispatch } = serve(key(), SAVE);
    expect((await response).status).toBe(200);
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it('passes a mock start on reading and testing, and asks for deploying on a live one', async () => {
    const mock = serve(
      agent(),
      toolCall(1, 'start_run', { name: 'billing/dunning', mode: 'mock' }),
    );
    const started = toolReply.parse(await (await mock.response).json());
    expect(started.isError).toBe(false);
    expect(mock.dispatch).toHaveBeenCalledTimes(1);
    const live = serve(
      agent(),
      toolCall(1, 'start_run', { name: 'billing/dunning' }),
    );
    const refused = await live.response;
    expect(refused.status).toBe(403);
    expect(refusedData.parse(await refused.json()).data.requiredScopes).toEqual(
      ['tale:automations.deploy'],
    );
    expect(live.dispatch).not.toHaveBeenCalled();
  });
});

describe('what the person allowed narrows their role and never widens it [MCP-R40]', () => {
  it('runs the call once the connection holds the access, and asks for the next level when it needs it', async () => {
    const saved = serve(agent(EDIT), SAVE);
    expect((await saved.response).status).toBe(200);
    expect(saved.dispatch).toHaveBeenCalledTimes(1);
    const deploy = serve(
      agent(EDIT),
      toolCall(2, 'deploy_automation', { name: 'billing/dunning' }),
      { scopeChallenge: challenge },
    );
    const refused = await deploy.response;
    expect(refused.status).toBe(403);
    expect(refused.headers.get('www-authenticate')).toContain(
      'scope="tale:mcp tale:automations.write tale:automations.deploy offline_access"',
    );
    expect(deploy.dispatch).not.toHaveBeenCalled();
  });

  it('judges the role first: a member’s agent that asks to save is told the role refuses, not to ask for more', async () => {
    const { response, dispatch } = serve(agent(READ, 'member'), SAVE);
    const answered = await response;
    expect(answered.status).toBe(200);
    const result = toolReply.parse(await answered.json());
    expect(result.isError).toBe(true);
    expect(result.text.code).toBe('FORBIDDEN_DEVELOPER_SETTINGS');
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('refuses, as a tool error, a call no connection of this role could hold the access for', async () => {
    const { response, dispatch } = serve(
      agent(READ, 'member'),
      toolCall(1, 'invoke_capability', { id: 'billing/dunning', input: {} }),
    );
    const answered = await response;
    expect(answered.status).toBe(200);
    const result = toolReply.parse(await answered.json());
    expect(result.isError).toBe(true);
    expect(result.text.code).toBe('INSUFFICIENT_SCOPE');
    expect(result.text.hint).toContain('cannot hold "Edit and deploy"');
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('draws nothing from the execution budget for a call refused for want of access, and one for the same call once it is covered', async () => {
    const invoke = toolCall(1, 'invoke_capability', {
      id: 'billing/dunning',
      input: {},
    });
    const refusedCharge = vi.fn().mockResolvedValue(null);
    const refused = serve(agent(READ, 'member'), invoke, {
      charge: refusedCharge,
    });
    expect((await refused.response).status).toBe(200);
    expect(refusedCharge).not.toHaveBeenCalled();
    const askedCharge = vi.fn().mockResolvedValue(null);
    const asked = serve(agent(READ), invoke, { charge: askedCharge });
    expect((await asked.response).status).toBe(403);
    expect(askedCharge).not.toHaveBeenCalled();
    const coveredCharge = vi.fn().mockResolvedValue(null);
    const covered = serve(agent([...EDIT, 'tale:automations.deploy']), invoke, {
      charge: coveredCharge,
    });
    expect((await covered.response).status).toBe(200);
    expect(coveredCharge).toHaveBeenCalledExactlyOnceWith('rest:execute');
    expect(covered.dispatch).toHaveBeenCalledTimes(1);
  });

  it('holds a read of a resource to the access of the tool behind it, since the request-wide refusal covers only calls to tools', async () => {
    const read = (scopes: readonly string[]) =>
      serve(agent(scopes), {
        jsonrpc: '2.0',
        id: 9,
        method: 'resources/read',
        params: { uri: 'tale://docs/authoring' },
      });
    const without = read(['offline_access']);
    const refused = errorReply.parse(await (await without.response).json());
    expect(refused.error).toMatchObject({
      message: expect.stringContaining('needs the "Read and test" access'),
      data: {
        uri: 'tale://docs/authoring',
        code: 'INSUFFICIENT_SCOPE',
      },
    });
    expect(without.dispatch).not.toHaveBeenCalled();
    const allowed = read(READ);
    expect(await (await allowed.response).json()).not.toHaveProperty('error');
    expect(allowed.dispatch).toHaveBeenCalledTimes(1);
  });
});

describe('what a connection’s call leaves behind names the connection [MCP-R42]', () => {
  it('opens its request channel with the connection and the app, no key', async () => {
    const seen: unknown[] = [];
    const dispatch = vi.fn(async () => {
      seen.push(currentRequestChannel());
      return { automations: [] };
    });
    await handleMcpRequest(
      { ...agent(), requestId: 'req-7' },
      new Request('https://tale.example.test/api/v1/mcp', {
        method: 'POST',
        body: JSON.stringify(toolCall(1, 'list_automations')),
      }),
      { host: { engine: dispatch, platform: dispatch, capability: dispatch } },
    );
    expect(seen).toEqual([
      {
        via: 'mcp',
        requestId: 'req-7',
        tool: 'list_automations',
        agentConnectionId: 'conn-1',
        clientName: 'Claude Code',
      },
    ]);
  });

  it('writes as the person through the MCP door, and names the app when the request names none', () => {
    expect(callerOrigin(agent())).toEqual({
      actor: 'api-key:user-ada',
      via: 'mcp',
      agentConnectionId: 'conn-1',
      clientName: 'Claude Code',
    });
    expect(callerOrigin({ ...agent(), clientName: 'Cursor' })).toMatchObject({
      clientName: 'Cursor',
    });
    expect(callerOrigin(key())).toEqual({
      actor: 'api-key:user-ada',
      via: 'mcp',
      apiKeyId: 'key-1',
    });
  });
});
