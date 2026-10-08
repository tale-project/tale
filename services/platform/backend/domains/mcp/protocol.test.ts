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
 * Authentication is deliberately out of scope here: the `/api/v1/mcp` door
 * (`backend/rest/v1-mcp.ts`, behind the REST door in `backend/rest/v1.ts`)
 * owns it and hands this layer a proven caller, so these tests drive the
 * post-auth handler with a hand-built caller and a host whose engine and
 * capability surface are stand-ins.
 */

import { describe, expect, it, vi } from 'vitest';

import { MCP_TOOLS } from '../../../lib/mcp/tools';
import type { McpCaller } from './caller';
import {
  handleMcpRequest,
  MAX_BATCH_MESSAGES,
  type McpRequestOptions,
} from './protocol';

const ORG = 'org_mcp_1';
const USER = 'user_mcp_1';
const KEY = 'key_mcp_1';

/** The caller the door proves for a key whose holder has `role`. */
function keyCaller(role = 'developer'): McpCaller {
  return {
    organizationId: ORG,
    orgSlug: 'acme',
    userId: USER,
    role,
    credential: { kind: 'api-key', apiKeyId: KEY },
  };
}

/** The handler for one key holder, whose tool calls reach `engine` and
 * `capability` — by default one stand-in for both surfaces. */
