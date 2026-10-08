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

import {
  dispatch as engineDispatch,
  type DispatchStore,
} from '../../../lib/engine/api/dispatch';
import { SERVER_INSTRUCTIONS } from '../../../lib/mcp/instructions';
import { MCP_SERVER_INFO } from '../../../lib/mcp/server';
import { MCP_TOOLS } from '../../../lib/mcp/tools';
import { API_CONTRACT_VERSION } from '../../../lib/shared/constants/api-contract';
import { AppError } from '../../../lib/shared/errors/app-error';
import { currentRequestChannel } from '../../lib/request-channel';
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
  const host = { engine, platform: engine, capability };
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

/** The refusal a tool result carries as JSON text. */
function refusalOf(payload: Record<string, unknown>): {
  error: string;
  code: string;
  hint?: string;
  data?: Record<string, unknown>;
} {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shape asserted by the calling test
  return JSON.parse(resultText(payload)) as {
    error: string;
    code: string;
    hint?: string;
    data?: Record<string, unknown>;
  };
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
        protocolVersion: '2025-11-25',
        capabilities: {
          tools: { listChanged: false },
          resources: { subscribe: false, listChanged: false },
          prompts: { listChanged: false },
        },
        serverInfo: {
          name: 'tale-platform',
          title: 'Tale platform',
          version: API_CONTRACT_VERSION,
          description:
            'Edit, check, test, deploy and debug the automations of a Tale organization.',
          websiteUrl: 'https://docs.tale.dev/develop/mcp-endpoint',
        },
        instructions: SERVER_INSTRUCTIONS,
      },
    });
  });

  it('teaches the agent how to work here in its instructions', async () => {
    const { payload } = await call({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {} },
    });
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- asserted below
    const { instructions } = payload.result as { instructions: string };
    expect(instructions).toContain('validate_automation');
    expect(instructions).toContain('Ask the person before deploy_automation');
    expect(instructions.length).toBeLessThanOrEqual(2048);
  });

  it('echoes a proposed revision it speaks, and answers the newest otherwise [MCP-R16]', async () => {
    for (const version of ['2025-11-25', '2025-06-18', '2025-03-26']) {
      const spoken = await call({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: version, capabilities: {} },
      });
      expect(spoken.payload.result).toMatchObject({ protocolVersion: version });
    }
    const unknown = await call({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {} },
    });
    expect(unknown.payload.result).toMatchObject({
      protocolVersion: '2025-11-25',
    });
    // A modern revision is never negotiated: a 2026-07-28 client does not
    // initialize, so a proposal of it is answered like any other unknown.
    const modern = await call({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2026-07-28', capabilities: {} },
    });
    expect(modern.payload.result).toMatchObject({
      protocolVersion: '2025-11-25',
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
    'delete_automation',
    'set_trigger',
    'run_deployed',
    // The engine's management half — real schemas.
    'start_run',
    'list_runs',
    'get_run',
    'cancel_run',
    'answer_run_ask',
    'list_versions',
    'set_automation_projects',
    'list_triggers',
    'delete_trigger',
    // The platform's own management read.
    'get_automation_metrics',
    'list_models',
    'list_harnesses',
    'list_skills',
    'list_connectors',
    'list_agent_secrets',
    'list_projects',
    'list_events',
    // The platform capability tools — real schemas, a different backend.
    'search_capabilities',
    'invoke_capability',
    'get_knowledge',
  ];

  /** The methods that take an automation document declare their call
   * envelope — the document itself stays an open object inside it, since
   * the engine teaches and validates its grammar in band. (`test_automation`
   * takes a document OR a saved version's name, so neither is required.) */
  const DOCUMENT_TOOLS = new Set([
    'validate_automation',
    'run_automation',
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

  it('refuses a document tool called without its document, as a tool error the agent reads', async () => {
    const { payload } = await call({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'run_automation', arguments: { input: { n: 1 } } },
    });
    expect(payload.error).toBeUndefined();
    expect(isErrorFlag(payload)).toBe(true);
    expect(refusalOf(payload)).toMatchObject({
      code: 'INVALID_ARGUMENTS',
      data: {
        issues: [
          { path: 'automation', code: 'invalid_type', message: 'is required' },
        ],
      },
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

  it('runs the call in a request channel naming the door, the tool and the key, and nothing outside it', async () => {
    const seen: unknown[] = [];
    const dispatch = vi.fn(async () => {
      seen.push(currentRequestChannel());
      return { automations: [] };
    });
    const { serve, caller } = context(dispatch);
    const request = rpc({
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: { name: 'list_automations', arguments: {} },
    });
    await handleMcpRequest({ ...caller, requestId: 'req-42' }, request, {
      host: { engine: dispatch, platform: dispatch, capability: dispatch },
    });
    expect(seen).toEqual([
      {
        via: 'mcp',
        requestId: 'req-42',
        tool: 'list_automations',
        apiKeyId: KEY,
      },
    ]);
    expect(currentRequestChannel()).toBeUndefined();
    // A caller without a request id still gets one, the same for every call
    // of its request.
    await serve(
      rpc([
        {
          jsonrpc: '2.0',
          id: 6,
          method: 'tools/call',
          params: { name: 'list_automations', arguments: {} },
        },
        {
          jsonrpc: '2.0',
          id: 7,
          method: 'tools/call',
          params: { name: 'list_automations', arguments: {} },
        },
      ]),
    );
    const minted = seen.slice(1) as { requestId: string }[];
    expect(minted).toHaveLength(2);
    expect(minted[0]?.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(minted[1]?.requestId).toBe(minted[0]?.requestId);
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

  it('keeps a structured refusal readable and flags it isError [MCP-R18]', async () => {
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

  it('reads a missing resource as a failure, a failed run as data [MCP-R18]', async () => {
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

  it('keeps the code and the sentence of a refusal the surface threw [MCP-R8]', async () => {
    const thrown = Object.assign(
      new Error('The caller is not a member of this organization.'),
      { name: 'ActorAuthError', code: 'ORG_FORBIDDEN' },
    );
    const { status, payload } = await call(
      {
        jsonrpc: '2.0',
        id: 8,
        method: 'tools/call',
        params: { name: 'cancel_run', arguments: { runId: 'r1' } },
      },
      vi.fn().mockRejectedValue(thrown),
    );
    // A tool failure is still a successful JSON-RPC exchange.
    expect(status).toBe(200);
    expect(isErrorFlag(payload)).toBe(true);
    expect(refusalOf(payload)).toEqual({
      error: 'The caller is not a member of this organization.',
      code: 'ORG_FORBIDDEN',
    });
  });

  it('answers a structured refusal in its own words, never its serialized payload [MCP-R8]', async () => {
    const { payload } = await call(
      {
        jsonrpc: '2.0',
        id: 8,
        method: 'tools/call',
        params: { name: 'list_automations', arguments: {} },
      },
      vi.fn().mockRejectedValue(
        new AppError({
          code: 'PROJECT_ARCHIVED',
          message: 'The project is archived.',
          internal: 'SENTINEL-row-42',
        }),
      ),
    );
    expect(isErrorFlag(payload)).toBe(true);
    expect(refusalOf(payload)).toEqual({
      error: 'The project is archived.',
      code: 'PROJECT_ARCHIVED',
    });
    expect(resultText(payload)).not.toContain('SENTINEL');
  });

  it('answers a fault with the request id only, and reports it server-side [MCP-R8]', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fault = new Error('connect ECONNREFUSED 10.0.0.7:5432');
    const response = await handleMcpRequest(
      { ...keyCaller(), requestId: 'req-fault' },
      rpc({
        jsonrpc: '2.0',
        id: 9,
        method: 'tools/call',
        params: { name: 'get_run', arguments: { runId: 'r1' } },
      }),
      {
        host: {
          engine: vi.fn().mockRejectedValue(fault),
          platform: vi.fn(),
          capability: vi.fn(),
        },
      },
    );
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- every JSON-RPC body is an object
    const payload = (await response.json()) as Record<string, unknown>;
    expect(response.status).toBe(200);
    expect(isErrorFlag(payload)).toBe(true);
    expect(refusalOf(payload)).toEqual({
      error: 'get_run failed unexpectedly',
      code: 'INTERNAL_ERROR',
      hint: expect.stringContaining('requestId'),
      data: { requestId: 'req-fault' },
    });
    expect(resultText(payload)).not.toContain('10.0.0.7');
    expect(quiet).toHaveBeenCalledWith(
      expect.stringContaining('req-fault'),
      fault,
    );
    quiet.mockRestore();
  });

  it("answers Ada's cancel while the database is unreachable as INTERNAL_ERROR through the real dispatch, counted as a failure [MCP-R8]", async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fault = Object.assign(
      new Error(
        'connect ECONNREFUSED 10.0.0.5:5432 password authentication failed for user "tale_app"',
      ),
      { code: 'ECONNREFUSED' },
    );
    const store: DispatchStore = {
      list: async () => [],
      get: async () => null,
      deployedVersion: async () => null,
      save: async () => ({ name: 'x', version: 1 }),
      deploy: async () => ({ name: 'x', version: 1 }),
      cancelRun: async () => {
        throw fault;
      },
    };
    const recorded: unknown[] = [];
    const response = await handleMcpRequest(
      { ...keyCaller(), requestId: 'req-down' },
      rpc({
        jsonrpc: '2.0',
        id: 10,
        method: 'tools/call',
        params: { name: 'cancel_run', arguments: { runId: 'run_1' } },
      }),
      {
        host: {
          engine: async (_caller, method, params) =>
            engineDispatch(method, params, { store }),
          platform: vi.fn(),
          capability: vi.fn(),
        },
        observe: async (record) => {
          recorded.push(record);
        },
      },
    );
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- every JSON-RPC body is an object
    const payload = (await response.json()) as Record<string, unknown>;
    expect(isErrorFlag(payload)).toBe(true);
    expect(refusalOf(payload)).toEqual({
      error: 'cancel_run failed unexpectedly',
      code: 'INTERNAL_ERROR',
      hint: expect.stringContaining('requestId'),
      data: { requestId: 'req-down' },
    });
    for (const leaked of ['ECONNREFUSED', '10.0.0.5', 'tale_app']) {
      expect(JSON.stringify(payload)).not.toContain(leaked);
    }
    expect(recorded).toEqual([
      expect.objectContaining({
        method: 'tools/call',
        tool: 'cancel_run',
        outcome: 'error',
      }),
    ]);
    expect(quiet).toHaveBeenCalledWith(
      expect.stringContaining('req-down'),
      fault,
    );
    quiet.mockRestore();
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

describe('tools/call — arguments are held to the advertised schema [MCP-R7]', () => {
  interface Issue {
    path: string;
    code: string;
    message: string;
  }

  const invalid = async (
    name: string,
    args: unknown,
  ): Promise<{
    message: string;
    issues: Issue[];
    dispatch: ReturnType<typeof vi.fn>;
  }> => {
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
    expect(payload.error).toBeUndefined();
    expect(isErrorFlag(payload)).toBe(true);
    const refusal = refusalOf(payload);
    expect(refusal.code).toBe('INVALID_ARGUMENTS');
    expect(refusal.hint).toContain('tools/list');
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the refusal's documented shape
    const issues = (refusal.data as { issues: Issue[] }).issues;
    return { message: refusal.error, issues, dispatch };
  };

  it('lists every problem at once, sorted by where it is, and runs nothing', async () => {
    const { message, issues, dispatch } = await invalid('get_automation', {
      version: 'x',
      foo: 1,
    });
    expect(issues).toEqual([
      {
        path: 'foo',
        code: 'unrecognized_key',
        message: 'is not an argument this tool takes',
      },
      { path: 'name', code: 'invalid_type', message: 'is required' },
      {
        path: 'version',
        code: 'invalid_union',
        message: 'must be a saved version number (1 or more) or "deployed"',
      },
    ]);
    expect(message).toBe(
      'invalid arguments for get_automation: "foo" is not an argument this tool takes (and 2 more)',
    );
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('refuses a wrongly typed argument and runs nothing', async () => {
    const { issues, dispatch } = await invalid('search_capabilities', {
      query: 42,
    });
    expect(issues).toEqual([
      { path: 'query', code: 'invalid_type', message: 'must be a string' },
    ]);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('refuses a missing required argument instead of answering an empty search', async () => {
    const { issues, dispatch } = await invalid('search_capabilities', {});
    expect(issues).toEqual([
      { path: 'query', code: 'invalid_type', message: 'is required' },
    ]);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('refuses a value outside the declared range', async () => {
    const { issues } = await invalid('list_runs', { limit: 0 });
    expect(issues).toEqual([
      { path: 'limit', code: 'too_small', message: 'must be at least 1' },
    ]);
  });

  // A blank string used to pass the schema and reach the engine, which
  // answered its own `INVALID_PARAMS` refusal as data — a code the MCP page
  // never promised. The schema refuses it where a missing field is refused.
  it('refuses a blank automation name, run id or query before it runs', async () => {
    // Empty AND whitespace-only: the previous round's `minLength: 1` let a
    // whitespace `name` reach the engine ("AUTOMATION_NOT_FOUND" for a name
    // the caller never supplied) and a blank `get_knowledge` query answer
    // `passages: []` as a confident success (2026-09-14 evaluation, g9-2).
    for (const [name, args, field] of [
      ['get_automation', { name: '' }, 'name'],
      ['get_automation', { name: '   ' }, 'name'],
      ['start_run', { name: '' }, 'name'],
      ['start_run', { name: 'ok', projectId: '  ' }, 'projectId'],
      ['list_runs', { name: '' }, 'name'],
      ['list_runs', { name: ' ' }, 'name'],
      ['list_versions', { name: '  ' }, 'name'],
      ['get_run', { runId: '' }, 'runId'],
      ['get_run', { runId: '   ' }, 'runId'],
      ['cancel_run', { runId: '' }, 'runId'],
      ['search_catalog', { query: '' }, 'query'],
      ['search_catalog', { query: '   ' }, 'query'],
      [
        'save_automation',
        { automation: { name: 'x' }, message: '  ' },
        'message',
      ],
      ['search_capabilities', { query: '' }, 'query'],
      ['search_capabilities', { query: '   ' }, 'query'],
      ['invoke_capability', { id: '' }, 'id'],
      ['invoke_capability', { id: '  ' }, 'id'],
      ['invoke_capability', { id: 'ok', credential: ' ' }, 'credential'],
      ['get_knowledge', { query: '' }, 'query'],
      ['get_knowledge', { query: '  ' }, 'query'],
    ] as const) {
      const { issues, dispatch } = await invalid(name, args);
      expect(
        issues.map((issue) => [issue.path, issue.message]),
        `${name} ${JSON.stringify(args)}`,
      ).toContainEqual([field, 'must not be blank']);
      expect(dispatch).not.toHaveBeenCalled();
    }
  });

  it('refuses an unexpected property by name', async () => {
    const { issues } = await invalid('get_run', {
      runId: 'r1',
      verbose: true,
    });
    expect(issues).toEqual([
      {
        path: 'verbose',
        code: 'unrecognized_key',
        message: 'is not an argument this tool takes',
      },
    ]);
  });

  it('refuses arguments that are not an object', async () => {
    const { issues } = await invalid('get_run', ['r1']);
    expect(issues).toEqual([
      { path: '', code: 'invalid_type', message: 'must be an object' },
    ]);
  });

  it('never echoes an argument’s value in the refusal', async () => {
    const { message, issues } = await invalid('get_run', {
      runId: 'r1',
      apiKey: 'SENTINEL-sk-live-4b1d',
    });
    expect(JSON.stringify({ message, issues })).not.toContain('SENTINEL');
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
    expect(isErrorFlag(open.payload)).toBe(false);
    expect(dispatch).toHaveBeenCalledTimes(1);

    // A stray key BESIDE the document is a typo the client hears about.
    const strict = await invalid('validate_automation', {
      automation: { name: 'x', nodes: [] },
      anything: 1,
    });
    expect(strict.issues).toEqual([
      {
        path: 'anything',
        code: 'unrecognized_key',
        message: 'is not an argument this tool takes',
      },
    ]);
    // A document that is not an object is refused before the engine.
    const notADocument = await invalid('validate_automation', {
      automation: ['x'],
    });
    expect(notADocument.issues).toEqual([
      {
        path: 'automation',
        code: 'invalid_type',
        message: 'must be an object — the automation document',
      },
    ]);
  });

  it('names the allowed values when an enum argument misses them', async () => {
    // A model reading its own error could not self-correct from "must be
    // equal to one of the allowed values" (2026-09-14 evaluation, h9).
    const { issues } = await invalid('get_knowledge', {
      query: 'x',
      corpus: 'h8h9',
    });
    expect(issues).toEqual([
      {
        path: 'corpus',
        code: 'invalid_value',
        message:
          'must be one of "private", "public-web", "all", "documents", "web"',
      },
    ]);
  });

  it('refuses a trigger key of another kind by name, through the kind’s own shape', async () => {
    const { issues } = await invalid('set_trigger', {
      name: 'billing/dunning',
      trigger: {
        kind: 'schedule',
        cron: '0 3 * * *',
        event: 'contact.created',
      },
    });
    expect(issues).toEqual([
      {
        path: 'trigger.event',
        code: 'unrecognized_key',
        message: 'is not a field this object takes',
      },
    ]);
    const unknownKind = await invalid('set_trigger', {
      name: 'billing/dunning',
      trigger: { kind: 'hourly' },
    });
    expect(unknownKind.issues).toEqual([
      {
        path: 'trigger.kind',
        code: 'invalid_union',
        message: 'must name its kind: "schedule", "webhook" or "event"',
      },
    ]);
  });

  it('bounds the list it answers', async () => {
    const args = Object.fromEntries(
      Array.from({ length: 80 }, (_, index) => [`extra${index}`, index]),
    );
    const { issues } = await invalid('list_automations', args);
    expect(issues).toHaveLength(50);
  });
});

describe('tools/call — the developer gate on persistence tools [MCP-R17]', () => {
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
      hint: 'saving, deploying, deleting, installing, binding or removing a trigger and starting or stopping a live run need a key whose holder has the owner, admin or developer role; reading, validating, tests and mock runs (start_run with mode "mock") stay open to every member',
    });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it.each([
    ['deploy_automation', { name: 'billing/dunning', version: 1 }],
    ['set_trigger', { name: 'billing/dunning', trigger: { kind: 'webhook' } }],
    ['delete_trigger', { name: 'billing/dunning' }],
    ['run_deployed', { name: 'billing/dunning' }],
    ['start_run', { name: 'billing/dunning' }],
    ['start_run', { name: 'billing/dunning', mode: 'live' }],
    ['cancel_run', { runId: 'r1' }],
    [
      'delete_automation',
      { name: 'billing/dunning', expectedLatestVersion: 3 },
    ],
    ['set_automation_projects', { name: 'billing/dunning', add: ['p1'] }],
  ] as const)(
    'refuses %s for a member key as data, without dispatching or charging',
    async (name, args) => {
      const dispatch = vi.fn();
      const charge = vi.fn(async () => null);
      const response = await handleMcpRequest(
        keyCaller('member'),
        rpc({
          jsonrpc: '2.0',
          id: 16,
          method: 'tools/call',
          params: { name, arguments: args },
        }),
        {
          host: { engine: dispatch, platform: dispatch, capability: dispatch },
          charge,
        },
      );
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- every JSON-RPC body is an object
      const payload = (await response.json()) as Record<string, unknown>;
      expect(isErrorFlag(payload)).toBe(true);
      expect(JSON.parse(resultText(payload))).toMatchObject({
        code: 'FORBIDDEN_DEVELOPER_SETTINGS',
      });
      expect(dispatch).not.toHaveBeenCalled();
      expect(charge).not.toHaveBeenCalled();
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

  it("lets a member's mock start through, charged like any start, while a live one is refused [MCP-R4]", async () => {
    const dispatch = vi.fn().mockResolvedValue({
      runId: 'run-7',
      version: 7,
      mode: 'mock',
    });
    const charge = vi.fn(async () => null);
    const serve = (mode: 'mock' | 'live', id: number) =>
      handleMcpRequest(
        keyCaller('member'),
        rpc({
          jsonrpc: '2.0',
          id,
          method: 'tools/call',
          params: {
            name: 'start_run',
            arguments: { name: 'billing/dunning', version: 7, mode },
          },
        }),
        {
          host: { engine: dispatch, platform: dispatch, capability: dispatch },
          charge,
        },
      );
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- every JSON-RPC body is an object
    const mock = (await (await serve('mock', 21)).json()) as Record<
      string,
      unknown
    >;
    expect(isErrorFlag(mock)).toBe(false);
    expect(dispatch).toHaveBeenCalledWith(keyCaller('member'), 'start_run', {
      name: 'billing/dunning',
      version: 7,
      mode: 'mock',
    });
    expect(charge).toHaveBeenCalledWith('rest:execute');

    dispatch.mockClear();
    charge.mockClear();
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- every JSON-RPC body is an object
    const live = (await (await serve('live', 22)).json()) as Record<
      string,
      unknown
    >;
    expect(isErrorFlag(live)).toBe(true);
    expect(JSON.parse(resultText(live))).toMatchObject({
      code: 'FORBIDDEN_DEVELOPER_SETTINGS',
    });
    expect(dispatch).not.toHaveBeenCalled();
    expect(charge).not.toHaveBeenCalled();
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

describe('tools/call — the execution budget [MCP-R5]', () => {
  const callWith = async (
    name: string,
    args: Record<string, unknown>,
    charge: McpRequestOptions['charge'],
    dispatch = vi.fn().mockResolvedValue({ status: 'success', trace: [] }),
    role = 'developer',
  ) => {
    const response = await handleMcpRequest(
      keyCaller(role),
      rpc({
        jsonrpc: '2.0',
        id: 30,
        method: 'tools/call',
        params: { name, arguments: args },
      }),
      {
        host: { engine: dispatch, platform: dispatch, capability: dispatch },
        charge,
      },
    );
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- every JSON-RPC body is an object
    const payload = (await response.json()) as Record<string, unknown>;
    return { payload, dispatch };
  };

  it.each([
    ['run_automation', { automation: { name: 'x' } }],
    ['test_automation', { automation: { name: 'x' } }],
    ['deploy_automation', { name: 'billing/dunning', version: 2 }],
    ['run_deployed', { name: 'billing/dunning' }],
    ['start_run', { name: 'billing/dunning' }],
    ['invoke_capability', { id: 'automation.billing/dunning' }],
  ] as const)('%s draws one execution before it runs', async (name, args) => {
    const charge = vi.fn(async () => null);
    const { dispatch } = await callWith(name, args, charge);
    expect(charge).toHaveBeenCalledExactlyOnceWith('rest:execute');
    expect(dispatch).toHaveBeenCalledOnce();
  });

  it('refuses a start whose budget is spent as RATE_LIMITED with the wait, and runs nothing', async () => {
    const charge = vi.fn(async () => ({ retryAfterMs: 2500 }));
    const { payload, dispatch } = await callWith(
      'start_run',
      { name: 'billing/dunning' },
      charge,
    );
    expect(isErrorFlag(payload)).toBe(true);
    expect(refusalOf(payload)).toMatchObject({
      code: 'RATE_LIMITED',
      error: expect.stringContaining('retry in 3 s'),
      data: { retryAfterMs: 2500 },
    });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('draws nothing for a read, a save, refused arguments or a refused role', async () => {
    const charge = vi.fn(async () => null);
    await callWith('get_run', { runId: 'r1' }, charge);
    await callWith('list_automations', {}, charge);
    await callWith('save_automation', { automation: { name: 'x' } }, charge);
    await callWith('start_run', { name: '' }, charge);
    await callWith(
      'start_run',
      { name: 'billing/dunning' },
      charge,
      vi.fn(),
      'member',
    );
    expect(charge).not.toHaveBeenCalled();
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

  it('refuses an MCP-Protocol-Version it never negotiates, accepts one it does [MCP-R16]', async () => {
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
    // `null` here. -32022 is the code a client speaking several revisions
    // recognises and retries on, with the revisions to choose from.
    expect(await refused.json()).toEqual({
      jsonrpc: '2.0',
      id: 1,
      error: {
        code: -32022,
        message: expect.stringContaining('2024-11-05'),
        data: {
          supported: ['2026-07-28', '2025-11-25', '2025-06-18', '2025-03-26'],
          requested: '2024-11-05',
        },
      },
    });
    for (const version of ['2025-11-25', '2025-06-18', '2025-03-26']) {
      const accepted = await serve(request(version));
      expect(accepted.status, version).toBe(200);
    }
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
      method: 'completion/complete',
    });
    expect(payload.error).toMatchObject({
      code: -32601,
      message: 'Method "completion/complete" is not supported',
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
describe('batch budget [MCP-R19]', () => {
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

/**
 * The modern revision (2026-07-28) on the same endpoint: no handshake, the
 * revision and the client's capabilities in every request's `_meta`,
 * mirrored into headers a proxy can route on; one message per request; and
 * answers that say they are complete, name the server and, where a client
 * may cache, for how long.
 */
describe('the modern revision, beside the legacy ones [MCP-R26]', () => {
  const MODERN = '2026-07-28';
  const SERVER_META = { 'io.modelcontextprotocol/serverInfo': MCP_SERVER_INFO };

  /** The envelope a modern client puts in every request's `_meta`. */
  function envelope(
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      'io.modelcontextprotocol/protocolVersion': MODERN,
      'io.modelcontextprotocol/clientInfo': {
        name: 'claude-code',
        version: '2.1.294',
      },
      'io.modelcontextprotocol/clientCapabilities': {},
      ...overrides,
    };
  }

  /** One modern request with the headers the body implies, unless a test
   * overrides them (`null` leaves one out). */
  function modernRequest(
    method: string,
    params: Record<string, unknown> = {},
    headers: Record<string, string | null> = {},
    meta: Record<string, unknown> = envelope(),
  ): Request {
    const named =
      method === 'resources/read'
        ? params.uri
        : method === 'tools/call' || method === 'prompts/get'
          ? params.name
          : undefined;
    const all: Record<string, string | null> = {
      'content-type': 'application/json',
      'mcp-protocol-version': MODERN,
      'mcp-method': method,
      ...(typeof named === 'string' ? { 'mcp-name': named } : {}),
      ...headers,
    };
    return new Request('https://app.example.test/api/v1/mcp', {
      method: 'POST',
      headers: Object.fromEntries(
        Object.entries(all).filter(
          (entry): entry is [string, string] => entry[1] !== null,
        ),
      ),
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 7,
        method,
        params: { ...params, _meta: meta },
      }),
    });
  }

  async function modern(
    request: Request,
    dispatch = vi.fn(),
    options: Partial<McpRequestOptions> = {},
  ): Promise<{ status: number; payload: Record<string, unknown> }> {
    const caller = keyCaller();
    const response = await handleMcpRequest(caller, request, {
      host: { engine: dispatch, platform: dispatch, capability: dispatch },
      ...options,
    });
    return {
      status: response.status,
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- every JSON-RPC body is an object
      payload: (await response.json()) as Record<string, unknown>,
    };
  }

  it('answers server/discover with the revisions, capabilities, instructions and who it is', async () => {
    const { status, payload } = await modern(modernRequest('server/discover'));
    expect(status).toBe(200);
    expect(payload).toEqual({
      jsonrpc: '2.0',
      id: 7,
      result: {
        resultType: 'complete',
        supportedVersions: [
          '2026-07-28',
          '2025-11-25',
          '2025-06-18',
          '2025-03-26',
        ],
        capabilities: {
          tools: { listChanged: false },
          resources: { subscribe: false, listChanged: false },
          prompts: { listChanged: false },
        },
        instructions: SERVER_INSTRUCTIONS,
        _meta: SERVER_META,
        ttlMs: 3_600_000,
        cacheScope: 'private',
      },
    });
  });

  it('keeps server/discover out of the legacy revisions, and initialize and ping out of the modern one', async () => {
    const legacy = await call({
      jsonrpc: '2.0',
      id: 1,
      method: 'server/discover',
    });
    expect(legacy.status).toBe(200);
    expect(legacy.payload.error).toMatchObject({ code: -32601 });

    for (const method of ['initialize', 'ping', 'subscriptions/listen']) {
      const removed = await modern(modernRequest(method));
      expect(removed.status, method).toBe(404);
      expect(removed.payload, method).toMatchObject({
        id: 7,
        error: { code: -32601 },
      });
    }
    const initialize = await modern(modernRequest('initialize'));
    expect((initialize.payload.error as { message: string }).message).toContain(
      'server/discover',
    );
  });

  it('lists the same tools, prompts and templates, each cacheable for an hour by this key alone', async () => {
    const legacyTools = await call({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
    });
    const tools = await modern(modernRequest('tools/list'));
    expect(tools.status).toBe(200);
    expect(tools.payload.result).toEqual({
      ...(legacyTools.payload.result as Record<string, unknown>),
      resultType: 'complete',
      _meta: SERVER_META,
      ttlMs: 3_600_000,
      cacheScope: 'private',
    });
    for (const method of ['prompts/list', 'resources/templates/list']) {
      const { payload } = await modern(modernRequest(method));
      expect(payload.result, method).toMatchObject({
        resultType: 'complete',
        _meta: SERVER_META,
        ttlMs: 3_600_000,
        cacheScope: 'private',
      });
    }
  });

  it('answers a tool call as complete and names the server, with no cache hint', async () => {
    const dispatch = vi.fn().mockResolvedValue({ automations: [] });
    const { status, payload } = await modern(
      modernRequest('tools/call', { name: 'list_automations', arguments: {} }),
      dispatch,
    );
    expect(status).toBe(200);
    expect(payload.result).toEqual({
      content: [{ type: 'text', text: '{"automations":[]}' }],
      structuredContent: { automations: [] },
      isError: false,
      resultType: 'complete',
      _meta: SERVER_META,
    });
  });

  it('acts as the client the request names, so the audit rows and the saved version can name it', async () => {
    const seen: unknown[] = [];
    const dispatch = vi.fn(async () => {
      seen.push(currentRequestChannel());
      return { automations: [] };
    });
    const records: unknown[] = [];
    await modern(
      modernRequest(
        'tools/call',
        { name: 'list_automations', arguments: {} },
        {},
        envelope({
          'io.modelcontextprotocol/clientInfo': {
            name: 'Claude‮ Code',
            version: '2.1.294',
          },
        }),
      ),
      dispatch,
      {
        observe: async (record) => {
          records.push(record);
        },
      },
    );
    expect(dispatch).toHaveBeenCalledWith(
      { ...keyCaller(), clientName: 'Claude Code' },
      'list_automations',
      {},
    );
    expect(seen).toEqual([
      expect.objectContaining({ via: 'mcp', clientName: 'Claude Code' }),
    ]);
    expect(records).toEqual([
      expect.objectContaining({
        method: 'tools/call',
        tool: 'list_automations',
        outcome: 'ok',
        clientName: 'Claude Code',
      }),
    ]);
  });

  it('counts server/discover with the client name it carries', async () => {
    const records: unknown[] = [];
    await modern(modernRequest('server/discover'), vi.fn(), {
      observe: async (record) => {
        records.push(record);
      },
    });
    expect(records).toEqual([
      expect.objectContaining({
        method: 'server/discover',
        outcome: 'ok',
        clientName: 'claude-code',
      }),
    ]);
  });

  it('answers an address that reads nothing as -32602, keeping the refusal’s code', async () => {
    const dispatch = vi.fn().mockResolvedValue({
      error: 'no saved automation is named "hr/onboarding"',
      code: 'AUTOMATION_NOT_FOUND',
      hint: 'list_automations names the ones you can read',
    });
    const uri = 'tale://automations/hr%2Fonboarding';
    const { status, payload } = await modern(
      modernRequest('resources/read', { uri }),
      dispatch,
    );
    expect(status).toBe(200);
    expect(payload.error).toMatchObject({
      code: -32602,
      data: { uri, code: 'AUTOMATION_NOT_FOUND' },
    });
    // The legacy revisions keep -32002 for the same read.
    const legacy = await call(
      { jsonrpc: '2.0', id: 2, method: 'resources/read', params: { uri } },
      dispatch,
    );
    expect(legacy.payload.error).toMatchObject({ code: -32002 });
  });

  it('lets a client keep a reference for an hour, the resource list for a minute, an automation not at all', async () => {
    const dispatch = vi.fn(async (_caller: unknown, method: string) =>
      method === 'get_docs'
        ? { docs: '# Authoring' }
        : method === 'list_automations'
          ? { automations: [] }
          : { name: 'billing/dunning', version: 3 },
    );
    const docs = await modern(
      modernRequest('resources/read', { uri: 'tale://docs/authoring' }),
      dispatch,
    );
    expect(docs.payload.result).toMatchObject({
      contents: [{ uri: 'tale://docs/authoring', text: '# Authoring' }],
      resultType: 'complete',
      ttlMs: 3_600_000,
      cacheScope: 'private',
    });
    const automation = await modern(
      modernRequest('resources/read', {
        uri: 'tale://automations/billing%2Fdunning',
      }),
      dispatch,
    );
    expect(automation.payload.result).toMatchObject({
      ttlMs: 0,
      cacheScope: 'private',
    });
    const listed = await modern(modernRequest('resources/list'), dispatch);
    expect(listed.payload.result).toMatchObject({
      resultType: 'complete',
      ttlMs: 60_000,
      cacheScope: 'private',
    });
  });

  it('answers a prompt as complete, with nothing to cache', async () => {
    const dispatch = vi.fn().mockResolvedValue({ docs: '# Triggers' });
    const { payload } = await modern(
      modernRequest('prompts/get', {
        name: 'edit_automation',
        arguments: {},
      }),
      dispatch,
    );
    const result = payload.result as Record<string, unknown>;
    expect(result).toMatchObject({
      resultType: 'complete',
      _meta: SERVER_META,
    });
    expect(result.ttlMs).toBeUndefined();
    expect(result.cacheScope).toBeUndefined();
  });

  it('refuses a header that does not say what the body says with 400 and -32020, running nothing', async () => {
    const dispatch = vi.fn().mockResolvedValue({ automations: [] });
    const listing = { name: 'list_automations', arguments: {} };
    const cases: Array<[string, Request]> = [
      [
        'a revision header naming another revision',
        modernRequest('tools/call', listing, {
          'mcp-protocol-version': '2025-11-25',
        }),
      ],
      [
        'no revision header',
        modernRequest('tools/call', listing, { 'mcp-protocol-version': null }),
      ],
      [
        'no method header',
        modernRequest('tools/call', listing, { 'mcp-method': null }),
      ],
      [
        'a method header naming another method',
        modernRequest('tools/call', listing, { 'mcp-method': 'tools/list' }),
      ],
      [
        'no name header',
        modernRequest('tools/call', listing, { 'mcp-name': null }),
      ],
      [
        'a name header naming another tool',
        modernRequest('tools/call', listing, {
          'mcp-name': 'delete_automation',
        }),
      ],
      [
        'a name header that is not Base64',
        modernRequest('tools/call', listing, {
          'mcp-name': '=?base64?not base64?=',
        }),
      ],
    ];
    for (const [label, request] of cases) {
      const { status, payload } = await modern(request, dispatch);
      expect(status, label).toBe(400);
      expect(payload, label).toMatchObject({ id: 7, error: { code: -32020 } });
    }
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('reads a name header sent in Base64, the form a name a header cannot carry takes', async () => {
    const dispatch = vi.fn().mockResolvedValue({ docs: '# Authoring' });
    const uri = 'tale://docs/authoring';
    const { status } = await modern(
      modernRequest(
        'resources/read',
        { uri },
        { 'mcp-name': `=?base64?${Buffer.from(uri).toString('base64')}?=` },
      ),
      dispatch,
    );
    expect(status).toBe(200);
  });

  it('refuses a request without the envelope its revision header promises with 400 and -32602, naming what is missing', async () => {
    const request = new Request('https://app.example.test/api/v1/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'mcp-protocol-version': MODERN,
        'mcp-method': 'tools/list',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'tools/list' }),
    });
    const { status, payload } = await modern(request);
    expect(status).toBe(400);
    expect(payload).toMatchObject({
      id: 9,
      error: {
        code: -32602,
        data: {
          missing: [
            'io.modelcontextprotocol/protocolVersion',
            'io.modelcontextprotocol/clientCapabilities',
          ],
        },
      },
    });
  });

  it('refuses a revision in _meta it does not speak with 400 and -32022, listing the ones it does [MCP-R16]', async () => {
    const { status, payload } = await modern(
      modernRequest(
        'tools/list',
        {},
        { 'mcp-protocol-version': '2027-01-01' },
        envelope({ 'io.modelcontextprotocol/protocolVersion': '2027-01-01' }),
      ),
    );
    expect(status).toBe(400);
    expect(payload).toMatchObject({
      id: 7,
      error: {
        code: -32022,
        data: {
          supported: ['2026-07-28', '2025-11-25', '2025-06-18', '2025-03-26'],
          requested: '2027-01-01',
        },
      },
    });
  });

  it('refuses a batch on the modern revision, whole', async () => {
    const message = {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: { _meta: envelope() },
    };
    const dispatch = vi.fn();
    const variants: Record<string, string>[] = [
      { 'content-type': 'application/json' },
      { 'content-type': 'application/json', 'mcp-protocol-version': MODERN },
    ];
    for (const headers of variants) {
      const response = await handleMcpRequest(
        keyCaller(),
        new Request('https://app.example.test/api/v1/mcp', {
          method: 'POST',
          headers,
          body: JSON.stringify([
            { jsonrpc: '2.0', id: 0, method: 'ping' },
            message,
          ]),
        }),
        {
          host: { engine: dispatch, platform: dispatch, capability: dispatch },
        },
      );
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        id: null,
        error: { code: -32600 },
      });
    }
  });

  it('acknowledges a modern notification with 202, and never answers a session id', async () => {
    const response = await handleMcpRequest(
      keyCaller(),
      new Request('https://app.example.test/api/v1/mcp', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'mcp-protocol-version': MODERN,
          'mcp-method': 'notifications/cancelled',
          'mcp-session-id': 'a-session-from-2025',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'notifications/cancelled',
          params: { requestId: 3, _meta: envelope() },
        }),
      }),
      { host: { engine: vi.fn(), platform: vi.fn(), capability: vi.fn() } },
    );
    expect(response.status).toBe(202);
    expect(response.headers.get('mcp-session-id')).toBeNull();
  });

  it('serves a legacy and a modern client on one key, call after call', async () => {
    const dispatch = vi.fn().mockResolvedValue({ automations: [] });
    const { serve } = context(dispatch);
    const legacyInit = await serve(
      rpc({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-11-25', capabilities: {} },
      }),
    );
    const discovered = await modern(modernRequest('server/discover'), dispatch);
    const legacyCall = await serve(
      new Request('https://app.example.test/api/v1/mcp', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'mcp-protocol-version': '2025-11-25',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: { name: 'list_automations', arguments: {} },
        }),
      }),
    );
    const modernCall = await modern(
      modernRequest('tools/call', { name: 'list_automations', arguments: {} }),
      dispatch,
    );
    expect(legacyInit.status).toBe(200);
    expect(discovered.status).toBe(200);
    expect(legacyCall.status).toBe(200);
    const legacyBody = (await legacyCall.json()) as {
      result: Record<string, unknown>;
    };
    // The legacy answer stays as it was: no modern fields.
    expect(legacyBody.result.resultType).toBeUndefined();
    expect(legacyBody.result._meta).toBeUndefined();
    expect(modernCall.payload.result).toMatchObject({ resultType: 'complete' });
    expect(dispatch).toHaveBeenCalledTimes(2);
  });
});
