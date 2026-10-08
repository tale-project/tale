/**
 * Prompts over the wire: `prompts/list` names the ready-made requests, and
 * `prompts/get` builds one with what it is about attached — read as a
 * resource, with the caller's own rights, so a prompt never carries what
 * the person could not read themselves.
 */

import { describe, expect, it, vi } from 'vitest';

import { MCP_PROMPTS, promptListing } from '../../../lib/mcp/prompts';
import type { McpCaller } from './caller';
import { handleMcpRequest, type McpRequestOptions } from './protocol';

type Engine = (
  caller: McpCaller,
  method: string,
  params: Record<string, unknown>,
) => Promise<unknown>;

const CALLER: McpCaller = {
  organizationId: 'org_prompts_1',
  orgSlug: 'acme',
  userId: 'user_mia',
  role: 'member',
  credential: { kind: 'api-key', apiKeyId: 'key_prompts_1' },
  requestId: 'req_prompts_1',
};

async function rpc(
  engine: Engine,
  method: string,
  params?: Record<string, unknown>,
  extra: Partial<McpRequestOptions> = {},
): Promise<{
  result?: {
    prompts?: unknown[];
    description?: string;
    messages?: Array<{
      role: string;
      content: {
        type: string;
        text?: string;
        resource?: { uri: string; mimeType: string; text: string };
      };
    }>;
  };
  error?: { code: number; message: string; data?: Record<string, unknown> };
}> {
  const host = { engine, platform: engine, capability: engine };
  const response = await handleMcpRequest(
    CALLER,
    new Request('https://app.example.test/api/v1/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method,
        ...(params === undefined ? {} : { params }),
      }),
    }),
    { host, ...extra },
  );
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a JSON-RPC reply, asserted by each test
  return (await response.json()) as Awaited<ReturnType<typeof rpc>>;
}

const VIEW = { meta: { version: 4 }, automation: { name: 'billing/dunning' } };

describe('prompts/list', () => {
  it('names every prompt with its arguments, whole', async () => {
    const engine = vi.fn<Engine>();
    expect((await rpc(engine, 'prompts/list')).result).toEqual({
      prompts: MCP_PROMPTS.map(promptListing),
    });
    expect(
      (await rpc(engine, 'prompts/list', { cursor: 'x' })).error,
    ).toMatchObject({ code: -32602 });
    expect(engine).not.toHaveBeenCalled();
  });
});

describe('prompts/get [MCP-R24]', () => {
  it('attaches the automation to edit, read as the caller', async () => {
    const engine = vi.fn<Engine>(async () => VIEW);
    const { result } = await rpc(engine, 'prompts/get', {
      name: 'edit_automation',
      arguments: { name: 'billing/dunning' },
    });
    expect(result?.messages?.[0]?.content.text).toContain(
      'Work on the Tale automation "billing/dunning"',
    );
    expect(result?.messages?.[1]).toEqual({
      role: 'user',
      content: {
        type: 'resource',
        resource: {
          uri: 'tale://automations/billing%2Fdunning',
          mimeType: 'application/json',
          text: JSON.stringify(VIEW),
        },
      },
    });
    expect(engine).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org_prompts_1',
        userId: 'user_mia',
      }),
      'get_automation',
      { name: 'billing/dunning' },
    );
  });

  it('attaches nothing it cannot read, and says so, when the automation to edit is optional', async () => {
    const engine = vi.fn<Engine>(async () => ({
      error: 'no saved automation named "hr/onboarding"',
      code: 'AUTOMATION_NOT_FOUND',
    }));
    const { result } = await rpc(engine, 'prompts/get', {
      name: 'edit_automation',
      arguments: { name: 'hr/onboarding' },
    });
    expect(result?.messages).toHaveLength(1);
    expect(result?.messages?.[0]?.content.text).toContain(
      'There is no saved automation named "hr/onboarding" that I can read',
    );
  });

  it('refuses a prompt whose run the caller cannot read, with the read’s own code', async () => {
    const engine = vi.fn<Engine>(async () => ({
      error: 'no run "run_9"',
      code: 'RUN_NOT_FOUND',
      hint: 'list_runs shows them',
    }));
    const { error } = await rpc(engine, 'prompts/get', {
      name: 'debug_failed_run',
      arguments: { runId: 'run_9' },
    });
    expect(error).toMatchObject({
      code: -32602,
      data: { code: 'RUN_NOT_FOUND', uri: 'tale://runs/run_9' },
    });
  });

  it('attaches the automation and the triggers reference to add_trigger', async () => {
    const engine = vi.fn<Engine>(async (_caller, method) =>
      method === 'get_docs' ? { docs: '# Triggers reference' } : VIEW,
    );
    const { result } = await rpc(engine, 'prompts/get', {
      name: 'add_trigger',
      arguments: { name: 'billing/dunning', kind: 'schedule' },
    });
    expect(
      result?.messages
        ?.slice(1)
        .map((message) => message.content.resource?.uri),
    ).toEqual(['tale://automations/billing%2Fdunning', 'tale://docs/triggers']);
    expect(result?.messages?.[0]?.content.text).toContain('For a schedule');
    expect(result?.messages?.[0]?.content.text).not.toContain('For a webhook');
  });

  it('refuses an unknown prompt, a missing argument and an argument it does not take, reading nothing', async () => {
    const engine = vi.fn<Engine>();
    expect(
      (await rpc(engine, 'prompts/get', { name: 'connect_subscription' }))
        .error,
    ).toMatchObject({ code: -32602 });
    expect(
      (await rpc(engine, 'prompts/get', { name: 'debug_failed_run' })).error,
    ).toMatchObject({
      code: -32602,
      data: {
        code: 'INVALID_ARGUMENTS',
        issues: [expect.objectContaining({ path: 'runId' })],
      },
    });
    expect(
      (
        await rpc(engine, 'prompts/get', {
          name: 'edit_automation',
          arguments: { goal: 'make it faster' },
        })
      ).error,
    ).toMatchObject({
      code: -32602,
      data: {
        issues: [expect.objectContaining({ code: 'unrecognized_key' })],
      },
    });
    expect(
      (
        await rpc(engine, 'prompts/get', {
          name: 'edit_automation',
          arguments: 'x',
        })
      ).error,
    ).toMatchObject({ code: -32602 });
    expect(engine).not.toHaveBeenCalled();
  });

  it('is one call against a batch’s budget, however many reads it attaches', async () => {
    const engine = vi.fn<Engine>(async (_caller, method) =>
      method === 'get_docs' ? { docs: 'x' } : VIEW,
    );
    const admit = vi.fn<NonNullable<McpRequestOptions['admit']>>(
      async () => null,
    );
    await rpc(
      engine,
      'prompts/get',
      { name: 'add_trigger', arguments: { name: 'billing/dunning' } },
      { admit },
    );
    // A single request: the door charged it; no further admission.
    expect(admit).not.toHaveBeenCalled();
    expect(engine).toHaveBeenCalledTimes(2);
  });
});
