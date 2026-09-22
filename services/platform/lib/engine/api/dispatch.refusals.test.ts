import { describe, expect, it, vi } from 'vitest';

import {
  DISPATCH_REFUSAL_CODES,
  dispatch,
  type DispatchStore,
} from './dispatch';
import { DOC_EXAMPLE } from './docs';
import { runAutomationTests } from './tests';

vi.mock('./tests', () => ({ runAutomationTests: vi.fn() }));

/**
 * Every refusal the dispatch table mints reads the same way: `error` (the
 * sentence), `code` (the stable value to branch on) and `hint` (what to do
 * next) — the contract the MCP endpoint page promises. The regression
 * under test (2026-09-11 external evaluation, G-08/G-10): `get_automation`
 * and `get_run` refused with a code and no hint, the save/deploy/live
 * refusals with neither, and `list_versions` on an unknown name answered
 * `{versions: []}` — the same answer as an automation with no history.
 */

const SAVED = 'order-report';

/** A store with the full management surface, holding one saved and
 * deployed automation (`order-report@1`). */
function fullStore(overrides: Partial<DispatchStore> = {}): DispatchStore {
  return {
    list: async () => [],
    get: async (name: string, version?: number) =>
      name === SAVED && (version === undefined || version === 1)
        ? { meta: { version: 1 }, automation: DOC_EXAMPLE.automation }
        : null,
    deployedVersion: async (name: string) => (name === SAVED ? 1 : null),
    save: async () => ({ name: SAVED, version: 2 }),
    deploy: async () => ({ name: SAVED, version: 1 }),
    setTrigger: async () => {},
    startRun: async () => ({ runId: 'run-1', version: 1 }),
    listRuns: async () => [],
    getRun: async () => null,
    cancelRun: async () => ({ cancelled: false }),
    listVersions: async () => [],
    listTriggers: async () => [],
    deleteTrigger: async () => ({ deleted: false }),
    ...overrides,
  };
}

/** A bare selftest store: authoring only, no runs, versions or triggers. */
function bareStore(): DispatchStore {
  return {
    list: async () => [],
    get: async () => null,
    deployedVersion: async () => null,
    save: async () => ({ name: SAVED, version: 1 }),
    deploy: async () => ({ name: SAVED, version: 1 }),
  };
}

type Refusal = { error: string; code: string; hint: string };

function isRefusal(value: unknown): value is Refusal {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof Reflect.get(value, 'error') === 'string'
  );
}

