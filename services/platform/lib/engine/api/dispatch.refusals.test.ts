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

  it('the deploy gate names failing tests', async () => {
    vi.mocked(runAutomationTests).mockResolvedValueOnce({
      passed: 0,
      failed: 1,
      results: [],
    });
    const withTests = {
      ...DOC_EXAMPLE.automation,
      tests: [{ name: 'fails', input: {}, expect: { output: 1 } }],
    };
    const result = await dispatch(
      'deploy_automation',
      { name: SAVED, version: 1 },
      {
        store: fullStore({
          get: async () => ({ meta: { version: 1 }, automation: withTests }),
        }),
      },
    );
    expect(result).toMatchObject({
      code: 'AUTOMATION_TESTS_FAILING',
      hint: expect.stringContaining('report.results'),
      report: { failed: 1 },
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
});

describe('the name-scoped lists refuse an unknown automation', () => {
  it.each([
    ['list_versions', { name: SAVED }, 'versions'],
    ['list_runs', { name: SAVED }, 'runs'],
    ['list_triggers', { name: SAVED }, 'triggers'],
  ])('%s answers the list for a saved name', async (method, params, key) => {
    const result = await dispatch(method, params, { store: fullStore() });
    expect(result).toEqual({ [key]: [] });
  });

  it('list_runs and list_triggers without a name stay organization-wide', async () => {
    const store = fullStore({ get: async () => null });
    expect(await dispatch('list_runs', {}, { store })).toEqual({ runs: [] });
    expect(await dispatch('list_triggers', {}, { store })).toEqual({
      triggers: [],
    });
  });
});