function context(
  engine = vi.fn(),
  role = 'developer',
  capability = engine,
): {
  caller: McpCaller;
  serve: (
    request: Request,
    admit?: McpRequestOptions['admit'],
  ) => Promise<Response>;
} {
  const caller = keyCaller(role);
  const host = { engine, capability };
  return {
    caller,
    serve: (request, admit) =>
      handleMcpRequest(
        caller,
        request,
        admit === undefined ? { host } : { host, admit },
      ),
  };
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
  dispatch = vi.fn(),
  role = 'developer',
): Promise<{ status: number; payload: Record<string, unknown> }> {
  const { serve } = context(dispatch, role);
  const response = await serve(rpc(body));
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
        protocolVersion: '2025-06-18',
        capabilities: { tools: { listChanged: false } },
        serverInfo: {
          name: 'tale-platform',
          title: 'Tale platform',
          version: '1.0.0',
        },
      },
    });
  });

  it('echoes a proposed revision it speaks, and answers the newest otherwise', async () => {
    const older = await call({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-03-26', capabilities: {} },
    });
    expect(older.payload.result).toMatchObject({
      protocolVersion: '2025-03-26',
    });
    const unknown = await call({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-11-25', capabilities: {} },
    });
    expect(unknown.payload.result).toMatchObject({
      protocolVersion: '2025-06-18',
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

  /** The four methods that take an automation document declare their call
   * envelope — the document itself stays an open object inside it, since
   * the engine teaches and validates its grammar in band. */
  const DOCUMENT_TOOLS = new Set([
    'validate_automation',
    'run_automation',
    'test_automation',
    'save_automation',
  ]);

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

  it('gives every tool a real schema — the document tools declare their envelope around an open document', async () => {
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

    const open = tools
      .filter((tool) => tool.inputSchema.properties === undefined)
      .map((tool) => tool.name);
    expect(open).toEqual([]);

    for (const tool of tools) {
      // A typo must fail at the client, not be dropped silently.
      expect(tool.inputSchema.additionalProperties, tool.name).toBe(false);
      if (DOCUMENT_TOOLS.has(tool.name)) {
        expect(tool.inputSchema.required, tool.name).toEqual(['automation']);
        const properties = tool.inputSchema.properties as Record<
          string,
          Record<string, unknown>
        >;
        expect(properties.automation?.type).toBe('object');
        expect(properties.automation?.properties).toBeUndefined();
      }
    }
  });

  it('refuses a document tool called without its document at the transport', async () => {
    const { payload } = await call({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'run_automation', arguments: { input: { n: 1 } } },
    });
    expect(payload.error).toMatchObject({
      code: -32602,
      message: expect.stringContaining('automation'),
    });
  });

  it('annotates every tool with the four MCP hints', async () => {
    const { payload } = await call({
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/list',
    });
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- asserted below
    const tools = (
      payload.result as {
        tools: Array<{ name: string; annotations?: Record<string, unknown> }>;
      }
    ).tools;
    for (const tool of tools) {
      expect(tool.annotations, tool.name).toEqual({
        readOnlyHint: expect.any(Boolean),
        destructiveHint: expect.any(Boolean),
        idempotentHint: expect.any(Boolean),
        openWorldHint: expect.any(Boolean),
      });
    }
    const byName = new Map(tools.map((tool) => [tool.name, tool.annotations]));
    expect(byName.get('get_run')).toMatchObject({ readOnlyHint: true });
    expect(byName.get('delete_trigger')).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
    });
    expect(byName.get('invoke_capability')).toMatchObject({
      readOnlyHint: false,
      openWorldHint: true,
    });
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
    const dispatch = vi.fn().mockResolvedValue({ automations: [] });
    const { payload } = await call(
      {
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: { name: 'list_automations', arguments: {} },
      },
      dispatch,
    );

    // The engine acts as the door's caller: the host records it as
    // `api-key:<userId>` with the key (`engine-host.test.ts`).
    expect(dispatch).toHaveBeenCalledWith(keyCaller(), 'list_automations', {});
    expect(isErrorFlag(payload)).toBe(false);
    expect(JSON.parse(resultText(payload))).toEqual({ automations: [] });
  });

  it('passes the tool arguments through as engine params', async () => {
    const dispatch = vi.fn().mockResolvedValue({ runId: 'r1', version: 2 });
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
      dispatch,
    );
    expect(dispatch).toHaveBeenCalledWith(expect.anything(), 'start_run', {
      name: 'billing/dunning',
      input: { dry: true },
    });
  });

  it('keeps a structured refusal readable and flags it isError', async () => {
    const dispatch = vi.fn().mockResolvedValue({
      error: 'durable runs are not supported in this environment',
    });
    const { status, payload } = await call(
      {
        jsonrpc: '2.0',
        id: 7,
        method: 'tools/call',
        params: { name: 'start_run', arguments: { name: 'nope' } },
      },
      dispatch,
    );
    // Still a successful JSON-RPC exchange — the refusal is the tool's
    // answer, readable by the model, and the flag says it is a failure.
    expect(status).toBe(200);
    expect(isErrorFlag(payload)).toBe(true);
    expect(resultText(payload)).toContain('not supported in this environment');
  });

  it('reads a missing resource as a failure, a failed run as data', async () => {
    const missing = await call(
      {
        jsonrpc: '2.0',
        id: 7,
        method: 'tools/call',
        params: {
          name: 'get_automation',
          arguments: { name: 'evaluation/never-created' },
        },
      },
      vi.fn().mockResolvedValue({
        error: 'no saved automation named "evaluation/never-created"',
      }),
    );
    expect(isErrorFlag(missing.payload)).toBe(true);

    // A run that failed is a run the read found: its `error` is the run's
    // detail object, not the engine's refusal string.
    const failedRun = await call(
      {
        jsonrpc: '2.0',
        id: 7,
        method: 'tools/call',
        params: { name: 'get_run', arguments: { runId: 'r-failed' } },
      },
      vi.fn().mockResolvedValue({
        runId: 'r-failed',
        status: 'failed',
        error: { message: 'node "send" threw' },
      }),
    );
    expect(isErrorFlag(failedRun.payload)).toBe(false);
  });

  it('hands a validation verdict through whole — issue locations, analysis and types — and never as a failure', async () => {
    const verdict = {
      valid: false,
      errors: [
        {
          level: 'error',
          code: 'FOREACH_NOT_ARRAY',
          nodeId: 'each',
          message: 'node "each" forEach: …',
          at: { pointer: '/nodes/1/forEach' },
          params: { node: 'each', reason: 'mixed-text', value: 'x {{ y }}' },
        },
      ],
      warnings: [],
      analysis: {
        version: 1,
        nodes: {},
        paths: {
          atoms: [],
          success: [],
          count: 1,
          halts: [],
          truncated: false,
        },
        output: { reads: [], maybeEmpty: false },
      },
      types: { inputs: {}, nodes: {}, output: { type: 'null' } },
    };
    const dispatch = vi.fn().mockResolvedValue(verdict);
    const { payload } = await call(
      {
        jsonrpc: '2.0',
        id: 9,
        method: 'tools/call',
        params: {
          name: 'validate_automation',
          arguments: { automation: { name: 'x', nodes: [] } },
        },
      },
      dispatch,
    );
    expect(isErrorFlag(payload)).toBe(false);
    expect(JSON.parse(resultText(payload))).toEqual(verdict);
  });

  it('reports a thrown call as isError with its message', async () => {
    const dispatch = vi
      .fn()
      .mockRejectedValue(new Error('Role "member" lacks the capability'));
    const { status, payload } = await call(
      {
        jsonrpc: '2.0',
        id: 8,
        method: 'tools/call',
        params: { name: 'cancel_run', arguments: { runId: 'r1' } },
      },
      dispatch,
    );
    // A tool failure is still a successful JSON-RPC exchange.
    expect(status).toBe(200);
    expect(isErrorFlag(payload)).toBe(true);
    expect(resultText(payload)).toContain('lacks the capability');
  });
});