/** Every way the table refuses, as [method, params, store, expected code]. */
const REFUSALS: [
  string,
  Record<string, unknown>,
  () => DispatchStore,
  string,
][] = [
  ['search_catalog', {}, fullStore, 'INVALID_PARAMS'],
  ['validate_automation', {}, fullStore, 'INVALID_PARAMS'],
  ['run_automation', {}, fullStore, 'INVALID_PARAMS'],
  [
    'run_automation',
    { automation: DOC_EXAMPLE.automation, mode: 'dry' },
    fullStore,
    'INVALID_PARAMS',
  ],
  [
    'run_automation',
    { automation: DOC_EXAMPLE.automation, mode: 'live' },
    fullStore,
    'LIVE_MODE_UNAVAILABLE',
  ],
  ['test_automation', {}, fullStore, 'INVALID_PARAMS'],
  ['save_automation', {}, fullStore, 'INVALID_PARAMS'],
  [
    'save_automation',
    { automation: { name: 'nope', nodes: 'not-a-list' } },
    fullStore,
    'AUTOMATION_INVALID',
  ],
  [
    'get_automation',
    { name: SAVED, version: 'latest' },
    fullStore,
    'INVALID_PARAMS',
  ],
  ['get_automation', { name: 'nope' }, fullStore, 'AUTOMATION_NOT_FOUND'],
  ['deploy_automation', { name: SAVED }, fullStore, 'INVALID_PARAMS'],
  [
    'deploy_automation',
    { name: SAVED, version: 1.5 },
    fullStore,
    'INVALID_PARAMS',
  ],
  [
    'deploy_automation',
    { name: SAVED, version: 9 },
    fullStore,
    'AUTOMATION_VERSION_UNKNOWN',
  ],
  [
    'deploy_automation',
    { name: SAVED, version: 1 },
    () =>
      fullStore({
        get: async () => ({
          meta: { version: 1 },
          automation: { name: SAVED, nodes: 'not-a-list' },
        }),
      }),
    'AUTOMATION_INVALID',
  ],
  [
    'set_trigger',
    { name: SAVED, trigger: { kind: 'schedule' } },
    bareStore,
    'NOT_SUPPORTED',
  ],
  ['set_trigger', { name: SAVED }, fullStore, 'INVALID_PARAMS'],
  [
    'set_trigger',
    { trigger: { kind: 'schedule' } },
    fullStore,
    'INVALID_PARAMS',
  ],
  [
    'set_trigger',
    { name: 'nope', trigger: { kind: 'schedule' } },
    fullStore,
    'AUTOMATION_NOT_FOUND',
  ],
  ['run_deployed', { name: 'nope' }, fullStore, 'AUTOMATION_NOT_DEPLOYED'],
  [
    'run_deployed',
    { name: SAVED },
    () => fullStore({ get: async () => null }),
    'AUTOMATION_VERSION_UNKNOWN',
  ],
  ['start_run', { name: SAVED }, bareStore, 'NOT_SUPPORTED'],
  ['start_run', {}, fullStore, 'INVALID_PARAMS'],
  ['start_run', { name: SAVED, version: 'v1' }, fullStore, 'INVALID_PARAMS'],
  [
    'start_run',
    { name: 'nope' },
    () => fullStore({ startRun: async () => null }),
    'AUTOMATION_NOT_DEPLOYED',
  ],
  ['list_runs', {}, bareStore, 'NOT_SUPPORTED'],
  ['list_runs', { name: 'nope' }, fullStore, 'AUTOMATION_NOT_FOUND'],
  ['get_run', { runId: 'r' }, bareStore, 'NOT_SUPPORTED'],
  ['get_run', {}, fullStore, 'INVALID_PARAMS'],
  ['get_run', { runId: 'nope' }, fullStore, 'RUN_NOT_FOUND'],
  ['cancel_run', { runId: 'r' }, bareStore, 'NOT_SUPPORTED'],
  ['cancel_run', {}, fullStore, 'INVALID_PARAMS'],
  // A run that never existed is RUN_NOT_FOUND, like `get_run` and REST —
  // the default store's cancelRun answers `{cancelled:false}` with no
  // terminal status, the shape that means "no such run" (2026-09-18
  // evaluation, J8-1).
  ['cancel_run', { runId: 'nope' }, fullStore, 'RUN_NOT_FOUND'],
  ['list_versions', { name: SAVED }, bareStore, 'NOT_SUPPORTED'],
  ['list_versions', {}, fullStore, 'INVALID_PARAMS'],
  ['list_versions', { name: 'nope' }, fullStore, 'AUTOMATION_NOT_FOUND'],
  ['list_triggers', {}, bareStore, 'NOT_SUPPORTED'],
  ['list_triggers', { name: 'nope' }, fullStore, 'AUTOMATION_NOT_FOUND'],
  ['delete_trigger', { name: SAVED }, bareStore, 'NOT_SUPPORTED'],
  ['delete_trigger', {}, fullStore, 'INVALID_PARAMS'],
  ['delete_trigger', { name: 'nope' }, fullStore, 'AUTOMATION_NOT_FOUND'],
  ['no_such_method', {}, fullStore, 'UNKNOWN_METHOD'],
];

