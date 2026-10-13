/**
 * What the tools answer, held against what they advertise.
 *
 * A client that knows a tool's `outputSchema` validates every answer against
 * it and refuses the call when one misses (the MCP SDKs do, with a draft-07
 * validator in the older ones). So every read tool is driven here through
 * the real engine dispatch over the selftest's in-memory host — the same
 * method table the platform host runs — and the capability surface's typed
 * answers, and each answer that is not a refusal must carry
 * `structuredContent` that both validators accept against the advertised
 * schema.
 */

import Ajv from 'ajv';
import Ajv2020 from 'ajv/dist/2020';
import type { Sql } from 'postgres';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type {
  CapabilitySearchHit,
  KnowledgeResult,
} from '../../../lib/chat/capabilities';
import { dispatch, type DispatchStore } from '../../../lib/engine/api/dispatch';
import { DOC_EXAMPLE } from '../../../lib/engine/api/docs';
import { setCodeRunner } from '../../../lib/engine/core/slots';
import type { Automation, RunResult } from '../../../lib/engine/core/types';
import { nodeVmRunner } from '../../../lib/engine/runners/node-vm';
import { memoryStore } from '../../../lib/engine/selftest/memory-store';
import {
  findMcpTool,
  MCP_TOOLS,
  type McpToolSpec,
} from '../../../lib/mcp/tools';
import type { McpCaller } from './caller';
import { dispatchPlatformTool } from './platform-tools';
import { callTool, listTools, type McpHost } from './tools';

/** A database with no rows: the platform tools answer an organization that
 * has run nothing yet. */
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double: every query answers no rows
const emptySql = Object.assign(() => Promise.resolve([]), {
  unsafe: (text: string) => text,
}) as unknown as Sql;

// The model listing walks the organization's provider catalogs; here an
// organization with no provider serves no model.
vi.mock('../chat/composer.ts', async (original) => ({
  ...(await original<typeof import('../chat/composer.ts')>()),
  listGovernedChatModels: async () => [],
}));

const caller: McpCaller = {
  organizationId: 'org_1',
  orgSlug: 'acme',
  userId: 'user_ada',
  role: 'developer',
  credential: { kind: 'api-key', apiKeyId: 'key_1' },
};

/** The selftest's versioned in-memory host, which records runs and
 * triggers, so the management reads answer from real state. */
function referenceStore(): DispatchStore {
  const mem = memoryStore();
  return {
    list: () => mem.list(),
    get: (name, version) => mem.get(name, version),
    deployedVersion: (name) => mem.deployedVersion(name),
    async save(automation: Automation, message?: string) {
      const { version } = mem.save(automation.name, automation, message);
      return { name: automation.name, version };
    },
    async deploy(name: string, version: number) {
      mem.deploy(name, version);
      return { name, version };
    },
    setTrigger: (name, trigger) => mem.setTrigger(name, trigger),
    recordRun: (name, version, result: RunResult, mode) =>
      mem.recordRun(name, version, result, mode),
    startRun: (name, input, mode, version) =>
      mem.startRun(name, input, mode, version),
    listRuns: (options) => mem.listRuns(options),
    getRun: (runId) => mem.getRun(runId),
    getRunRecord: (runId, options) => mem.getRunRecord(runId, options),
    getRunNode: (runId, unit) => mem.getRunNode(runId, unit),
    compareRuns: (runId, otherRunId) => mem.compareRuns(runId, otherRunId),
    cancelRun: (runId) => mem.cancelRun(runId),
    listVersions: (name) => mem.listVersions(name),
    listTriggers: (name) => mem.listTriggers(name),
    deleteTrigger: (name) => mem.deleteTrigger(name),
  };
}

const searchHit: CapabilitySearchHit = {
  id: 'automation.order-report',
  kind: 'automation',
  name: 'order-report',
  description: 'Totals the orders above a minimum.',
  structured: true,
};

const knowledge: KnowledgeResult = {
  status: 'ok',
  passages: [
    {
      text: 'Refunds are paid within 14 days.',
      source: 'Refund policy',
      ref: 'file_1',
      documentId: 'doc_1',
      corpus: 'documents',
      chunkIndex: 0,
      score: 0.03,
    },
  ],
};

