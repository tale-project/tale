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
import { findMcpTool, MCP_TOOLS } from '../../../lib/mcp/tools';
import type { McpCaller } from './caller';
import { callTool, listTools, type McpHost } from './tools';

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
    // The run is started in `beforeAll`, after the table is built.
    ['get_run', { runId: STARTED_RUN }],
    ['list_versions', { name: 'order-report' }],
    ['list_triggers', {}],
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
        args.runId === STARTED_RUN ? { ...args, runId } : args,
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
      get_automation: { 'anthropic/maxResultSizeChars': 200_000 },
      deploy_automation: { 'anthropic/requiresUserInteraction': true },
      set_trigger: { 'anthropic/requiresUserInteraction': true },
      run_deployed: { 'anthropic/maxResultSizeChars': 200_000 },
      get_run: { 'anthropic/maxResultSizeChars': 250_000 },
    });
  });
});