describe('tools/call — the capability surface', () => {
  it('routes a capability tool to the capability surface as the key holder', async () => {
    const engine = vi.fn();
    const capability = vi.fn().mockResolvedValue({ capabilities: [] });
    const { serve } = context(engine, 'developer', capability);
    const response = await serve(
      rpc({
        jsonrpc: '2.0',
        id: 9,
        method: 'tools/call',
        params: {
          name: 'search_capabilities',
          arguments: { query: 'send an invoice' },
        },
      }),
    );
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- every JSON-RPC body is an object
    const payload = (await response.json()) as Record<string, unknown>;

    expect(capability).toHaveBeenCalledWith(
      keyCaller(),
      'search_capabilities',
      { query: 'send an invoice' },
    );
    expect(engine).not.toHaveBeenCalled();
    expect(isErrorFlag(payload)).toBe(false);
  });

  it.each([
    ['an unknown capability', 'No capability "automation.nope" exists here.'],
    [
      'arguments its schema rejects',
      'Input does not match the schema of "automation.billing": /count must be integer',
    ],
    ['no deployment', '"billing" has no deployed version'],
  ])('flags a capability refused for %s', async (_case, reason) => {
    const dispatch = vi.fn().mockResolvedValue({
      status: 'refused',
      id: 'automation.billing',
      reason,
      hint: 'Fix the arguments and call again.',
    });
    const { payload } = await call(
      {
        jsonrpc: '2.0',
        id: 10,
        method: 'tools/call',
        params: {
          name: 'invoke_capability',
          arguments: { id: 'automation.billing', input: {} },
        },
      },
      dispatch,
    );
    // The call did not do what it was asked — a generic client must see that
    // without parsing the reason.
    expect(isErrorFlag(payload)).toBe(true);
    expect(JSON.parse(resultText(payload))).toMatchObject({
      status: 'refused',
      reason,
    });
  });

  it('answers an unavailable knowledge base as a readable result flagged isError', async () => {
    const dispatch = vi.fn().mockResolvedValue({
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
      dispatch,
    );
    // The tool could not do its job — a generic client must not read the
    // reason as a passage list.
    expect(isErrorFlag(payload)).toBe(true);
    expect(resultText(payload)).toContain('could not be searched');
  });
});

describe('tools/call — arguments are held to the advertised schema', () => {
  const invalid = async (
    name: string,
    args: unknown,
  ): Promise<{ message: string; dispatch: ReturnType<typeof vi.fn> }> => {
    const dispatch = vi.fn();
    const { status, payload } = await call(
      {
        jsonrpc: '2.0',
        id: 20,
        method: 'tools/call',
        params: { name, arguments: args },
      },
      dispatch,
    );
    expect(status).toBe(200);
    expect(payload.error).toMatchObject({ code: -32602 });
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- asserted above
    return {
      message: (payload.error as { message: string }).message,
      dispatch,
    };
  };

  it('refuses a wrongly typed argument and runs nothing', async () => {
    const { message, dispatch } = await invalid('search_capabilities', {
      query: 42,
    });
    expect(message).toContain('arguments.query');
    expect(message).toContain('string');
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('refuses a missing required argument instead of answering an empty search', async () => {
    const { message, dispatch } = await invalid('search_capabilities', {});
    expect(message).toContain("required property 'query'");
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('refuses a value outside the declared range', async () => {
    const { message } = await invalid('list_runs', { limit: 0 });
    expect(message).toContain('arguments.limit');
    expect(message).toContain('>= 1');
  });

  // A blank string used to pass the schema and reach the engine, which
  // answered its own `INVALID_PARAMS` refusal as data — a code the MCP page
  // never promised. The schema now refuses it where a missing field is
  // refused, so no dispatch refusal for a malformed argument reaches a
  // client.
  it('refuses a blank automation name, run id or query at the transport', async () => {
    // Empty AND whitespace-only: the previous round's `minLength: 1` let a
    // whitespace `name` reach the engine ("AUTOMATION_NOT_FOUND" for a name
    // the caller never supplied) and a blank `get_knowledge` query answer
    // `passages: []` as a confident success (2026-09-14 evaluation, g9-2).
    for (const [name, args] of [
      ['get_automation', { name: '' }],
      ['get_automation', { name: '   ' }],
      ['start_run', { name: '' }],
      ['start_run', { name: 'ok', projectId: '  ' }],
      ['list_runs', { name: '' }],
      ['list_runs', { name: ' ' }],
      ['list_versions', { name: '  ' }],
      ['get_run', { runId: '' }],
      ['get_run', { runId: '   ' }],
      ['cancel_run', { runId: '' }],
      ['search_catalog', { query: '' }],
      ['search_catalog', { query: '   ' }],
      ['save_automation', { automation: { name: 'x' }, message: '  ' }],
      ['search_capabilities', { query: '' }],
      ['search_capabilities', { query: '   ' }],
      ['invoke_capability', { id: '' }],
      ['invoke_capability', { id: '  ' }],
      ['invoke_capability', { id: 'ok', credential: ' ' }],
      ['get_knowledge', { query: '' }],
      ['get_knowledge', { query: '  ' }],
    ] as const) {
      const { message, dispatch } = await invalid(name, args);
      expect(message, `${name} ${JSON.stringify(args)}`).toContain(
        'arguments.',
      );
      expect(dispatch).not.toHaveBeenCalled();
    }
  });

  it('refuses an unexpected property by name', async () => {
    const { message } = await invalid('get_run', {
      runId: 'r1',
      verbose: true,
    });
    expect(message).toContain('unexpected property "verbose"');
  });

  it('refuses arguments that are not an object', async () => {
    const { message } = await invalid('get_run', ['r1']);
    expect(message).toContain('must be an object');
  });

  it('leaves the automation DOCUMENT to the engine but holds the envelope around it', async () => {
    const dispatch = vi.fn().mockResolvedValue({ ok: true, errors: [] });
    // Inside the document anything goes: the engine validates the grammar.
    const open = await call(
      {
        jsonrpc: '2.0',
        id: 21,
        method: 'tools/call',
        params: {
          name: 'validate_automation',
          arguments: { automation: { name: 'x', nodes: [], anything: 1 } },
        },
      },
      dispatch,
    );
    expect(open.payload.error).toBeUndefined();
    expect(dispatch).toHaveBeenCalledTimes(1);

    // A stray key BESIDE the document is a typo the client hears about.
    const strict = await call(
      {
        jsonrpc: '2.0',
        id: 22,
        method: 'tools/call',
        params: {
          name: 'validate_automation',
          arguments: { automation: { name: 'x', nodes: [] }, anything: 1 },
        },
      },
      dispatch,
    );
    expect(strict.payload.error).toMatchObject({
      code: -32602,
      message: expect.stringContaining('anything'),
    });
    expect(dispatch).toHaveBeenCalledTimes(1);
  });
});

describe('tools/call — the developer gate on persistence tools', () => {
  it('refuses save_automation for a member key as data, without dispatching', async () => {
    const dispatch = vi.fn();
    const { payload } = await call(saveCall(12), dispatch, 'member');

    expect(isErrorFlag(payload)).toBe(true);
    const text = resultText(payload);
    // The refusal carries the same code the store's own role refusal does,
    // so a client branches on `code` here as on every other refusal.
    expect(JSON.parse(text)).toEqual({
      error:
        'save_automation is refused for this key: Role "member" lacks the developer-settings capability required to perform this action.',
      code: 'FORBIDDEN_DEVELOPER_SETTINGS',
      hint: 'saving, deploying and trigger binding need a key whose holder has the developer capability; every read and run tool remains available',
    });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it.each(['deploy_automation', 'set_trigger'])(
    'refuses %s for a member key as data, without dispatching',
    async (name) => {
      const dispatch = vi.fn();
      const { payload } = await call(
        {
          jsonrpc: '2.0',
          id: 16,
          method: 'tools/call',
          params: {
            name,
            arguments:
              name === 'deploy_automation'
                ? { name: 'billing/dunning', version: 1 }
                : { name: 'billing/dunning', trigger: { kind: 'webhook' } },
          },
        },
        dispatch,
        'member',
      );
      expect(isErrorFlag(payload)).toBe(true);
      expect(JSON.parse(resultText(payload))).toMatchObject({
        code: 'FORBIDDEN_DEVELOPER_SETTINGS',
      });
      expect(dispatch).not.toHaveBeenCalled();
    },
  );

  it('refuses a key whose holder is no longer a member of the organization', async () => {
    const dispatch = vi.fn();
    const { payload } = await call(saveCall(13), dispatch, 'disabled');

    expect(isErrorFlag(payload)).toBe(true);
    expect(resultText(payload)).toContain(
      'save_automation is refused for this key: Not a member of organization \\"acme\\".',
    );
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('dispatches save_automation for a developer key', async () => {
    const dispatch = vi
      .fn()
      .mockResolvedValue({ name: 'billing/dunning', version: 1 });
    const { payload } = await call(saveCall(14), dispatch, 'developer');

    expect(isErrorFlag(payload)).toBe(false);
    expect(dispatch).toHaveBeenCalledWith(
      keyCaller('developer'),
      'save_automation',
      { automation: { name: 'billing/dunning', nodes: [] } },
    );
  });

  it('leaves read tools ungated for a member key', async () => {
    const dispatch = vi.fn().mockResolvedValue({ automations: [] });
    const { payload } = await call(
      {
        jsonrpc: '2.0',
        id: 15,
        method: 'tools/call',
        params: { name: 'list_automations', arguments: {} },
      },
      dispatch,
      'member',
    );
    expect(isErrorFlag(payload)).toBe(false);
    expect(dispatch).toHaveBeenCalledWith(
      keyCaller('member'),
      'list_automations',
      {},
    );
  });
});

describe('protocol errors', () => {
  it('acknowledges a notification with 202 and no body', async () => {
    const { serve } = context();
    const response = await serve(
      rpc({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    );
    expect(response.status).toBe(202);
    expect(await response.text()).toBe('');
  });

  it('treats any message without an id as a notification — acknowledged, never answered', async () => {
    const { serve } = context();
    const response = await serve(rpc({ jsonrpc: '2.0', method: 'ping' }));
    expect(response.status).toBe(202);
    expect(await response.text()).toBe('');
  });

  // `JSON.parse` rounds a whole number beyond 2^53 − 1, so an id of
  // 9007199254740993 was echoed as …992 and a client keying replies on
  // 64-bit ids never matched one (2026-09-19 evaluation, K8-2): the literal
  // is refused as an invalid request naming it, the way the REST door does.
  it('refuses a whole number beyond 2^53 − 1 instead of rounding it (-32600)', async () => {
    const { serve } = context();
    const response = await serve(
      new Request('http://localhost/api/v1/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"jsonrpc":"2.0","id":9007199254740993,"method":"ping"}',
      }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      jsonrpc: '2.0',
      id: null,
      error: {
        code: -32600,
        message:
          'Invalid request: "id" is a whole number beyond 2^53 − 1, which cannot be carried exactly; send it as a string',
      },
    });
    const nested = await serve(
      new Request('http://localhost/api/v1/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"jsonrpc":"2.0","id":"a","method":"tools/call","params":{"name":"get_run","arguments":{"runId":18446744073709551615}}}',
      }),
    );
    expect(nested.status).toBe(400);
    expect(await nested.json()).toMatchObject({
      error: {
        code: -32600,
        message: expect.stringContaining('"params.arguments.runId"'),
      },
    });
  });

  it('refuses a jsonrpc version other than 2.0 (-32600)', async () => {
    const { status, payload } = await call({
      jsonrpc: '1.0',
      id: 7,
      method: 'ping',
    });
    expect(status).toBe(400);
    expect(payload).toMatchObject({
      jsonrpc: '2.0',
      id: 7,
      error: { code: -32600, message: expect.stringContaining('"2.0"') },
    });
  });

  it('refuses an id that is not a string or a number, and never echoes it', async () => {
    const { status, payload } = await call({
      jsonrpc: '2.0',
      id: { evaluation: 25 },
      method: 'ping',
    });
    expect(status).toBe(400);
    expect(payload.id).toBeNull();
    expect(payload.error).toMatchObject({ code: -32600 });
  });

  it('refuses an MCP-Protocol-Version it never negotiates, accepts one it does', async () => {
    const { serve } = context();
    const request = (version: string) =>
      new Request('https://app.example.test/api/v1/mcp', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'mcp-protocol-version': version,
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
      });
    const refused = await serve(request('2024-11-05'));
    expect(refused.status).toBe(400);
    // The body is read before the header is judged, so the refusal carries
    // the message's own id — a client matching replies by id used to get
    // `null` here.
    expect(await refused.json()).toMatchObject({
      id: 1,
      error: { code: -32600, message: expect.stringContaining('2024-11-05') },
    });
    const accepted = await serve(request('2025-03-26'));
    expect(accepted.status).toBe(200);
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

  it('names the allowed values when an enum argument misses them (-32602)', async () => {
    // A model reading its own error could not self-correct from "must be
    // equal to one of the allowed values" (2026-09-14 evaluation, h9).
    const { payload } = await call({
      jsonrpc: '2.0',
      id: 14,
      method: 'tools/call',
      params: {
        name: 'get_knowledge',
        arguments: { query: 'x', corpus: 'h8h9' },
      },
    });
    expect(payload.error).toMatchObject({
      code: -32602,
      message: expect.stringContaining(
        'must be one of "private", "public-web", "all", "documents", "web"',
      ),
    });
  });

  it('refuses a trigger key of another kind by name, through the kind’s own shape (-32602)', async () => {
    const { payload } = await call({
      jsonrpc: '2.0',
      id: 15,
      method: 'tools/call',
      params: {
        name: 'set_trigger',
        arguments: {
          name: 'billing/dunning',
          trigger: {
            kind: 'schedule',
            cron: '0 3 * * *',
            event: 'contact.created',
          },
        },
      },
    });
    expect(payload.error).toMatchObject({
      code: -32602,
      message: expect.stringContaining('unexpected property "event"'),
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

  it('refuses params that are neither an object nor an array (-32600)', async () => {
    for (const params of ['ping', 7, true]) {
      const { status, payload } = await call({
        jsonrpc: '2.0',
        id: 21,
        method: 'ping',
        params,
      });
      // An envelope the endpoint cannot act on answers 400, like every
      // other -32600 here; the id is still echoed.
      expect(status, JSON.stringify(params)).toBe(400);
      expect(payload.id).toBe(21);
      expect(payload.error).toMatchObject({
        code: -32600,
        message: expect.stringContaining('params must be an object'),
      });
    }
  });

  it('refuses a tools/list cursor it never issued (-32602) and answers the list whole otherwise', async () => {
    const refused = await call({
      jsonrpc: '2.0',
      id: 22,
      method: 'tools/list',
      params: { cursor: 'page-2' },
    });
    expect(refused.payload.id).toBe(22);
    expect(refused.payload.error).toMatchObject({
      code: -32602,
      message: expect.stringContaining('cursor'),
    });

    const whole = await call({
      jsonrpc: '2.0',
      id: 23,
      method: 'tools/list',
      params: {},
    });
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- asserted below
    const result = whole.payload.result as Record<string, unknown>;
    expect(result.nextCursor).toBeUndefined();
    expect(Array.isArray(result.tools)).toBe(true);
  });
});

/**
 * 2025-03-26 requires receiving JSON-RPC batches. One reply per request, in
 * order; notifications are consumed silently; an entry the envelope check
 * refuses answers inside the array without costing the others.
 */
describe('batches', () => {
  const batch = async (
    entries: unknown[],
    dispatch = vi.fn(),
  ): Promise<{ status: number; replies: unknown }> => {
    const { serve } = context(dispatch);
    const response = await serve(rpc(entries));
    return {
      status: response.status,
      replies: response.status === 202 ? undefined : await response.json(),
    };
  };

  it('answers two pings with two replies, in order', async () => {
    const { status, replies } = await batch([
      { jsonrpc: '2.0', id: 1701, method: 'ping' },
      { jsonrpc: '2.0', id: 1702, method: 'ping' },
    ]);
    expect(status).toBe(200);
    expect(replies).toEqual([
      { jsonrpc: '2.0', id: 1701, result: {} },
      { jsonrpc: '2.0', id: 1702, result: {} },
    ]);
  });

  it('acknowledges a batch of notifications alone with 202 and no body', async () => {
    const { status } = await batch([
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', method: 'notifications/cancelled', params: {} },
    ]);
    expect(status).toBe(202);
  });

  it('answers only the requests of a mixed batch', async () => {
    const { replies } = await batch([
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 'a', method: 'ping' },
    ]);
    expect(replies).toEqual([{ jsonrpc: '2.0', id: 'a', result: {} }]);
  });

  it('refuses one malformed entry without dropping the rest', async () => {
    const { status, replies } = await batch([
      { jsonrpc: '2.0', id: 1, method: 'ping' },
      { jsonrpc: '1.0', id: 2, method: 'ping' },
      'not a message',
    ]);
    expect(status).toBe(200);
    expect(replies).toEqual([
      { jsonrpc: '2.0', id: 1, result: {} },
      {
        jsonrpc: '2.0',
        id: 2,
        error: { code: -32600, message: expect.stringContaining('"2.0"') },
      },
      {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32600, message: expect.any(String) },
      },
    ]);
  });

  it('refuses an empty batch (-32600)', async () => {
    const { status, replies } = await batch([]);
    expect(status).toBe(400);
    expect(replies).toMatchObject({ error: { code: -32600 } });
  });
});

/**
 * A run tool's `status` is the run's own outcome; a run input is whatever the
 * automation's schema accepts.
 */
describe('run tools', () => {
  it.each([
    ['error', true],
    ['invalid', true],
    ['success', false],
  ])('reads a run that ended %s as isError=%s', async (status, flagged) => {
    const dispatch = vi.fn().mockResolvedValue({
      version: 2,
      status,
      output: status === 'success' ? 3 : undefined,
      ...(status === 'error'
        ? { error: { nodeId: 'sum', message: 'node "sum" threw' } }
        : {}),
      trace: [],
      effects: [],
    });
    const { payload } = await call(
      {
        jsonrpc: '2.0',
        id: 30,
        method: 'tools/call',
        params: { name: 'run_deployed', arguments: { name: 'math/sum' } },
      },
      dispatch,
    );
    expect(isErrorFlag(payload)).toBe(flagged);
  });

  /**
   * `test_automation` has two answers that look alike: `status: 'invalid'`
   * means the document could not even be tested (the call did not do its
   * job), while a report with failing tests is the verdict it was asked
   * for. Used to be: both `isError: false`.
   */
  it.each([
    [
      { status: 'invalid', errors: [{ code: 'NODES_MISSING' }], warnings: [] },
      true,
    ],
    [{ passed: 1, failed: 2, results: [] }, false],
    [{ passed: 3, failed: 0, results: [] }, false],
  ])(
    'reads a test_automation answer %j as isError=%s',
    async (answer, flagged) => {
      const dispatch = vi.fn().mockResolvedValue(answer);
      const { payload } = await call(
        {
          jsonrpc: '2.0',
          id: 31,
          method: 'tools/call',
          params: {
            name: 'test_automation',
            arguments: { automation: { name: 'math/sum', nodes: [] } },
          },
        },
        dispatch,
      );
      expect(isErrorFlag(payload)).toBe(flagged);
    },
  );

  it('lets a run input be any JSON value — the automation’s own schema judges it', async () => {
    const dispatch = vi
      .fn()
      .mockResolvedValue({ version: 1, status: 'success', output: 3 });
    const { payload } = await call(
      {
        jsonrpc: '2.0',
        id: 31,
        method: 'tools/call',
        params: {
          name: 'run_deployed',
          arguments: { name: 'math/sum', input: [1, 2] },
        },
      },
      dispatch,
    );
    expect(payload.error).toBeUndefined();
    expect(dispatch).toHaveBeenCalledWith(expect.anything(), 'run_deployed', {
      name: 'math/sum',
      input: [1, 2],
    });
    expect(isErrorFlag(payload)).toBe(false);
  });
});

describe('ids', () => {
  it('refuses a fractional id — MCP allows a string or an integer', async () => {
    const { status, payload } = await call({
      jsonrpc: '2.0',
      id: 1.5,
      method: 'ping',
    });
    expect(status).toBe(400);
    expect(payload.id).toBeNull();
    expect(payload.error).toMatchObject({ code: -32600 });
  });
});

/**
 * A batch is never cheaper than the requests it stands for: the door charged
 * the HTTP request once, and every further tool call is admitted through the
 * host's hook.
 */
describe('batch budget', () => {
  const listCall = (id: number) => ({
    jsonrpc: '2.0',
    id,
    method: 'tools/call',
    params: { name: 'list_automations', arguments: {} },
  });

  it('refuses a batch above the cap with -32600', async () => {
    const { serve } = context();
    const response = await serve(
      rpc(
        Array.from({ length: MAX_BATCH_MESSAGES + 1 }, (_, i) => ({
          jsonrpc: '2.0',
          id: i + 1,
          method: 'ping',
        })),
      ),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: -32600, message: expect.stringContaining('at most') },
    });
  });

  it('admits the first tool call on the door’s charge and asks for every further one', async () => {
    const dispatch = vi.fn().mockResolvedValue({ automations: [] });
    const admit = vi.fn().mockResolvedValue(null);
    const { serve } = context(dispatch);
    const response = await serve(
      rpc([listCall(1), listCall(2), listCall(3)]),
      admit,
    );
    const replies = (await response.json()) as Array<Record<string, unknown>>;
    expect(replies.map((reply) => reply.id)).toEqual([1, 2, 3]);
    expect(replies.every((reply) => reply.result !== undefined)).toBe(true);
    expect(admit).toHaveBeenCalledTimes(2);
    expect(dispatch).toHaveBeenCalledTimes(3);
  });

  it('answers a refused admission as -32000 for that call alone, and runs nothing for it', async () => {
    const dispatch = vi.fn().mockResolvedValue({ automations: [] });
    const admit = vi.fn().mockResolvedValue({ retryAfterMs: 1500 });
    const { serve } = context(dispatch);
    const response = await serve(rpc([listCall(1), listCall(2)]), admit);
    const replies = (await response.json()) as Array<Record<string, unknown>>;
    expect(replies[0]).toMatchObject({ id: 1, result: expect.anything() });
    expect(replies[1]).toMatchObject({
      id: 2,
      error: { code: -32000, data: { retryAfterMs: 1500 } },
    });
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it('never consults the hook for a single request — the door already charged it', async () => {
    const admit = vi.fn();
    const { serve } = context(vi.fn().mockResolvedValue({ automations: [] }));
    await serve(rpc(listCall(1)), admit);
    expect(admit).not.toHaveBeenCalled();
  });
});