let host: McpHost;
let runId = '';

beforeAll(async () => {
  setCodeRunner(nodeVmRunner());
  const store = referenceStore();
  const engine = (method: string, params: Record<string, unknown>) =>
    dispatch(method, params, { store });
  await engine('save_automation', {
    automation: DOC_EXAMPLE.automation,
    message: 'first cut',
  });
  await engine('deploy_automation', { name: 'order-report', version: 1 });
  await engine('set_trigger', {
    name: 'order-report',
    trigger: { kind: 'schedule', cron: '0 6 * * *', timezone: 'UTC' },
  });
  const started = await engine('start_run', {
    name: 'order-report',
    input: DOC_EXAMPLE.input,
  });
  runId = (started as { runId: string }).runId;
  host = {
    engine: (_caller, method, params) => engine(method, params),
    platform: (toolCaller, method, params) =>
      dispatchPlatformTool(emptySql, toolCaller, method, params),
    capability: async (_caller, method) =>
      method === 'search_capabilities'
        ? { capabilities: [searchHit] }
        : knowledge,
  };
});

/** Stands for the run `beforeAll` starts. */
const STARTED_RUN = '<the started run>';

/** Realistic arguments for every read tool. */
function readCalls(): Array<[string, Record<string, unknown>]> {
  return [
    ['get_docs', {}],
    ['get_catalog', {}],
    ['get_catalog', { compact: true }],
    ['get_catalog', { kind: 'llm' }],
    ['search_catalog', { query: 'send email' }],
    ['validate_automation', { automation: DOC_EXAMPLE.automation }],
    ['get_automation', { name: 'order-report' }],
    ['get_automation', { name: 'order-report', version: 'deployed' }],
    ['list_automations', {}],
    ['list_runs', {}],
    ['list_runs', { name: 'order-report', limit: 5 }],
    ['list_runs', { mode: 'mock', statuses: ['success', 'failed'] }],
    // The run is started in `beforeAll`, after the table is built.
    ['get_run', { runId: STARTED_RUN }],
    ['get_run', { runId: STARTED_RUN, include: ['record', 'travels'] }],
    ['get_run_node', { runId: STARTED_RUN, node: '__start' }],
    ['compare_runs', { a: STARTED_RUN, b: STARTED_RUN }],
    ['list_versions', { name: 'order-report' }],
    ['list_triggers', {}],
    ['get_automation_metrics', {}],
    ['get_automation_metrics', { periodDays: 30, mode: 'mock' }],
    ['validate_automation', { automation: DOC_EXAMPLE.automation, detail: [] }],
    ['list_models', {}],
    ['list_models', { nodeType: 'agent', harness: 'codex' }],
    ['list_harnesses', {}],
    ['list_skills', {}],
    ['list_connectors', { query: 'mail' }],
    ['list_agent_secrets', {}],
    ['list_projects', { includeArchived: true }],
    ['list_events', {}],
    ['get_settings', {}],
    ['get_settings', { kinds: ['governance'], ids: ['password_policy'] }],
    [
      'plan_settings',
      {
        changes: [
          { kind: 'branding', op: 'set', config: { accentColor: '#336699' } },
        ],
      },
    ],
    ['search_capabilities', { query: 'orders' }],
    ['get_knowledge', { query: 'refunds' }],
  ];
}