describe('every refusal carries a code and a hint', () => {
  it.each(
    REFUSALS.map(([method, params, store, code]) => ({
      name: `${method} ${JSON.stringify(params)} on the ${store === bareStore ? 'bare' : 'full'} store → ${code}`,
      method,
      params,
      store,
      code,
    })),
  )('$name', async ({ method, params, store, code }) => {
    const result = await dispatch(method, params, { store: store() });
    expect(isRefusal(result), JSON.stringify(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.code).toBe(code);
    expect(DISPATCH_REFUSAL_CODES).toContain(result.code);
    expect(result.hint).toMatch(/\S/);
  });

  it('the deploy gate names failing tests, and records the verdict on the version', async () => {
    vi.mocked(runAutomationTests).mockResolvedValueOnce({
      passed: 0,
      failed: 1,
      results: [],
    });
    const withTests = {
      ...DOC_EXAMPLE.automation,
      tests: [{ name: 'fails', input: {}, expect: { output: 1 } }],
    };
    const recordTestVerdict = vi.fn(async () => undefined);
    const deploy = vi.fn(async () => ({ name: SAVED, version: 1 }));
    const result = await dispatch(
      'deploy_automation',
      { name: SAVED, version: 1 },
      {
        store: fullStore({
          get: async () => ({ meta: { version: 1 }, automation: withTests }),
          recordTestVerdict,
          deploy,
        }),
      },
    );
    expect(result).toMatchObject({
      code: 'AUTOMATION_TESTS_FAILING',
      hint: expect.stringContaining('report.results'),
      report: { failed: 1 },
    });
    // The refusal is the version's verdict from now on (2026-09-13
    // evaluation, E4-04): the row used to keep `null` after the gate said no.
    expect(recordTestVerdict).toHaveBeenCalledWith(SAVED, 1, false);
    expect(deploy).not.toHaveBeenCalled();
  });

  it('the deploy gate hands a passing run to the store as the verdict', async () => {
    vi.mocked(runAutomationTests).mockResolvedValueOnce({
      passed: 1,
      failed: 0,
      results: [],
    });
    const deploy = vi.fn(async () => ({ name: SAVED, version: 1 }));
    const result = await dispatch(
      'deploy_automation',
      { name: SAVED, version: 1 },
      { store: fullStore({ deploy }) },
    );
    expect(result).toMatchObject({ deployed: { name: SAVED, version: 1 } });
    expect(deploy).toHaveBeenCalledWith(SAVED, 1, { testsPassed: true });
  });

  // The ledger's `duplicate` marker used to be dropped on this door alone:
  // a repeated key read exactly like a fresh start.
  it('run_deployed reports a repeated idempotency key as a duplicate', async () => {
    const result = await dispatch(
      'run_deployed',
      { name: SAVED, idempotencyKey: 'k-1' },
      {
        store: fullStore({
          startRun: async () => ({
            runId: 'run-1',
            version: 1,
            duplicate: true,
          }),
          getRun: async () =>
            // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double: the answer needs only the fields the wait reads
            ({
              runId: 'run-1',
              version: 1,
              status: 'success',
              finishedAt: 1,
            }) as never,
        }),
        allowLive: true,
      },
    );
    expect(result).toMatchObject({
      runId: 'run-1',
      status: 'success',
      duplicate: true,
    });
  });

  it('a live run on a host with no runner is a refusal, not a mock run', async () => {
    const result = await dispatch(
      'run_deployed',
      { name: SAVED },
      {
        store: fullStore({ startRun: undefined, getRun: undefined }),
        allowLive: true,
      },
    );
    expect(result).toMatchObject({
      code: 'LIVE_MODE_UNAVAILABLE',
      hint: expect.any(String),
    });
  });
});

describe('a host refusal is lifted whole', () => {
  it('keeps the host error’s code, hint and data', async () => {
    const hostError = Object.assign(
      new Error('input does not match the inputs schema'),
      {
        code: 'AUTOMATION_INPUT_INVALID',
        hint: 'read data.issues',
        data: { issues: [{ path: 'n', message: 'is required' }] },
      },
    );
    const result = await dispatch(
      'start_run',
      { name: SAVED, input: {} },
      {
        store: fullStore({
          startRun: async () => {
            throw hostError;
          },
        }),
      },
    );
    expect(result).toEqual({
      error: 'input does not match the inputs schema',
      code: 'AUTOMATION_INPUT_INVALID',
      hint: 'read data.issues',
      data: { issues: [{ path: 'n', message: 'is required' }] },
    });
  });

  it('keeps a bare host error a bare sentence', async () => {
    const result = await dispatch(
      'cancel_run',
      { runId: 'r' },
      {
        store: fullStore({
          cancelRun: async () => {
            throw new Error('Project not found.');
          },
        }),
      },
    );
    expect(result).toEqual({ error: 'Project not found.' });
  });

  it('tells a finished run from a missing one on cancel_run (2026-09-18, J8-1)', async () => {
    const finished = await dispatch(
      'cancel_run',
      { runId: 'r' },
      {
        store: fullStore({
          cancelRun: async () => ({ cancelled: false, status: 'success' }),
        }),
      },
    );
    expect(finished).toEqual({
      cancelled: false,
      note: 'the run had already finished — nothing to cancel',
    });

    const missing = await dispatch(
      'cancel_run',
      { runId: 'gone' },
      { store: fullStore({ cancelRun: async () => ({ cancelled: false }) }) },
    );
    expect(missing).toMatchObject({ code: 'RUN_NOT_FOUND' });

    const cancelled = await dispatch(
      'cancel_run',
      { runId: 'r' },
      {
        store: fullStore({
          cancelRun: async () => ({ cancelled: true, status: 'cancelled' }),
        }),
      },
    );
    expect(cancelled).toMatchObject({ cancelled: true });
  });
});

describe('the name-scoped lists refuse an unknown automation', () => {
  it.each([
    ['list_versions', { name: SAVED }, 'versions'],
    ['list_runs', { name: SAVED }, 'runs'],
    ['list_triggers', { name: SAVED }, 'triggers'],
  ])('%s answers the list for a saved name', async (method, params, key) => {
    const result = await dispatch(method, params, { store: fullStore() });
    // list_versions also names the deployed version beside its list.
    expect(result).toMatchObject({ [key]: [] });
  });

  it('list_runs and list_triggers without a name stay organization-wide', async () => {
    const store = fullStore({ get: async () => null });
    expect(await dispatch('list_runs', {}, { store })).toEqual({ runs: [] });
    expect(await dispatch('list_triggers', {}, { store })).toEqual({
      triggers: [],
    });
  });

  // A deleted automation keeps its run history, and the by-name list used
  // to say the automation never existed (2026-09-19 evaluation, K8-5).
  it('list_runs answers the kept runs of a deleted automation by name', async () => {
    const kept = {
      id: 'run-9',
      runId: 'run-9',
      name: 'retired',
      version: 1,
      status: 'success',
    };
    const store = fullStore({
      get: async () => null,
      listRuns: async (args?: { name?: string }) =>
        args?.name === 'retired' ? [kept as never] : [],
    });
    expect(await dispatch('list_runs', { name: 'retired' }, { store })).toEqual(
      { runs: [kept] },
    );
    const unknown = await dispatch('list_runs', { name: 'never' }, { store });
    expect(unknown).toMatchObject({ code: 'AUTOMATION_NOT_FOUND' });
  });
});

/**
 * The MCP door's own words after the 2026-09-19 round-K evaluation (K8-4):
 * a live start of an undeployed version names the tool's own remedies
 * (there is no `mode` on start_run — the mock path is run_automation), and
 * get_catalog narrowed to a core kind says why the list is empty.
 */
describe('the MCP door’s hints name its own tools', () => {
  it('start_run on an undeployed version points at run_automation, not a mode', async () => {
    const store = fullStore({
      startRun: async () => {
        throw Object.assign(
          new Error(
            'Live runs must use the deployed version. Deploy this version or use mock mode.',
          ),
          { code: 'AUTOMATION_VERSION_NOT_DEPLOYED' },
        );
      },
    });
    const result = await dispatch(
      'start_run',
      { name: SAVED, version: 2 },
      { store, allowLive: true },
    );
    expect(result).toMatchObject({
      code: 'AUTOMATION_VERSION_NOT_DEPLOYED',
      error: expect.stringContaining(`${SAVED}@2`),
      hint: expect.stringContaining('run_automation'),
    });
    expect(String(Reflect.get(result as object, 'error'))).not.toContain(
      'mock mode',
    );
  });

  it.each(['transform', 'llm', 'agent', 'subautomation'])(
    'get_catalog {kind: %j} answers the core-kind hint beside its empty list',
    async (kind) => {
      const result = await dispatch(
        'get_catalog',
        { kind, compact: true },
        { store: fullStore() },
      );
      expect(result).toEqual({
        node_types: [],
        hint: `"${kind}" is a core node kind, not a catalog capability — get_docs describes it`,
      });
    },
  );
});

/**
 * A save runs the document's own tests and records the verdict with the
 * version (2026-09-13 evaluation, E4-04): a version saved with failing
 * tests reads `testsPassed: false` from the moment it exists, as the
 * contract promises, where the row used to read `null`. A document without
 * tests records nothing.
 */
describe('save_automation records the save’s own test verdict', () => {
  it('runs the tests and hands the verdict to the store, answering it too', async () => {
    vi.mocked(runAutomationTests).mockClear();
    vi.mocked(runAutomationTests).mockResolvedValueOnce({
      passed: 0,
      failed: 1,
      results: [{ name: 'fails', pass: false }],
    });
    const save = vi.fn(async () => ({ name: SAVED, version: 2 }));
    const result = await dispatch(
      'save_automation',
      { automation: DOC_EXAMPLE.automation, message: 'why' },
      { store: fullStore({ save }) },
    );
    expect(runAutomationTests).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ name: DOC_EXAMPLE.automation.name }),
      'why',
      { testsPassed: false },
    );
    expect(result).toEqual({ name: SAVED, version: 2, testsPassed: false });
  });

  it('records no verdict for a document without tests', async () => {
    vi.mocked(runAutomationTests).mockClear();
    const { tests: _tests, ...untested } = DOC_EXAMPLE.automation;
    const save = vi.fn(async () => ({ name: SAVED, version: 2 }));
    const result = await dispatch(
      'save_automation',
      { automation: untested },
      { store: fullStore({ save }) },
    );
    expect(runAutomationTests).not.toHaveBeenCalled();
    // `message` travels as the empty string dispatch reads an absent one as.
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ name: DOC_EXAMPLE.automation.name }),
      '',
      undefined,
    );
    expect(result).toEqual({ name: SAVED, version: 2 });
  });
});

