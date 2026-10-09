/**
 * Resources over the wire: an address is the read a tool already answers,
 * through the same checks, so it can never show what the tool would refuse
 * — and a refusal comes back as the JSON-RPC error a client expects of a
 * resource, carrying the refusal's own code.
 *
 * Driven through `handleMcpRequest` with a hand-built caller and a stand-in
 * host, like `protocol.test.ts`.
 */

import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import {
  MCP_RESOURCE_TEMPLATES,
  MCP_STATIC_RESOURCES,
} from '../../../lib/mcp/resources';
import type { McpCaller } from './caller';
import { handleMcpRequest, type McpRequestOptions } from './protocol';
import { RESOURCES_PAGE_SIZE } from './resources';

const ORG = 'org_res_1';

function caller(role = 'member'): McpCaller {
  return {
    organizationId: ORG,
    orgSlug: 'acme',
    userId: 'user_mia',
    role,
    credential: { kind: 'api-key', apiKeyId: 'key_res_1' },
    requestId: 'req_res_1',
  };
}

type Engine = (
  caller: McpCaller,
  method: string,
  params: Record<string, unknown>,
) => Promise<unknown>;

function serve(
  engine: Engine,
  body: unknown,
  extra: Partial<McpRequestOptions> = {},
  role = 'member',
): Promise<Response> {
  const host = { engine, platform: engine, capability: engine };
  return handleMcpRequest(
    caller(role),
    new Request('https://app.example.test/api/v1/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { host, ...extra },
  );
}

async function rpc(
  engine: Engine,
  method: string,
  params?: Record<string, unknown>,
  extra: Partial<McpRequestOptions> = {},
  role = 'member',
): Promise<{
  result?: Record<string, unknown>;
  error?: { code: number; message: string; data?: Record<string, unknown> };
}> {
  const response = await serve(
    engine,
    {
      jsonrpc: '2.0',
      id: 1,
      method,
      ...(params === undefined ? {} : { params }),
    },
    extra,
    role,
  );
  expect(response.status).toBe(200);
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a JSON-RPC reply, asserted by each test
  return (await response.json()) as {
    result?: Record<string, unknown>;
    error?: { code: number; message: string; data?: Record<string, unknown> };
  };
}

/** The addresses a `resources/list` result names. */
function listedUris(result: unknown): string[] {
  const parsed = z
    .object({ resources: z.array(z.object({ uri: z.string() })) })
    .safeParse(result);
  return parsed.success ? parsed.data.resources.map((entry) => entry.uri) : [];
}

const AUTOMATION_VIEW = {
  meta: { version: 4 },
  automation: { name: 'billing/dunning', nodes: [] },
  version: 4,
  latestVersion: 4,
  deployedVersion: 3,
};

describe('resources/list', () => {
  it('lists the references and the catalog, then every automation the person can see, by name', async () => {
    const engine = vi.fn<Engine>(async (_caller, method) =>
      method === 'list_automations'
        ? {
            automations: [
              { name: 'sales/follow-up', latest: 2, deployedVersion: null },
              { name: 'billing/dunning', latest: 4, deployedVersion: 3 },
            ],
          }
        : {},
    );
    const { result } = await rpc(engine, 'resources/list');
    expect(result?.nextCursor).toBeUndefined();
    expect(result?.resources).toEqual([
      ...MCP_STATIC_RESOURCES,
      {
        uri: 'tale://automations/billing%2Fdunning',
        name: 'automations/billing/dunning',
        title: 'billing/dunning',
        description:
          'The automation billing/dunning: latest version 4, version 3 deployed.',
        mimeType: 'application/json',
      },
      {
        uri: 'tale://automations/sales%2Ffollow-up',
        name: 'automations/sales/follow-up',
        title: 'sales/follow-up',
        description:
          'The automation sales/follow-up: latest version 2, not deployed.',
        mimeType: 'application/json',
      },
    ]);
    // The list is list_automations', read as the caller.
    expect(engine).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: ORG, userId: 'user_mia' }),
      'list_automations',
      {},
    );
  });

  it('pages the automations a hundred at a time, and refuses a cursor it never issued', async () => {
    const names = Array.from(
      { length: RESOURCES_PAGE_SIZE + 5 },
      (_, index) => `ops/a${String(index).padStart(3, '0')}`,
    );
    const engine = vi.fn<Engine>(async () => ({
      automations: names.map((name) => ({ name, latest: 1 })),
    }));
    const first = await rpc(engine, 'resources/list');
    const firstAutomations = listedUris(first.result).filter((uri) =>
      uri.startsWith('tale://automations/'),
    );
    expect(firstAutomations).toHaveLength(RESOURCES_PAGE_SIZE);
    expect(typeof first.result?.nextCursor).toBe('string');
    const second = await rpc(engine, 'resources/list', {
      cursor: first.result?.nextCursor,
    });
    // The references are listed once, on the first page.
    expect(listedUris(second.result)).toEqual(
      names
        .slice(RESOURCES_PAGE_SIZE)
        .map((name) => `tale://automations/${encodeURIComponent(name)}`),
    );
    expect(second.result?.nextCursor).toBeUndefined();

    const forged = await rpc(engine, 'resources/list', { cursor: 'not-ours' });
    expect(forged.error).toMatchObject({ code: -32602 });
  });
});