describe('read tools answer what they advertise', () => {
  const draft07 = new Ajv({ strict: false });
  const draft2020 = new Ajv2020({ strict: false });

  it('covers every read tool', () => {
    const called = new Set(readCalls().map(([name]) => name));
    expect(
      MCP_TOOLS.filter((tool) => tool.result !== null).map((tool) => tool.name),
    ).toEqual(
      [...new Set(MCP_TOOLS.map((tool) => tool.name))].filter((name) =>
        called.has(name),
      ),
    );
  });

  it.each(readCalls())(
    '%s %j answers structured content its outputSchema accepts',
    async (name, args) => {
      const error = vi.spyOn(console, 'error');
      const tool = findMcpTool(name);
      if (tool === undefined) throw new Error(`no tool ${name}`);
      const reply = await callTool(
        caller,
        tool,
        Object.fromEntries(
          Object.entries(args).map(([key, value]) => [
            key,
            value === STARTED_RUN ? runId : value,
          ]),
        ),
        { host, requestId: 'req-1' },
      );
      if (reply.kind !== 'answer') throw new Error('not admitted');
      const { result } = reply.answer;
      expect(result.isError, result.content[0]?.text.slice(0, 200)).toBe(false);
      const text = result.content[0]?.text ?? '';
      expect(result.structuredContent).toEqual(JSON.parse(text));
      const listing = listTools().find((entry) => entry.name === name);
      const schema = listing?.outputSchema ?? {};
      for (const validator of [draft07, draft2020]) {
        const validate = validator.compile(schema);
        expect(
          validate(result.structuredContent),
          JSON.stringify(validate.errors),
        ).toBe(true);
      }
      // The off-production check agrees: nothing was reported.
      expect(error).not.toHaveBeenCalled();
      error.mockRestore();
    },
  );

  it('answers compact JSON text, one block', async () => {
    const tool = findMcpTool('list_automations');
    if (tool === undefined) throw new Error('no tool');
    const reply = await callTool(caller, tool, {}, { host, requestId: 'r' });
    if (reply.kind !== 'answer') throw new Error('not admitted');
    expect(reply.answer.result.content).toHaveLength(1);
    expect(reply.answer.result.content[0]?.text).not.toContain('\n');
  });

  it('carries no structured content on a refusal or for a tool that is not a read', async () => {
    const missing = findMcpTool('get_automation');
    const run = findMcpTool('run_automation');
    if (missing === undefined || run === undefined) throw new Error('no tool');
    const refused = await callTool(
      caller,
      missing,
      { name: 'never-saved' },
      { host, requestId: 'r' },
    );
    const ran = await callTool(
      caller,
      run,
      { automation: DOC_EXAMPLE.automation, input: DOC_EXAMPLE.input },
      { host, requestId: 'r' },
    );
    if (refused.kind !== 'answer' || ran.kind !== 'answer') {
      throw new Error('not admitted');
    }
    expect(refused.answer.result.isError).toBe(true);
    expect(refused.answer.result.structuredContent).toBeUndefined();
    expect(ran.answer.result.isError).toBe(false);
    expect(ran.answer.result.structuredContent).toBeUndefined();
  });
});

describe('tools/list', () => {
  it('advertises an outputSchema for exactly the read tools, and the client hints in _meta', () => {
    const listed = listTools();
    for (const entry of listed) {
      const tool = findMcpTool(entry.name);
      expect(entry.outputSchema === undefined, entry.name).toBe(
        tool?.result === null,
      );
    }
    const meta = Object.fromEntries(
      listed
        .filter((entry) => entry._meta !== undefined)
        .map((entry) => [entry.name, entry._meta]),
    );
    expect(meta).toEqual({
      get_docs: { 'anthropic/maxResultSizeChars': 100_000 },
      get_catalog: { 'anthropic/maxResultSizeChars': 250_000 },
      validate_automation: { 'anthropic/maxResultSizeChars': 200_000 },
      run_automation: { 'anthropic/maxResultSizeChars': 200_000 },
      test_automation: { 'anthropic/maxResultSizeChars': 500_000 },
      get_automation: { 'anthropic/maxResultSizeChars': 200_000 },
      deploy_automation: { 'anthropic/requiresUserInteraction': true },
      delete_automation: { 'anthropic/requiresUserInteraction': true },
      set_trigger: { 'anthropic/requiresUserInteraction': true },
      answer_run_ask: { 'anthropic/requiresUserInteraction': true },
      set_automation_projects: { 'anthropic/requiresUserInteraction': true },
      run_deployed: { 'anthropic/maxResultSizeChars': 200_000 },
      get_run: { 'anthropic/maxResultSizeChars': 500_000 },
      get_run_node: { 'anthropic/maxResultSizeChars': 300_000 },
      compare_runs: { 'anthropic/maxResultSizeChars': 500_000 },
      get_settings: { 'anthropic/maxResultSizeChars': 250_000 },
      apply_settings: { 'anthropic/requiresUserInteraction': true },
    });
  });
});

