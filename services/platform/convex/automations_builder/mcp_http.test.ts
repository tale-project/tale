/**
 * The MCP endpoint's wire contract.
 *
 * What an MCP client sees IS the API: the tool inventory, the JSON-RPC error
 * codes, and — the subtle one — which failures come back as an ordinary tool
 * result and which as `isError`. A refusal the engine or the capability surface
 * returns as data is a fact the caller's model must read and act on; only a
 * thrown call is an error. So the inventory is asserted in full, name by name,
 * and both failure shapes are pinned.
 *
 * Authentication is deliberately out of scope here: `withRestAuth` owns it and
 * is covered in `convex/lib/rest/helpers.test.ts`, so these tests drive the
 * post-auth handler with a hand-built context.
 */

import { describe, expect, it, vi } from 'vitest';

import { MCP_TOOLS } from '../../lib/mcp/tools';
import { internal } from '../_generated/api';
import type { RestContext } from '../lib/rest/helpers';
import { handleMcpRequest, mcpGetNotAllowed } from './mcp_http';

// The REST helpers resolve identity through Better Auth; the handler under test
// never reaches it, but importing the module must not boot the auth stack.
vi.mock('../auth', () => ({ createAuth: vi.fn() }));

const ORG = 'org_mcp_1';
const USER = 'user_mcp_1';

function context(
  runAction = vi.fn(),
  runQuery = vi.fn(),
): {
  rc: RestContext;
  runAction: ReturnType<typeof vi.fn>;
} {
  const rc: RestContext = {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the handler only uses runAction and runQuery
    ctx: { runAction, runQuery } as unknown as RestContext['ctx'],
    user: { userId: USER, email: 'key@example.test', name: 'Key holder' },
    org: { organizationId: ORG, orgSlug: 'acme' },
  };
  return { rc, runAction };
}