describe('the MCP door’s run, trigger and version tools after the 2026-09-14 round-h evaluation', () => {
  it('hands start_run’s idempotencyKey to the store and says when the key named an earlier start', async () => {
    const calls: unknown[][] = [];
    const store = fullStore({
      startRun: async (...args: unknown[]) => {
        calls.push(args);
        return { runId: 'run-1', version: 1, duplicate: true };
      },
    });
    const result = (await dispatch(
      'start_run',
      { name: SAVED, input: { n: 1 }, idempotencyKey: 'k-1' },
      { store, allowLive: true },
    )) as { runId: string; duplicate?: boolean; note: string };
    expect(calls[0]?.[5]).toEqual({ idempotencyKey: 'k-1' });
    expect(result).toMatchObject({ runId: 'run-1', duplicate: true });
    expect(result.note).toContain('no new run was started');
    calls.length = 0;
    await dispatch('start_run', { name: SAVED }, { store, allowLive: true });
    expect(calls[0]?.[5]).toBeUndefined();
  });

  it('answers a webhook trigger’s token once, with whether deliveries will run', async () => {
    const store = fullStore({
      setTrigger: async () => ({ token: 'tok-once' }),
      deployedVersion: async () => null,
    });
    const result = (await dispatch(
      'set_trigger',
      { name: SAVED, trigger: { kind: 'webhook' } },
      { store, allowLive: true },
    )) as { ok: boolean; token?: string; deployed: boolean; note: string };
    expect(result).toMatchObject({
      ok: true,
      token: 'tok-once',
      deployed: false,
    });
    expect(result.note).toContain('shown once');
    expect(result.note).toContain('no deployed version');
    const deployed = (await dispatch(
      'set_trigger',
      { name: SAVED, trigger: { kind: 'schedule', cron: '0 3 * * *' } },
      {
        store: fullStore({ setTrigger: async () => undefined }),
        allowLive: true,
      },
    )) as { ok: boolean; token?: string; deployed: boolean };
    expect(deployed).toMatchObject({ ok: true, deployed: true });
    expect(deployed.token).toBeUndefined();
  });

  it('reads the deployed version through get_automation {version: "deployed"}', async () => {
    const live = (await dispatch(
      'get_automation',
      { name: SAVED, version: 'deployed' },
      { store: fullStore(), allowLive: false },
    )) as { meta: { version: number } };
    expect(live.meta.version).toBe(1);
    const none = (await dispatch(
      'get_automation',
      { name: SAVED, version: 'deployed' },
      {
        store: fullStore({ deployedVersion: async () => null }),
        allowLive: false,
      },
    )) as Refusal;
    expect(none.code).toBe('AUTOMATION_VERSION_UNKNOWN');
    expect(none.hint).toContain('deploy_automation');
  });

  it('marks the deployed version in list_versions and names it beside the list', async () => {
    const store = fullStore({
      listVersions: async () => [
        { version: 1, createdBy: 'u', createdAt: 1 },
        { version: 2, createdBy: 'u', createdAt: 2 },
      ],
    });
    const result = (await dispatch(
      'list_versions',
      { name: SAVED },
      { store, allowLive: false },
    )) as {
      deployedVersion: number | null;
      versions: { version: number; deployed: boolean }[];
    };
    expect(result.deployedVersion).toBe(1);
    expect(result.versions.map((row) => [row.version, row.deployed])).toEqual([
      [1, true],
      [2, false],
    ]);
  });
});