/**
 * A write a tool call makes, however deep in a domain, runs inside the
 * call's request channel: every audit row it writes says the door, the
 * tool, the key and the client (`createAuditLog` merges the channel before
 * hashing; the definition writers audit every save, deploy, delete,
 * trigger and installation in the store).
 */
describe('a write over MCP names the coding agent', () => {
  it("Ada's agent saves through Claude Code with her laptop key: the write runs in a channel naming all four [MCP-R14]", async () => {
    const { currentRequestChannel } = await import('../../lib/request-channel');
    const seen: unknown[] = [];
    const tool = findMcpTool('save_automation');
    if (tool === undefined) throw new Error('no tool');
    const reply = await callTool(
      { ...caller, clientName: 'Claude Code' },
      tool,
      { automation: DOC_EXAMPLE.automation },
      {
        host: {
          ...host,
          engine: async () => {
            seen.push(currentRequestChannel());
            return { name: 'order-report', version: 3 };
          },
        },
        requestId: 'req-7',
      },
    );
    if (reply.kind !== 'answer') throw new Error('not admitted');
    expect(reply.answer.result.isError).toBe(false);
    expect(seen).toEqual([
      {
        via: 'mcp',
        requestId: 'req-7',
        tool: 'save_automation',
        apiKeyId: 'key_1',
        clientName: 'Claude Code',
      },
    ]);
  });
});

/**
 * The settings tools at the door: a change draws from its own budget once
 * its arguments pass, reading and planning draw from none, and what a kind
 * does not take is refused with every other problem before anything runs.
 */
