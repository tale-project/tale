import { beforeAll, describe, expect, it } from 'vitest';

import { dispatch, METHODS, type DispatchStore } from '../api/dispatch';
import { DOC_EXAMPLE } from '../api/docs';
import { setCodeRunner } from '../core/slots';
import type { RunResult, Workflow } from '../core/types';
import { nodeVmRunner } from '../runners/node-vm';
import { memoryStore } from '../store/memory';

/** A dispatch store for the selftest: the versioned in-memory store plus the
 * trigger/run-record hooks dispatch calls, kept in local maps. */
function dispatchStore(): DispatchStore {
  const mem = memoryStore();
  const triggers = new Map<string, unknown>();
  const runs: Array<{ name: string; mode: string }> = [];
  return {
    list: () => mem.list(),
    get: (name, version) => mem.get(name, version),
    deployedVersion: (name) => mem.deployedVersion(name),
    async save(workflow: Workflow) {
      const { version } = mem.save(workflow.name, workflow);
      return { name: workflow.name, version };
    },
    async deploy(name: string, version: number) {
      mem.deploy(name, version);
      return { name, version };
    },
    async setTrigger(name, trigger) {
      triggers.set(name, trigger);
    },
    async recordRun(name, _version, _result: RunResult, mode) {
      runs.push({ name, mode });
    },
  };
}

beforeAll(() => {
  setCodeRunner(nodeVmRunner());
});

describe('the documented example is honest', () => {
  it('run_workflow succeeds on DOC_EXAMPLE and matches its own test expectation shape', async () => {
    const result = (await dispatch(
      'run_workflow',
      { workflow: DOC_EXAMPLE.workflow, input: DOC_EXAMPLE.input },
      { store: dispatchStore() },
    )) as RunResult;
    expect(result.status).toBe('success');
    expect(result.output).toMatchObject({
      stats: { count: 1, sum: 250 },
    });
  });

  it('test_workflow passes the example workflow attached tests', async () => {
    const report = await dispatch(
      'test_workflow',
      { workflow: DOC_EXAMPLE.workflow },
      { store: dispatchStore() },
    );
    expect(report).toMatchObject({ passed: 1, failed: 0 });
  });

  it('validate_workflow reports the example clean', async () => {
    const result = (await dispatch(
      'validate_workflow',
      { workflow: DOC_EXAMPLE.workflow },
      { store: dispatchStore() },
    )) as { valid: boolean; errors: unknown[] };
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });
});

describe('dispatch — the shared method table', () => {
  it('get_docs renders the guide with the example embedded', async () => {
    const { docs } = (await dispatch(
      'get_docs',
      {},
      { store: dispatchStore() },
    )) as {
      docs: string;
    };
    expect(docs).toContain('order-report');
    expect(docs).toContain('method: run_workflow');
  });

  it('get_catalog lists the built-in node types with their output kind', async () => {
    const { node_types } = (await dispatch(
      'get_catalog',
      {},
      { store: dispatchStore() },
    )) as { node_types: Array<{ type: string; outputKind: string }> };
    const byType = new Map(node_types.map((t) => [t.type, t]));
    expect(byType.get('transform')?.outputKind).toBe('structured');
    expect(byType.get('llm')).toBeDefined();
    expect(byType.get('subworkflow')).toBeDefined();
  });

  it('live mode is refused without host opt-in', async () => {
    const result = (await dispatch(
      'run_workflow',
      {
        workflow: DOC_EXAMPLE.workflow,
        input: DOC_EXAMPLE.input,
        mode: 'live',
      },
      { store: dispatchStore() },
    )) as { error?: string };
    expect(result.error).toContain('live mode is not enabled');
  });

  it('save → deploy-gate → deploy → run_deployed round-trips', async () => {
    const store = dispatchStore();
    const saved = (await dispatch(
      'save_workflow',
      { workflow: DOC_EXAMPLE.workflow },
      { store },
    )) as { name: string; version: number };
    expect(saved).toMatchObject({ name: 'order-report', version: 1 });

    const deployed = (await dispatch(
      'deploy_workflow',
      { name: 'order-report', version: 1 },
      { store },
    )) as { deployed?: unknown; error?: string };
    expect(deployed.error).toBeUndefined();
    expect(deployed.deployed).toMatchObject({ version: 1 });

    const run = (await dispatch(
      'run_deployed',
      { name: 'order-report', input: DOC_EXAMPLE.input },
      { store },
    )) as RunResult & { version: number };
    expect(run.version).toBe(1);
    expect(run.status).toBe('success');
  });

  it('the deploy gate refuses a version whose tests fail', async () => {
    const store = dispatchStore();
    const broken: Workflow = {
      version: 1,
      name: 'broken-flow',
      nodes: [{ id: 'a', type: 'transform', code: 'return 1;' }],
      output: '{{ nodes.a.output }}',
      tests: [{ name: 'wrong', input: {}, expect: { output: 999 } }],
    };
    await dispatch('save_workflow', { workflow: broken }, { store });
    const deployed = (await dispatch(
      'deploy_workflow',
      { name: 'broken-flow', version: 1 },
      { store },
    )) as { error?: string };
    expect(deployed.error).toContain('failing tests');
  });

  it('save_workflow refuses an invalid document', async () => {
    const result = (await dispatch(
      'save_workflow',
      { workflow: { version: 1, name: 'bad', nodes: [] } },
      { store: dispatchStore() },
    )) as { error?: string };
    expect(result.error).toContain('failed validation');
  });

  it('search_catalog and unknown-method both guide the caller', async () => {
    const empty = (await dispatch(
      'search_catalog',
      { query: '' },
      { store: dispatchStore() },
    )) as { error?: string };
    expect(empty.error).toContain('missing params.query');

    const unknown = (await dispatch(
      'frobnicate',
      {},
      { store: dispatchStore() },
    )) as { error?: string; hint?: string };
    expect(unknown.error).toContain('unknown method');
    expect(unknown.hint).toContain(METHODS[0]);
  });

  it('set_trigger records a binding', async () => {
    const result = (await dispatch(
      'set_trigger',
      {
        name: 'order-report',
        trigger: { kind: 'schedule', cron: '0 9 * * *' },
      },
      { store: dispatchStore() },
    )) as { ok?: boolean };
    expect(result.ok).toBe(true);
  });
});