function rpc(body: unknown): Request {
  return new Request('https://app.example.test/api/v1/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

async function call(
  body: unknown,
  runAction = vi.fn(),
  runQuery = vi.fn(),
): Promise<{ status: number; payload: Record<string, unknown> }> {
  const { rc } = context(runAction, runQuery);
  const response = await handleMcpRequest(rc, rpc(body));
  return {
    status: response.status,
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- every JSON-RPC body is an object
    payload: (await response.json()) as Record<string, unknown>,
  };
}

/** A tools/call request for one gated persistence tool. */
function saveCall(id: number): Record<string, unknown> {
  return {
    jsonrpc: '2.0',
    id,
    method: 'tools/call',
    params: {
      name: 'save_automation',
      arguments: { automation: { name: 'billing/dunning', nodes: [] } },
    },
  };
}

/** The text a tool result carries — the tools answer JSON, rendered as text. */
function resultText(payload: Record<string, unknown>): string {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shape asserted by the calling test
  const result = payload.result as {
    content: Array<{ type: string; text: string }>;
    isError: boolean;
  };
  return result.content[0].text;
}

function isErrorFlag(payload: Record<string, unknown>): boolean {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shape asserted by the calling test
  return (payload.result as { isError: boolean }).isError;
}

describe('initialize', () => {
  it('identifies the platform, not just the automation engine', async () => {
    const { status, payload } = await call({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
    });
    expect(status).toBe(200);
    expect(payload).toEqual({
      jsonrpc: '2.0',
      id: 1,
      result: {
        protocolVersion: '2025-03-26',
        capabilities: { tools: { listChanged: false } },
        serverInfo: {
          name: 'tale-platform',
          title: 'Tale platform',
          version: '1.0.0',
        },
      },
    });
  });

  it('answers ping with an empty result', async () => {
    const { payload } = await call({ jsonrpc: '2.0', id: 'p', method: 'ping' });
    expect(payload.result).toEqual({});
  });
});

/**
 * The inventory is the API. Asserted as an explicit list — a tool appearing or
 * disappearing has to be a deliberate edit here, not a silent consequence of a
 * change somewhere else.
 */
describe('tools/list', () => {
  const EXPECTED_TOOLS = [
    // The engine's authoring half — open schemas, taught by get_docs.
    'get_docs',
    'get_catalog',
    'search_catalog',
    'validate_automation',
    'run_automation',
    'test_automation',
    'save_automation',
    'get_automation',
    'list_automations',
    'deploy_automation',
    'set_trigger',
    'run_deployed',
    // The engine's management half — real schemas.
    'start_run',
    'list_runs',
    'get_run',
    'cancel_run',
    'list_versions',
    'list_triggers',
    'delete_trigger',
    // The platform capability tools — real schemas, a different backend.
    'search_capabilities',
    'invoke_capability',
    'get_knowledge',
  ];

  /** Everything whose params are simple enough to state on the wire. */
  const REAL_SCHEMA_TOOLS = [
    'start_run',
    'list_runs',
    'get_run',
    'cancel_run',
    'list_versions',
    'list_triggers',
    'delete_trigger',
    'search_capabilities',
    'invoke_capability',
    'get_knowledge',
  ];

  it('advertises exactly the documented tools, in order', async () => {
    const { payload } = await call({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
    });
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- asserted below
    const tools = (
      payload.result as {
        tools: Array<{
          name: string;
          description: string;
          inputSchema: Record<string, unknown>;
        }>;
      }
    ).tools;

    expect(tools.map((tool) => tool.name)).toEqual(EXPECTED_TOOLS);
    for (const tool of tools) {
      expect(tool.description, tool.name).toMatch(/\S/);
      expect(tool.inputSchema.type, tool.name).toBe('object');
    }
  });

  it('keeps the authoring methods open and gives every simple tool a real schema', async () => {
    const { payload } = await call({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/list',
    });
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- asserted below
    const tools = (
      payload.result as {
        tools: Array<{ name: string; inputSchema: Record<string, unknown> }>;
      }
    ).tools;

    const withRealSchema = tools
      .filter((tool) => tool.inputSchema.properties !== undefined)
      .map((tool) => tool.name);
    expect(withRealSchema).toEqual(REAL_SCHEMA_TOOLS);

    for (const tool of tools) {
      if (withRealSchema.includes(tool.name)) {
        // A typo must fail at the client, not be dropped silently.
        expect(tool.inputSchema.additionalProperties, tool.name).toBe(false);
      } else {
        expect(tool.inputSchema, tool.name).toEqual({ type: 'object' });
      }
    }
  });

  it('renders the same inventory the settings page renders', async () => {
    const { payload } = await call({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/list',
    });
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- asserted above
    const tools = (payload.result as { tools: Array<{ name: string }> }).tools;
    expect(tools.map((tool) => tool.name)).toEqual(
      MCP_TOOLS.map((tool) => tool.name),
    );
  });
});

describe('tools/call — the engine surface', () => {
  it('dispatches as the api key holder and returns the result as text', async () => {
    const runAction = vi.fn().mockResolvedValue({ automations: [] });
    const { payload } = await call(
      {
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: { name: 'list_automations', arguments: {} },
      },
      runAction,
    );

    expect(runAction).toHaveBeenCalledWith(
      internal.automations_builder.run_session.dispatchEngineMethod,
      {
        organizationId: ORG,
        actor: `api-key:${USER}`,
        method: 'list_automations',
        params: {},
      },
    );
    expect(isErrorFlag(payload)).toBe(false);
    expect(JSON.parse(resultText(payload))).toEqual({ automations: [] });
  });

  it('passes the tool arguments through as engine params', async () => {
    const runAction = vi.fn().mockResolvedValue({ runId: 'r1', version: 2 });
    await call(
      {
        jsonrpc: '2.0',
        id: 6,
        method: 'tools/call',
        params: {
          name: 'start_run',
          arguments: { name: 'billing/dunning', input: { dry: true } },
        },
      },
      runAction,
    );
    expect(runAction.mock.calls[0][1]).toMatchObject({
      method: 'start_run',
      params: { name: 'billing/dunning', input: { dry: true } },
    });
  });

  it('treats a structured refusal as a normal result, not an error', async () => {
    const runAction = vi.fn().mockResolvedValue({
      error: 'durable runs are not supported in this environment',
    });
    const { payload } = await call(
      {
        jsonrpc: '2.0',
        id: 7,
        method: 'tools/call',
        params: { name: 'start_run', arguments: { name: 'nope' } },
      },
      runAction,
    );
    expect(isErrorFlag(payload)).toBe(false);
    expect(resultText(payload)).toContain('not supported in this environment');
  });

  it('reports a thrown call as isError with its message', async () => {
    const runAction = vi
      .fn()
      .mockRejectedValue(new Error('Role "member" lacks the capability'));
    const { status, payload } = await call(
      {
        jsonrpc: '2.0',
        id: 8,
        method: 'tools/call',
        params: { name: 'cancel_run', arguments: { runId: 'r1' } },
      },
      runAction,
    );
    // A tool failure is still a successful JSON-RPC exchange.
    expect(status).toBe(200);
    expect(isErrorFlag(payload)).toBe(true);
    expect(resultText(payload)).toContain('lacks the capability');
  });
});

describe('tools/call — the capability surface', () => {
  it('routes a capability tool to the capability action as the key holder', async () => {
    const runAction = vi.fn().mockResolvedValue({ capabilities: [] });
    const { payload } = await call(
      {
        jsonrpc: '2.0',
        id: 9,
        method: 'tools/call',
        params: {
          name: 'search_capabilities',
          arguments: { query: 'send an invoice' },
        },
      },
      runAction,
    );

    expect(runAction).toHaveBeenCalledWith(
      internal.chat.capabilities_action.dispatchCapabilityAs,
      {
        organizationId: ORG,
        userId: USER,
        method: 'search_capabilities',
        params: { query: 'send an invoice' },
      },
    );
    expect(isErrorFlag(payload)).toBe(false);
  });

  it('passes an approval-gated invoke through as a readable result', async () => {
    const runAction = vi.fn().mockResolvedValue({
      status: 'refused',
      id: 'integration.github.create_issue',
      reason: 'This action requires approval.',
      hint: 'The organization requires a human to approve this action.',
    });
    const { payload } = await call(
      {
        jsonrpc: '2.0',
        id: 10,
        method: 'tools/call',
        params: {
          name: 'invoke_capability',
          arguments: { id: 'integration.github.create_issue', input: {} },
        },
      },
      runAction,
    );
    // Waiting for a human is an outcome, not a failure.
    expect(isErrorFlag(payload)).toBe(false);
    expect(resultText(payload)).toContain('requires approval');
  });

  it('answers an unavailable knowledge base as a result, with its reason', async () => {
    const runAction = vi.fn().mockResolvedValue({
      status: 'unavailable',
      reason: 'The knowledge base could not be searched: no embedding model.',
    });
    const { payload } = await call(
      {
        jsonrpc: '2.0',
        id: 11,
        method: 'tools/call',
        params: { name: 'get_knowledge', arguments: { query: 'refunds' } },
      },
      runAction,
    );
    expect(isErrorFlag(payload)).toBe(false);
    expect(resultText(payload)).toContain('could not be searched');
  });
});

describe('tools/call — the developer gate on persistence tools', () => {
  it('refuses save_automation for a member key as data, without dispatching', async () => {
    const runAction = vi.fn();
    const runQuery = vi.fn().mockResolvedValue('member');
    const { payload } = await call(saveCall(12), runAction, runQuery);

    expect(isErrorFlag(payload)).toBe(false);
    const text = resultText(payload);
    expect(text).toContain('save_automation is refused for this key');
    expect(text).toContain('developer');
    expect(runAction).not.toHaveBeenCalled();
  });

  it('refuses a key whose holder is not a member of the organization', async () => {
    const runAction = vi.fn();
    const runQuery = vi.fn().mockResolvedValue(null);
    const { payload } = await call(saveCall(13), runAction, runQuery);

    expect(isErrorFlag(payload)).toBe(false);
    expect(resultText(payload)).toContain('Not a member');
    expect(runAction).not.toHaveBeenCalled();
  });

  it('dispatches save_automation for a developer key', async () => {
    const runAction = vi
      .fn()
      .mockResolvedValue({ name: 'billing/dunning', version: 1 });
    const runQuery = vi.fn().mockResolvedValue('developer');
    const { payload } = await call(saveCall(14), runAction, runQuery);

    expect(isErrorFlag(payload)).toBe(false);
    expect(runAction).toHaveBeenCalledWith(
      internal.automations_builder.run_session.dispatchEngineMethod,
      expect.objectContaining({ method: 'save_automation' }),
    );
  });

  it('leaves read tools ungated — no role lookup happens', async () => {
    const runAction = vi.fn().mockResolvedValue({ automations: [] });
    const runQuery = vi.fn();
    await call(
      {
        jsonrpc: '2.0',
        id: 15,
        method: 'tools/call',
        params: { name: 'list_automations', arguments: {} },
      },
      runAction,
      runQuery,
    );
    expect(runQuery).not.toHaveBeenCalled();
  });
});

describe('protocol errors', () => {
  it('acknowledges a notification with 202 and no body', async () => {
    const { rc } = context();
    const response = await handleMcpRequest(
      rc,
      rpc({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    );
    expect(response.status).toBe(202);
    expect(await response.text()).toBe('');
  });

  it('refuses a batch (-32600)', async () => {
    const { status, payload } = await call([
      { jsonrpc: '2.0', id: 1, method: 'ping' },
    ]);
    expect(status).toBe(400);
    expect(payload.error).toMatchObject({
      code: -32600,
      message: expect.stringContaining('Batches are not supported'),
    });
  });

  it('refuses a body that is not JSON (-32700)', async () => {
    const { status, payload } = await call('not json at all');
    expect(status).toBe(400);
    expect(payload.error).toMatchObject({ code: -32700 });
  });

  it('refuses a message whose method is not a string (-32600)', async () => {
    const { payload } = await call({ jsonrpc: '2.0', id: 1, method: 7 });
    expect(payload.error).toMatchObject({ code: -32600 });
  });

  it('refuses an unknown tool (-32602)', async () => {
    const { payload } = await call({
      jsonrpc: '2.0',
      id: 12,
      method: 'tools/call',
      params: { name: 'delete_everything', arguments: {} },
    });
    expect(payload.error).toMatchObject({
      code: -32602,
      message: 'Unknown tool "delete_everything"',
    });
  });

  it('refuses a tools/call without a name (-32602)', async () => {
    const { payload } = await call({
      jsonrpc: '2.0',
      id: 13,
      method: 'tools/call',
      params: {},
    });
    expect(payload.error).toMatchObject({ code: -32602 });
  });

  it('refuses an unknown JSON-RPC method (-32601)', async () => {
    const { payload } = await call({
      jsonrpc: '2.0',
      id: 14,
      method: 'resources/list',
    });
    expect(payload.error).toMatchObject({
      code: -32601,
      message: 'Method "resources/list" is not supported',
    });
  });

  it('answers GET with 405 — there is no SSE stream here', async () => {
    const response = mcpGetNotAllowed();
    expect(response.status).toBe(405);
    await expect(response.json()).resolves.toEqual({
      error: 'Use POST with a JSON-RPC message',
    });
  });
});