describe('settings over MCP', () => {
  const apply = findMcpTool('apply_settings');
  const plan = findMcpTool('plan_settings');
  const get = findMcpTool('get_settings');
  if (apply === undefined || plan === undefined || get === undefined) {
    throw new Error('no settings tools');
  }
  const change = {
    changes: [
      { kind: 'branding', op: 'set', config: { accentColor: '#000000' } },
    ],
    expected: { branding: null },
  };

  it('draws one settings change from the key holder’s settings budget', async () => {
    const charged: string[] = [];
    const reply = await callTool(caller, apply, change, {
      host,
      requestId: 'r',
      charge: async (lane) => {
        charged.push(lane);
        return null;
      },
    });
    if (reply.kind !== 'answer') throw new Error('not admitted');
    expect(charged).toEqual(['rest:settings']);
  });

  it('refuses a change once that budget is spent, and runs nothing', async () => {
    const platform = vi.fn(host.platform);
    const reply = await callTool(caller, apply, change, {
      host: { ...host, platform },
      requestId: 'r',
      charge: async () => ({ retryAfterMs: 1500 }),
    });
    if (reply.kind !== 'answer') throw new Error('not admitted');
    expect(reply.answer.result.isError).toBe(true);
    expect(JSON.parse(reply.answer.result.content[0]?.text ?? '{}')).toEqual({
      error:
        'apply_settings is refused for now: this key holder has changed settings as often as a minute allows; retry in 2 s',
      code: 'RATE_LIMITED',
      hint: expect.stringContaining('plan_settings'),
      data: { retryAfterMs: 1500 },
    });
    expect(platform).not.toHaveBeenCalled();
  });

  it('charges nothing to read or plan', async () => {
    const charge = vi.fn(async () => null);
    for (const [tool, args] of [
      [get, {}],
      [plan, { changes: change.changes }],
    ] as const) {
      const reply = await callTool(caller, tool, args, {
        host,
        requestId: 'r',
        charge,
      });
      if (reply.kind !== 'answer') throw new Error('not admitted');
    }
    expect(charge).not.toHaveBeenCalled();
  });

  it('refuses what a kind does not take with every other problem, before anything runs', async () => {
    const platform = vi.fn(host.platform);
    const reply = await callTool(
      caller,
      plan,
      {
        changes: [
          { kind: 'governance', id: 'budgets', op: 'delete' },
          { kind: 'branding', op: 'act', act: 'reset' },
          { kind: 'provider', id: 'vendor', op: 'set' },
          { kind: 'provider', id: 'vendor', op: 'act', act: 'rename' },
          { kind: 'files', op: 'set', config: {} },
          { kind: 'automation-approval', id: 'digest', op: 'delete' },
          {
            kind: 'automation-approval',
            id: 'digest',
            op: 'set',
            config: {},
          },
        ],
      },
      { host: { ...host, platform }, requestId: 'r' },
    );
    if (reply.kind !== 'answer') throw new Error('not admitted');
    const answer = JSON.parse(reply.answer.result.content[0]?.text ?? '{}');
    expect(answer.code).toBe('INVALID_ARGUMENTS');
    expect(
      answer.data.issues.map(
        (issue: { path: string; code: string }) =>
          `${issue.path} ${issue.code}`,
      ),
    ).toEqual([
      'changes.0.op op_not_supported',
      'changes.1.op op_not_supported',
      'changes.2.config required',
      'changes.3.act act_unknown',
      'changes.4.kind invalid_value',
      'changes.5.op op_not_supported',
      'changes.6.op op_not_supported',
    ]);
    expect(platform).not.toHaveBeenCalled();
  });

  it('refuses an id Postgres could not store, naming where it is', async () => {
    const platform = vi.fn(host.platform);
    const reply = await callTool(
      caller,
      get,
      { kinds: ['task-instructions'], ids: ['p1/t\u0000', 'p1/t\ud800'] },
      { host: { ...host, platform }, requestId: 'r' },
    );
    if (reply.kind !== 'answer') throw new Error('not admitted');
    const answer = JSON.parse(reply.answer.result.content[0]?.text ?? '{}');
    expect(answer.code).toBe('INVALID_ARGUMENTS');
    expect(answer.data.issues).toEqual([
      {
        path: 'ids.0',
        code: 'unstorable_text',
        message: 'must not contain a NUL character (U+0000)',
      },
      {
        path: 'ids.1',
        code: 'unstorable_text',
        message:
          'must not contain an unpaired UTF-16 surrogate (U+D800–U+DFFF), which cannot be stored',
      },
    ]);
    expect(platform).not.toHaveBeenCalled();
  });

  it('reads one kind’s pages or ids only, never several kinds’ at once', async () => {
    const reply = await callTool(
      caller,
      get,
      { kinds: ['governance', 'branding'], ids: ['budgets'] },
      { host, requestId: 'r' },
    );
    if (reply.kind !== 'answer') throw new Error('not admitted');
    const answer = JSON.parse(reply.answer.result.content[0]?.text ?? '{}');
    expect(answer.data.issues).toEqual([
      {
        path: 'kinds',
        code: 'one_kind',
        message: 'must name exactly one kind when ids or cursor is given',
      },
    ]);
  });
});

/**
 * A run on stand-ins and a suite run by name, at the door and against the
 * real engine: what the calls take, what they answer, what they refuse and
 * what they draw from the organization's budget for runs that are never
 * stored. [MCP-R33] [MCP-R34]
 */
