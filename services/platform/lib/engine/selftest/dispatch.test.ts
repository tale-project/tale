import { beforeAll, describe, expect, it, vi } from 'vitest';

import { dispatch, METHODS, type DispatchStore } from '../api/dispatch';
import { DOC_EXAMPLE } from '../api/docs';
import { setCodeRunner } from '../core/slots';
import type { Automation, RunResult } from '../core/types';
import { nodeVmRunner } from '../runners/node-vm';
import { memoryStore } from './memory-store';

/** A dispatch store for the selftest: the versioned in-memory store, which
 * doubles as the reference HOST — it records runs and triggers, so the
 * management methods answer from real state rather than from a stub. */
function dispatchStore(): DispatchStore {
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

/** The minimum a store must implement: reads plus save/deploy. Every optional
 * capability is absent, which is what the refusal messages are for. */
function bareStore(): DispatchStore {
  const mem = memoryStore();
  return {
    list: () => mem.list(),
    get: (name, version) => mem.get(name, version),
    deployedVersion: (name) => mem.deployedVersion(name),
    async save(automation: Automation) {
      const { version } = mem.save(automation.name, automation);
      return { name: automation.name, version };
    },
    async deploy(name: string, version: number) {
      mem.deploy(name, version);
      return { name, version };
    },
  };
}

/** Save the documented example and promote it, so a management method has a
 * deployed version to act on. */
async function deployedExample(store: DispatchStore): Promise<void> {
  await dispatch(
    'save_automation',
    { automation: DOC_EXAMPLE.automation, message: 'first cut' },
    { store },
  );
  await dispatch(
    'deploy_automation',
    { name: 'order-report', version: 1 },
    { store },
  );
}

beforeAll(() => {
  setCodeRunner(nodeVmRunner());
});

describe('the documented example is honest', () => {
  it('run_automation succeeds on DOC_EXAMPLE and matches its own test expectation shape', async () => {
    const result = (await dispatch(
      'run_automation',
      { automation: DOC_EXAMPLE.automation, input: DOC_EXAMPLE.input },
      { store: dispatchStore() },
    )) as RunResult;
    expect(result.status).toBe('success');
    expect(result.output).toMatchObject({
      stats: { count: 1, sum: 250 },
    });
  });

  it('test_automation passes the example automation attached tests', async () => {
    const report = await dispatch(
      'test_automation',
      { automation: DOC_EXAMPLE.automation },
      { store: dispatchStore() },
    );
    expect(report).toMatchObject({ passed: 1, failed: 0 });
  });

  it('validate_automation reports the example clean', async () => {
    const result = (await dispatch(
      'validate_automation',
      { automation: DOC_EXAMPLE.automation },
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
    expect(docs).toContain('method: run_automation');
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
    expect(byType.get('subautomation')).toBeDefined();
  });

  it('live mode is refused without host opt-in', async () => {
    const result = (await dispatch(
      'run_automation',
      {
        automation: DOC_EXAMPLE.automation,
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
      'save_automation',
      { automation: DOC_EXAMPLE.automation },
      { store },
    )) as { name: string; version: number };
    expect(saved).toMatchObject({ name: 'order-report', version: 1 });

    const deployed = (await dispatch(
      'deploy_automation',
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

  it('run_deployed with live enabled and no connector host hands the run to the durable runner, never to the mocks', async () => {
    // The platform hosts enable live but execute connectors only through the
    // durable stepper: a one-piece run must go there — authorized, executed
    // live, recorded by the host — instead of running the deterministic mocks
    // and recording the outcome as a live success.
    const base = dispatchStore();
    const startRun = vi.fn(
      (...args: Parameters<NonNullable<DispatchStore['startRun']>>) =>
        base.startRun!(...args),
    );
    const recordRun = vi.fn(
      (...args: Parameters<NonNullable<DispatchStore['recordRun']>>) =>
        base.recordRun!(...args),
    );
    const store: DispatchStore = { ...base, startRun, recordRun };
    await deployedExample(store);

    const run = (await dispatch(
      'run_deployed',
      { name: 'order-report', input: DOC_EXAMPLE.input },
      { store, allowLive: true },
    )) as RunResult & { runId?: string; version: number; mode?: string };
    expect(startRun).toHaveBeenCalledWith(
      'order-report',
      DOC_EXAMPLE.input,
      'live',
      1,
    );
    expect(recordRun).not.toHaveBeenCalled();
    expect(run).toMatchObject({ version: 1, mode: 'live', status: 'success' });
    expect(run.runId).toBeDefined();
    expect(run.output).toBeDefined();
    expect(Array.isArray(run.trace)).toBe(true);
    const viewed = (await dispatch(
      'get_run',
      { runId: run.runId },
      { store, allowLive: true },
    )) as { run: { mode: string; status: string } };
    expect(viewed.run).toMatchObject({ mode: 'live', status: 'success' });
  });

  it('run_deployed answers with the run handle when the durable run outlives the wait', async () => {
    const base = dispatchStore();
    await deployedExample(base);
    const store: DispatchStore = {
      ...base,
      startRun: async () => ({ runId: 'run_slow', version: 1 }),
      getRun: async (runId) => ({
        runId,
        name: 'order-report',
        version: 1,
        status: 'running',
        mode: 'live',
        startedBy: 'host',
        startedAt: Date.now(),
      }),
    };
    const run = (await dispatch(
      'run_deployed',
      { name: 'order-report', input: DOC_EXAMPLE.input },
      { store, allowLive: true, liveRunWait: { timeoutMs: 30, pollMs: 5 } },
    )) as { runId?: string; status?: string; note?: string; output?: unknown };
    expect(run).toMatchObject({ runId: 'run_slow', status: 'running' });
    expect(run.note).toContain('poll get_run');
    expect(run.output).toBeUndefined();
  });

  it("run_deployed relays the durable runner's refusal as data", async () => {
    const base = dispatchStore();
    await deployedExample(base);
    const store: DispatchStore = {
      ...base,
      startRun: async () => {
        throw new Error(
          'Role "member" lacks the developer-settings capability',
        );
      },
    };
    const run = (await dispatch(
      'run_deployed',
      { name: 'order-report', input: DOC_EXAMPLE.input },
      { store, allowLive: true },
    )) as { error?: string };
    expect(run.error).toContain('developer-settings');
  });

  it('run_deployed live on a store without a durable runner says so instead of running mocks', async () => {
    const store = bareStore();
    await deployedExample(store);
    const run = (await dispatch(
      'run_deployed',
      { name: 'order-report', input: DOC_EXAMPLE.input },
      { store, allowLive: true },
    )) as { error?: string; status?: string };
    expect(run.status).toBeUndefined();
    expect(run.error).toContain('live execution is not available');
  });

  it('run_automation refuses live mode on a host without a connector host', async () => {
    const result = (await dispatch(
      'run_automation',
      {
        automation: DOC_EXAMPLE.automation,
        input: DOC_EXAMPLE.input,
        mode: 'live',
      },
      { store: dispatchStore(), allowLive: true },
    )) as { error?: string; hint?: string; status?: string };
    expect(result.status).toBeUndefined();
    expect(result.error).toContain('unsaved document');
    expect(result.hint).toContain('run_deployed');
  });

  it('the deploy gate refuses a version whose tests fail', async () => {
    const store = dispatchStore();
    const broken: Automation = {
      version: 1,
      name: 'broken-flow',
      nodes: [{ id: 'a', type: 'transform', code: 'return 1;' }],
      output: '{{ nodes.a.output }}',
      tests: [{ name: 'wrong', input: {}, expect: { output: 999 } }],
    };
    await dispatch('save_automation', { automation: broken }, { store });
    const deployed = (await dispatch(
      'deploy_automation',
      { name: 'broken-flow', version: 1 },
      { store },
    )) as { error?: string };
    expect(deployed.error).toContain('failing tests');
  });

  it('save_automation refuses an invalid document', async () => {
    const result = (await dispatch(
      'save_automation',
      { automation: { version: 1, name: 'bad', nodes: [] } },
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

  it('set_trigger refuses the retired api-key kind', async () => {
    const result = (await dispatch(
      'set_trigger',
      { name: 'order-report', trigger: { kind: 'api-key' } },
      { store: dispatchStore() },
    )) as { error?: string };
    expect(result.error).toContain('unknown trigger kind "api-key"');
    expect(result.error).toContain('schedule, webhook, event');
  });
});

describe("dispatch — subautomation nodes resolve through the caller's store", () => {
  /** A child saved in the store, and a parent that calls it. */
  async function saveChild(store: DispatchStore): Promise<void> {
    const child: Automation = {
      version: 1,
      name: 'double-it',
      nodes: [
        {
          id: 'double',
          type: 'transform',
          input: { n: '{{ input.n }}' },
          code: 'return input.n * 2;',
        },
      ],
      output: '{{ nodes.double.output }}',
    };
    await dispatch('save_automation', { automation: child }, { store });
  }
  const parent = (child: string): Automation => ({
    version: 1,
    name: 'call-child',
    nodes: [
      {
        id: 'call',
        type: 'subautomation',
        automation: child,
        input: { n: 21 },
      },
    ],
    output: '{{ nodes.call.output }}',
    tests: [{ name: 'doubles', input: {}, expect: { output: 42 } }],
  });

  it('run_automation and test_automation execute the referenced child with no process-global store', async () => {
    const store = dispatchStore();
    await saveChild(store);

    const run = (await dispatch(
      'run_automation',
      { automation: parent('double-it'), input: {} },
      { store },
    )) as RunResult;
    expect(run.status).toBe('success');
    expect(run.output).toBe(42);

    const report = await dispatch(
      'test_automation',
      { automation: parent('double-it') },
      { store },
    );
    expect(report).toMatchObject({ passed: 1, failed: 0 });
  });

  it('validate_automation names a child the store does not have', async () => {
    const store = dispatchStore();
    await saveChild(store);
    const result = (await dispatch(
      'validate_automation',
      { automation: parent('double-them') },
      { store },
    )) as { valid: boolean; errors: Array<{ code: string; hint?: string }> };
    expect(result.valid).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain(
      'SUBAUTOMATION_NOT_FOUND',
    );
    expect(result.errors[0]?.hint).toContain('double-it');
  });

  it('the deploy gate runs the tests of a parent with a subautomation node', async () => {
    const store = dispatchStore();
    await saveChild(store);
    await dispatch(
      'save_automation',
      { automation: parent('double-it') },
      { store },
    );
    const deployed = (await dispatch(
      'deploy_automation',
      { name: 'call-child', version: 1 },
      { store },
    )) as { deployed?: unknown; error?: string };
    expect(deployed.error).toBeUndefined();
    expect(deployed.deployed).toMatchObject({ name: 'call-child', version: 1 });
  });
});

describe('dispatch — run and trigger management', () => {
  it('start_run hands the run to the host and get_run reports its outcome', async () => {
    const store = dispatchStore();
    await deployedExample(store);

    const started = (await dispatch(
      'start_run',
      { name: 'order-report', input: DOC_EXAMPLE.input },
      { store },
    )) as { runId?: string; version?: number; mode?: string; note?: string };
    expect(started.runId).toBe('run_1');
    expect(started.version).toBe(1);
    // A test session has no live opt-in, so the host runs against the mocks.
    expect(started.mode).toBe('mock');
    expect(started.note).toContain('get_run');

    const polled = (await dispatch(
      'get_run',
      { runId: 'run_1' },
      { store },
    )) as {
      run?: {
        status: string;
        output?: unknown;
        trace?: unknown;
        effects?: unknown;
      };
    };
    expect(polled.run?.status).toBe('success');
    expect(polled.run?.output).toMatchObject({ stats: { count: 1, sum: 250 } });
    expect(polled.run?.trace).toBeDefined();
    expect(polled.run?.effects).toBeDefined();

    const listed = (await dispatch(
      'list_runs',
      { name: 'order-report' },
      { store },
    )) as { runs: Array<{ runId: string; name: string }> };
    expect(listed.runs).toHaveLength(1);
    expect(listed.runs[0]).toMatchObject({
      runId: 'run_1',
      name: 'order-report',
      version: 1,
    });

    // The reference host finishes a run before it answers, so cancelling one
    // reports that there was nothing left to stop — the same answer a real
    // host gives for a run that already settled.
    const cancelled = (await dispatch(
      'cancel_run',
      { runId: 'run_1' },
      { store },
    )) as { cancelled?: boolean; note?: string };
    expect(cancelled.cancelled).toBe(false);
    expect(cancelled.note).toContain('already finished');
  });

  it('start_run refuses a version that is not a number', async () => {
    const store = dispatchStore();
    await deployedExample(store);
    const result = (await dispatch(
      'start_run',
      { name: 'order-report', version: 'latest' },
      { store },
    )) as { error?: string };
    expect(result.error).toContain('must be a whole number');
  });

  it('get_automation and deploy_automation refuse a version that is not a whole number instead of forwarding NaN', async () => {
    const store = dispatchStore();
    await deployedExample(store);
    // A store that would take the NaN straight into a query.
    const gets: unknown[] = [];
    const spying: DispatchStore = {
      ...store,
      get: (name, version) => {
        gets.push(version);
        return store.get(name, version);
      },
    };

    const latest = (await dispatch(
      'get_automation',
      { name: 'order-report', version: 'latest' },
      { store: spying },
    )) as { error?: string; hint?: string };
    expect(latest.error).toContain('must be a whole number');
    expect(latest.error).toContain('"latest"');
    expect(latest.hint).toContain('omit it');

    const fractional = (await dispatch(
      'deploy_automation',
      { name: 'order-report', version: 1.5 },
      { store: spying },
    )) as { error?: string };
    expect(fractional.error).toContain('must be a whole number');

    const missing = (await dispatch(
      'deploy_automation',
      { name: 'order-report' },
      { store: spying },
    )) as { error?: string; hint?: string };
    expect(missing.error).toBe('missing params.version');
    expect(missing.hint).toContain('list_versions');

    expect(gets).toEqual([]);

    // The string form of a whole number is still accepted.
    const asText = (await dispatch(
      'get_automation',
      { name: 'order-report', version: '1' },
      { store: spying },
    )) as { meta?: { version: number } };
    expect(asText.meta?.version).toBe(1);
    expect(gets).toEqual([1]);
  });

  it('start_run refuses an automation with nothing deployed', async () => {
    const store = dispatchStore();
    const result = (await dispatch(
      'start_run',
      { name: 'order-report' },
      { store },
    )) as { error?: string; hint?: string };
    expect(result.error).toContain('has no version to run');
    expect(result.hint).toContain('deploy_automation');
  });

  it('get_run and cancel_run answer for an unknown run instead of throwing', async () => {
    const store = dispatchStore();
    const missing = (await dispatch(
      'get_run',
      { runId: 'run_404' },
      { store },
    )) as { error?: string };
    expect(missing.error).toContain('no run "run_404"');

    const cancel = (await dispatch(
      'cancel_run',
      { runId: 'run_404' },
      { store },
    )) as { error?: string };
    expect(cancel.error).toContain('no run "run_404"');
  });

  it('list_versions reports the immutable history with its messages', async () => {
    const store = dispatchStore();
    await deployedExample(store);
    await dispatch(
      'save_automation',
      { automation: DOC_EXAMPLE.automation, message: 'second cut' },
      { store },
    );

    const result = (await dispatch(
      'list_versions',
      { name: 'order-report' },
      { store },
    )) as { versions: Array<{ version: number; message?: string }> };
    expect(result.versions.map((v) => v.version)).toEqual([1, 2]);
    expect(result.versions.map((v) => v.message)).toEqual([
      'first cut',
      'second cut',
    ]);
  });

  it('list_triggers shows the binding and delete_trigger removes it', async () => {
    const store = dispatchStore();
    await dispatch(
      'set_trigger',
      {
        name: 'order-report',
        trigger: { kind: 'schedule', cron: '0 9 * * *', timezone: 'UTC' },
      },
      { store },
    );

    const listed = (await dispatch('list_triggers', {}, { store })) as {
      triggers: Array<{ name: string; kind: string; cron?: string }>;
    };
    expect(listed.triggers).toEqual([
      {
        name: 'order-report',
        kind: 'schedule',
        cron: '0 9 * * *',
        timezone: 'UTC',
        hasToken: false,
        enabled: true,
      },
    ]);

    const deleted = (await dispatch(
      'delete_trigger',
      { name: 'order-report' },
      { store },
    )) as { ok?: boolean; note?: string };
    expect(deleted.ok).toBe(true);
    expect(deleted.note).toContain('run history');

    const after = (await dispatch('list_triggers', {}, { store })) as {
      triggers: unknown[];
    };
    expect(after.triggers).toEqual([]);
  });

  it('a store without the capability refuses instead of throwing', async () => {
    const store = bareStore();
    const refusals = await Promise.all(
      (
        [
          ['start_run', { name: 'order-report' }],
          ['list_runs', {}],
          ['get_run', { runId: 'run_1' }],
          ['cancel_run', { runId: 'run_1' }],
          ['list_versions', { name: 'order-report' }],
          ['list_triggers', {}],
          ['delete_trigger', { name: 'order-report' }],
          ['set_trigger', { name: 'order-report', trigger: { kind: 'event' } }],
        ] as const
      ).map(([method, params]) => dispatch(method, params, { store })),
    );
    for (const refusal of refusals) {
      expect(refusal).toMatchObject({
        error: expect.stringContaining('not supported in this environment'),
      });
    }
  });

  it('every method in the table answers rather than falling through', async () => {
    const store = dispatchStore();
    await deployedExample(store);
    for (const method of METHODS) {
      const result = await dispatch(method, {}, { store });
      expect(result).not.toMatchObject({
        error: expect.stringContaining('unknown method'),
      });
    }
  });
});