describe('resources/templates/list', () => {
  it('lists the addresses a client fills in, whole', async () => {
    const engine = vi.fn<Engine>();
    expect((await rpc(engine, 'resources/templates/list')).result).toEqual({
      resourceTemplates: MCP_RESOURCE_TEMPLATES,
    });
    expect(
      (await rpc(engine, 'resources/templates/list', { cursor: 'x' })).error,
    ).toMatchObject({ code: -32602 });
    expect(engine).not.toHaveBeenCalled();
  });
});

describe('resources/read [MCP-R24]', () => {
  it('reads a reference as markdown through get_docs', async () => {
    const engine = vi.fn<Engine>(async () => ({
      docs: '# Triggers reference',
    }));
    const { result } = await rpc(engine, 'resources/read', {
      uri: 'tale://docs/triggers',
    });
    expect(result).toEqual({
      contents: [
        {
          uri: 'tale://docs/triggers',
          mimeType: 'text/markdown',
          text: '# Triggers reference',
        },
      ],
    });
    expect(engine).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: ORG }),
      'get_docs',
      { topic: 'triggers' },
    );
  });

  it('reads an automation exactly as get_automation answers it, as the caller in their organization', async () => {
    const engine = vi.fn<Engine>(async () => AUTOMATION_VIEW);
    const { result } = await rpc(engine, 'resources/read', {
      uri: 'tale://automations/billing%2Fdunning/versions/deployed',
    });
    expect(result).toEqual({
      contents: [
        {
          uri: 'tale://automations/billing%2Fdunning/versions/deployed',
          mimeType: 'application/json',
          text: JSON.stringify(AUTOMATION_VIEW),
        },
      ],
    });
    expect(engine).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: ORG, userId: 'user_mia' }),
      'get_automation',
      { name: 'billing/dunning', version: 'deployed' },
    );
  });

  it('answers an automation the person cannot see as not found, with the tool’s own code', async () => {
    // The store answers "not found" for an automation installed only in
    // projects the person cannot read (MCP-R9); the resource says the same.
    const engine = vi.fn<Engine>(async () => ({
      error: 'no saved automation named "hr/onboarding"',
      code: 'AUTOMATION_NOT_FOUND',
      hint: 'list_automations shows the saved ones',
    }));
    const { error } = await rpc(engine, 'resources/read', {
      uri: 'tale://automations/hr%2Fonboarding',
    });
    expect(error).toEqual({
      code: -32002,
      message: 'Resource not found: no saved automation named "hr/onboarding"',
      data: {
        uri: 'tale://automations/hr%2Fonboarding',
        code: 'AUTOMATION_NOT_FOUND',
        hint: 'list_automations shows the saved ones',
      },
    });
  });

  it('reads a run as get_run answers it, and a run that does not exist as not found', async () => {
    const run = { run: { runId: 'run_1', status: 'failed' } };
    const engine = vi.fn<Engine>(async (_caller, _method, params) =>
      params.runId === 'run_1'
        ? run
        : { error: 'no run "run_2"', code: 'RUN_NOT_FOUND', hint: 'x' },
    );
    expect(
      (await rpc(engine, 'resources/read', { uri: 'tale://runs/run_1' }))
        .result,
    ).toEqual({
      contents: [
        {
          uri: 'tale://runs/run_1',
          mimeType: 'application/json',
          text: JSON.stringify(run),
        },
      ],
    });
    expect(
      (await rpc(engine, 'resources/read', { uri: 'tale://runs/run_2' })).error,
    ).toMatchObject({ code: -32002, data: { code: 'RUN_NOT_FOUND' } });
  });

  it('answers an address it does not serve -32002, and one that cannot be an address -32602, reading nothing', async () => {
    const engine = vi.fn<Engine>();
    expect(
      (await rpc(engine, 'resources/read', { uri: 'tale://projects/p1' }))
        .error,
    ).toMatchObject({ code: -32002, data: { uri: 'tale://projects/p1' } });
    expect(
      (
        await rpc(engine, 'resources/read', {
          uri: 'tale://automations/a/versions/latest',
        })
      ).error,
    ).toMatchObject({ code: -32602 });
    expect(
      (await rpc(engine, 'resources/read', { uri: 7 })).error,
    ).toMatchObject({ code: -32602 });
    const long = `tale://runs/${'x'.repeat(3000)}`;
    const refused = await rpc(engine, 'resources/read', { uri: long });
    expect(refused.error).toMatchObject({ code: -32602 });
    // An address that long is never echoed back.
    expect(JSON.stringify(refused)).not.toContain('x'.repeat(100));
    expect(engine).not.toHaveBeenCalled();
  });

  it('answers a fault with the request id only, never the error', async () => {
    const reportSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const engine = vi.fn<Engine>(async () => {
        throw new Error('connection refused at 10.0.0.7');
      });
      const { error } = await rpc(engine, 'resources/read', {
        uri: 'tale://runs/run_1',
      });
      expect(error).toMatchObject({
        code: -32603,
        data: { code: 'INTERNAL_ERROR', requestId: 'req_res_1' },
      });
      expect(JSON.stringify(error)).not.toContain('10.0.0.7');
    } finally {
      reportSpy.mockRestore();
    }
  });

  it('charges a read after the first call of a batch, like a tool call [MCP-R19]', async () => {
    const engine = vi.fn<Engine>(async () => ({ docs: 'x' }));
    const admit = vi.fn<NonNullable<McpRequestOptions['admit']>>(async () => ({
      retryAfterMs: 4000,
    }));
    const response = await serve(
      engine,
      [
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'resources/read',
          params: { uri: 'tale://docs/authoring' },
        },
        {
          jsonrpc: '2.0',
          id: 2,
          method: 'resources/read',
          params: { uri: 'tale://docs/triggers' },
        },
      ],
      { admit },
    );
    const replies = (await response.json()) as Array<Record<string, unknown>>;
    expect(replies[0]).toHaveProperty('result');
    expect(replies[1]).toMatchObject({
      error: { code: -32000, data: { retryAfterMs: 4000 } },
    });
    expect(admit).toHaveBeenCalledTimes(1);
    expect(engine).toHaveBeenCalledTimes(1);
  });

  it('tells the call record how a read went', async () => {
    const observe = vi.fn<NonNullable<McpRequestOptions['observe']>>(
      async () => {},
    );
    const engine = vi.fn<Engine>(async () => ({
      error: 'no run "r"',
      code: 'RUN_NOT_FOUND',
    }));
    await rpc(engine, 'resources/read', { uri: 'tale://runs/r' }, { observe });
    expect(observe).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'resources/read',
        outcome: 'refused',
        code: '-32002',
      }),
    );
    // The record never holds the address it read.
    expect(JSON.stringify(observe.mock.calls)).not.toContain('tale://runs/r');
  });
});