describe('stand-ins and tests picked by name over MCP', () => {
  const run = findMcpTool('run_automation');
  const test = findMcpTool('test_automation');
  if (run === undefined || test === undefined) throw new Error('no tools');

  /** What a call answers, parsed. */
  async function answer(
    tool: McpToolSpec,
    args: Record<string, unknown>,
    options: { host?: McpHost } = {},
    // oxlint-disable-next-line typescript/no-explicit-any -- a parsed answer the test probes by path
  ): Promise<{ isError: boolean; body: Record<string, any> }> {
    const reply = await callTool(caller, tool, args, {
      host: options.host ?? host,
      requestId: 'r',
    });
    if (reply.kind !== 'answer') throw new Error('not admitted');
    return {
      isError: reply.answer.result.isError,
      body: JSON.parse(reply.answer.result.content[0]?.text ?? '{}'),
    };
  }

  const ORDERS = { min_total: 100, orders: [{ total: 250 }, { total: 40 }] };
  const NOBODY = { min_total: 1000, orders: [{ total: 250 }] };
  const WITH_TESTS = {
    ...DOC_EXAMPLE.automation,
    tests: [
      ...(DOC_EXAMPLE.automation.tests ?? []),
      {
        name: 'one big order',
        input: ORDERS,
        mocks: { summary: { text: 'One big order.' } },
        expect: {
          output: {
            stats: { count: 1, sum: 250 },
            message: 'One big order.',
          },
        },
      },
      {
        name: 'wrong on purpose',
        input: ORDERS,
        mocks: { summary: { text: 'One big order.' } },
        expect: { output: { stats: { count: 9, sum: 9 }, message: 'x' } },
      },
    ],
  };

  it('stands in for the model’s answer, and says which stand-ins it never used [MCP-R34]', async () => {
    const used = await answer(run, {
      automation: DOC_EXAMPLE.automation,
      input: ORDERS,
      mocks: { summary: { text: 'Mocked words.' } },
    });
    expect(used.isError).toBe(false);
    expect(used.body.output.message).toBe('Mocked words.');
    expect(used.body).not.toHaveProperty('unusedMocks');

    const unused = await answer(run, {
      automation: DOC_EXAMPLE.automation,
      input: NOBODY,
      mocks: { summary: { text: 'Mocked words.' } },
    });
    expect(unused.body.output.message).toBe('No qualifying orders.');
    expect(unused.body.unusedMocks).toEqual(['summary']);
  });

  it('runs one step alone, or a step and what it needs, and says where it stood in [MCP-R34]', async () => {
    const upTo = await answer(run, {
      automation: DOC_EXAMPLE.automation,
      input: ORDERS,
      upTo: 'calc',
    });
    expect(upTo.body).toMatchObject({
      status: 'success',
      output: { count: 1, sum: 250 },
      focus: { node: 'calc', kind: 'upTo' },
    });
    const only = await answer(run, {
      automation: DOC_EXAMPLE.automation,
      input: ORDERS,
      only: 'summary',
      mocks: { calc: { count: 3, sum: 300 } },
    });
    expect(only.body).toMatchObject({
      status: 'success',
      focus: { node: 'summary', kind: 'only' },
    });
  });

  it('makes a node fail with the message given, to see what the rest does', async () => {
    const failed = await answer(run, {
      automation: DOC_EXAMPLE.automation,
      input: ORDERS,
      failures: { calc: 'the sums are down' },
    });
    expect(failed.body).toMatchObject({
      status: 'error',
      error: { nodeId: 'calc' },
    });
  });

  it('refuses a stand-in for a node the document does not have, naming the nodes it has [MCP-R34]', async () => {
    const refused = await answer(run, {
      automation: DOC_EXAMPLE.automation,
      mocks: { summery: { text: 'x' } },
    });
    expect(refused.isError).toBe(true);
    expect(refused.body).toMatchObject({
      code: 'BENCH_INVALID',
      data: { issue: { code: 'BENCH_UNKNOWN_NODE' } },
    });
    expect(refused.body.hint).toEqual(expect.any(String));
  });

  it('refuses a scope the engine cannot combine, as the request’s fault', async () => {
    const refused = await answer(run, {
      automation: DOC_EXAMPLE.automation,
      item: 0,
    });
    expect(refused.body).toMatchObject({
      code: 'BENCH_INVALID',
      data: { issue: { code: 'BENCH_SCOPE_CONFLICT' } },
    });
  });

  it('refuses stand-ins too large for a door, with every other problem, before anything runs [MCP-R34]', async () => {
    const engine = vi.fn(host.engine);
    const refused = await answer(
      run,
      {
        automation: DOC_EXAMPLE.automation,
        mocks: { summary: 'x'.repeat(70_000) },
        failures: { calc: 'y'.repeat(2_001) },
        item: -1,
        upTo: 'z'.repeat(51),
      },
      { host: { ...host, engine } },
    );
    expect(refused.body.code).toBe('INVALID_ARGUMENTS');
    expect(
      refused.body.data.issues.map(
        (issue: { path: string; code: string }) =>
          `${issue.path} ${issue.code}`,
      ),
    ).toEqual([
      'failures.calc too_big',
      'item too_small',
      'mocks.summary too_large',
      'upTo too_big',
    ]);
    expect(engine).not.toHaveBeenCalled();
  });

  it('runs the tests named, and only those, answering what each returned when asked [MCP-R33]', async () => {
    const picked = await answer(test, {
      automation: WITH_TESTS,
      tests: ['wrong on purpose', 'one big order'],
      detail: ['output'],
    });
    expect(picked.isError).toBe(false);
    expect(picked.body).toMatchObject({ passed: 1, failed: 1 });
    expect(picked.body.results.map((r: { name: string }) => r.name)).toEqual([
      'one big order',
      'wrong on purpose',
    ]);
    const wrong = picked.body.results[1];
    expect(wrong.pass).toBe(false);
    expect(wrong.failures[0]).toMatchObject({ kind: 'output', mode: 'exact' });
    // The run's output, and nothing else of it.
    expect(wrong.run).toMatchObject({
      status: 'success',
      output: { stats: { count: 1, sum: 250 } },
    });
    expect(wrong.run).not.toHaveProperty('record');
    expect(wrong.run).not.toHaveProperty('effects');
  });

  it('answers the verdicts alone unless asked for more', async () => {
    const plain = await answer(test, { automation: WITH_TESTS });
    expect(plain.body).toMatchObject({ passed: 2, failed: 1 });
    for (const result of plain.body.results) {
      expect(result).not.toHaveProperty('run');
    }
  });

  it('answers the steps of a test’s run as a record when asked for the trace [MCP-R33]', async () => {
    const traced = await answer(test, {
      automation: WITH_TESTS,
      tests: ['one big order'],
      detail: ['trace'],
    });
    expect(traced.body.results[0].run.record).toMatchObject({
      view: { nodes: expect.any(Array) },
      details: expect.any(Array),
    });
    expect(traced.body.results[0].run).not.toHaveProperty('output');
  });

  it('refuses a test name the document does not have, naming the tests it has [MCP-R33]', async () => {
    const refused = await answer(test, {
      automation: WITH_TESTS,
      tests: ['one big ordre'],
    });
    expect(refused.isError).toBe(true);
    expect(refused.body).toMatchObject({ code: 'INVALID_PARAMS' });
    expect(refused.body.hint).toContain('one big order');
  });

  it('refuses names that are not a list of tests, an unknown detail and a blank name at the door', async () => {
    for (const args of [
      { automation: WITH_TESTS, tests: [] },
      { automation: WITH_TESTS, tests: ['  '] },
      { automation: WITH_TESTS, tests: 'one big order' },
      { automation: WITH_TESTS, detail: ['everything'] },
    ]) {
      const refused = await answer(test, args);
      expect(refused.body.code, JSON.stringify(args)).toBe('INVALID_ARGUMENTS');
    }
  });

  it('draws one execution for a run and one per test from the organization’s bench budget, and refuses with the wait when it is spent [MCP-R33]', async () => {
    const asked: number[] = [];
    const metered = (retryAfterMs?: number): McpHost => ({
      ...host,
      engine: (_caller, method, params) =>
        dispatch(method, params, {
          store: {
            ...referenceStore(),
            admitBench: async (executions: number) => {
              asked.push(executions);
              return retryAfterMs === undefined ? () => {} : { retryAfterMs };
            },
          },
        }),
    });
    await answer(
      run,
      { automation: DOC_EXAMPLE.automation },
      {
        host: metered(),
      },
    );
    await answer(test, { automation: WITH_TESTS }, { host: metered() });
    await answer(
      test,
      { automation: WITH_TESTS, tests: ['one big order'] },
      { host: metered() },
    );
    expect(asked).toEqual([1, 3, 1]);

    const spent = await answer(
      test,
      { automation: WITH_TESTS },
      { host: metered(1500) },
    );
    expect(spent.isError).toBe(true);
    expect(spent.body).toMatchObject({
      code: 'RATE_LIMITED',
      data: { retryAfterMs: 1500 },
    });
  });
});
