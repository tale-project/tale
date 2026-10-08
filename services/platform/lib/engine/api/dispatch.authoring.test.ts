import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DISPATCH_REFUSAL_CODES,
  dispatch,
  type DispatchStore,
  type VersionView,
} from './dispatch';
import { DOC_EXAMPLE } from './docs';
import { runAutomationTests } from './tests';

vi.mock('./tests', () => ({ runAutomationTests: vi.fn() }));

/**
 * The authoring calls a coding agent makes through the method table, held
 * to what the editor does: a save as complete as the editor's, a version
 * read in full, a deploy that can name what it replaces, a delete, mock
 * starts of any saved version, and the run, ask, version and installation
 * management beside them. The store behind it is a double; what the host
 * does with each request is the store's own tests'.
 */

const NAME = 'billing/dunning';
const DOC = { ...DOC_EXAMPLE.automation, name: NAME };

/** A full store holding `billing/dunning` at v7, v5 deployed. */
function store(overrides: Partial<DispatchStore> = {}): DispatchStore {
  return {
    list: async () => [],
    get: async (name: string, version?: number) =>
      name === NAME && (version === undefined || version <= 7)
        ? { meta: { version: version ?? 7 }, automation: DOC }
        : null,
    deployedVersion: async (name: string) => (name === NAME ? 5 : null),
    save: async () => ({ name: NAME, version: 8, carried: [] }),
    deploy: async (name: string, version: number) => ({
      name,
      version,
      previousVersion: 5,
    }),
    startRun: async (_name, _input, _mode, version) => ({
      runId: 'run-1',
      version: version ?? 5,
    }),
    listRuns: async () => [],
    getRun: async () => null,
    listVersions: async () => [],
    listTriggers: async () => [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(runAutomationTests).mockReset();
  vi.mocked(runAutomationTests).mockResolvedValue({
    passed: 1,
    failed: 0,
    results: [{ name: 'ok', pass: true }],
  });
});

describe('save_automation', () => {
  it('hands the store every field of the editor’s save, and only the version fields the call named [MCP-R1]', async () => {
    const save = vi.fn(async () => ({
      name: NAME,
      version: 8,
      carried: ['settings', 'presentation'],
    }));
    const result = await dispatch(
      'save_automation',
      {
        automation: DOC,
        message: 'add a reminder',
        baseVersion: 7,
        create: false,
        projectId: 'p-1',
        taskContract: { workflow: NAME },
      },
      { store: store({ save }) },
    );
    expect(save).toHaveBeenCalledWith(DOC, 'add a reminder', {
      testsPassed: true,
      baseVersion: 7,
      projectId: 'p-1',
      metadata: { taskContract: { workflow: NAME } },
    });
    // The agent sees what the host kept from v7 because it left it out.
    expect(result).toMatchObject({
      name: NAME,
      version: 8,
      carried: ['settings', 'presentation'],
      baseVersionChecked: true,
    });
  });

  it('passes a cleared field as null, never as left out', async () => {
    const save = vi.fn(async () => ({ name: NAME, version: 8 }));
    await dispatch(
      'save_automation',
      { automation: DOC, settings: null },
      { store: store({ save }) },
    );
    expect(save).toHaveBeenCalledWith(DOC, '', {
      testsPassed: true,
      metadata: { settings: null },
    });
  });

  it("refuses Ada's save that started from v5 after Ben saved v6, naming v6 and how to merge [MCP-R2]", async () => {
    const save = vi.fn(async () => {
      throw Object.assign(new Error('v6 of … Reload to see it'), {
        code: 'AUTOMATION_VERSION_STALE',
        status: 409,
        data: { latestVersion: 6, baseVersion: 5 },
      });
    });
    const result = await dispatch(
      'save_automation',
      { automation: DOC, baseVersion: 5 },
      { store: store({ save }) },
    );
    expect(result).toEqual({
      error: `v6 of "${NAME}" was saved after your edit started from v5`,
      code: 'AUTOMATION_VERSION_STALE',
      hint: `get_automation {name: "${NAME}"} reads v6; merge your change into it and save again with baseVersion: 6`,
      data: { latestVersion: 6, baseVersion: 5 },
    });
  });

  it('refuses a create-only save of a taken name with a hint, as data', async () => {
    const save = vi.fn(async () => {
      throw Object.assign(new Error('An automation named … already exists'), {
        code: 'AUTOMATION_NAME_TAKEN',
        status: 409,
      });
    });
    const result = await dispatch(
      'save_automation',
      { automation: DOC, create: true },
      { store: store({ save }) },
    );
    expect(result).toMatchObject({
      code: 'AUTOMATION_NAME_TAKEN',
      hint: expect.stringContaining('leave create out'),
    });
  });
});

describe('get_automation on a host that keeps the version’s metadata', () => {
  const view: VersionView = {
    name: NAME,
    version: 6,
    latestVersion: 7,
    deployedVersion: 6,
    document: DOC,
    settings: { forms: [] },
    taskContract: null,
    presentation: { name: 'Dunning' },
    message: 'reminder',
    testsPassed: true,
    testsCheckedAt: 1,
    createdBy: 'api-key:user_ada',
    createdAt: 2,
    createdVia: 'mcp',
    clientName: 'Claude Code',
    projectIds: ['p-1'],
    trigger: null,
  };

  it('answers the document under the keys every client reads, and the version around it', async () => {
    const getVersionView = vi.fn(async () => view);
    const result = await dispatch(
      'get_automation',
      { name: NAME, version: 'deployed' },
      { store: store({ getVersionView, deployedVersion: async () => 6 }) },
    );
    expect(getVersionView).toHaveBeenCalledWith(NAME, 6);
    const { document: _document, ...rest } = view;
    expect(result).toEqual({
      meta: { version: 6 },
      automation: DOC,
      ...rest,
      deployed: true,
    });
  });

  it('refuses a version that does not exist, and a name that does not', async () => {
    const getVersionView = vi.fn(async () => null);
    const s = store({ getVersionView });
    expect(
      await dispatch(
        'get_automation',
        { name: NAME, version: 9 },
        { store: s },
      ),
    ).toMatchObject({ code: 'AUTOMATION_VERSION_UNKNOWN' });
    expect(
      await dispatch('get_automation', { name: 'never' }, { store: s }),
    ).toMatchObject({ code: 'AUTOMATION_NOT_FOUND' });
  });
});

describe('test_automation of a saved version', () => {
  it('tests the version and records its verdict on it', async () => {
    vi.mocked(runAutomationTests).mockResolvedValueOnce({
      passed: 0,
      failed: 1,
      results: [{ name: 'fails', pass: false }],
    });
    const recordTestVerdict = vi.fn(async () => {});
    const result = await dispatch(
      'test_automation',
      { name: NAME, version: 6 },
      { store: store({ recordTestVerdict }) },
    );
    expect(recordTestVerdict).toHaveBeenCalledWith(NAME, 6, false);
    expect(result).toMatchObject({ name: NAME, version: 6, failed: 1 });
  });

  it('records nothing for a version without tests', async () => {
    const { tests: _tests, ...untested } = DOC;
    const recordTestVerdict = vi.fn(async () => {});
    await dispatch(
      'test_automation',
      { name: NAME },
      {
        store: store({
          recordTestVerdict,
          get: async () => ({ meta: { version: 7 }, automation: untested }),
        }),
      },
    );
    expect(recordTestVerdict).not.toHaveBeenCalled();
  });

  it('refuses a draft and a name together, and neither', async () => {
    for (const params of [{ automation: DOC, name: NAME }, {}]) {
      expect(
        await dispatch('test_automation', params, { store: store() }),
      ).toMatchObject({ code: 'INVALID_PARAMS' });
    }
  });
});

describe('deploy_automation', () => {
  it('names the version it expects to replace, and answers what was live before [MCP-R3]', async () => {
    const deploy = vi.fn(async (name: string, version: number) => ({
      name,
      version,
      previousVersion: 5,
    }));
    const result = await dispatch(
      'deploy_automation',
      { name: NAME, version: 7, expectedDeployedVersion: 5 },
      { store: store({ deploy }) },
    );
    expect(deploy).toHaveBeenCalledWith(NAME, 7, {
      testsPassed: true,
      expectedDeployedVersion: 5,
    });
    expect(result).toMatchObject({
      deployed: { name: NAME, version: 7 },
      previousVersion: 5,
      note: expect.stringContaining('v5 was live before'),
    });
  });

  it("refuses Ada's deploy when Ben put v6 live meanwhile, with what to read [MCP-R3]", async () => {
    const deploy = vi.fn(async () => {
      throw Object.assign(new Error('v6 of … is live now'), {
        code: 'AUTOMATION_DEPLOYMENT_STALE',
        status: 409,
        data: { deployedVersion: 6 },
      });
    });
    const result = await dispatch(
      'deploy_automation',
      { name: NAME, version: 7, expectedDeployedVersion: 5 },
      { store: store({ deploy }) },
    );
    expect(result).toMatchObject({
      code: 'AUTOMATION_DEPLOYMENT_STALE',
      data: { deployedVersion: 6 },
      hint: expect.stringContaining('expectedDeployedVersion'),
    });
  });

  it('refuses an expected version that is not a whole number or null', async () => {
    expect(
      await dispatch(
        'deploy_automation',
        { name: NAME, version: 7, expectedDeployedVersion: 'five' },
        { store: store() },
      ),
    ).toMatchObject({ code: 'INVALID_PARAMS' });
  });
});

describe('delete_automation', () => {
  it('deletes against the latest version the caller read', async () => {
    const deleteAutomation = vi.fn(async () => ({ versions: 7 }));
    const result = await dispatch(
      'delete_automation',
      { name: NAME, expectedLatestVersion: 7 },
      { store: store({ deleteAutomation }) },
    );
    expect(deleteAutomation).toHaveBeenCalledWith(NAME, 7);
    expect(result).toMatchObject({ deleted: true, name: NAME, versions: 7 });
  });

  it('refuses an unknown name, and lifts the store’s refusals with a hint', async () => {
    const deleteAutomation = vi.fn(async () => {
      throw Object.assign(new Error('A run of … is still running'), {
        code: 'AUTOMATION_HAS_ACTIVE_RUNS',
        status: 409,
      });
    });
    const s = store({ deleteAutomation });
    expect(
      await dispatch(
        'delete_automation',
        { name: 'never', expectedLatestVersion: 1 },
        { store: s },
      ),
    ).toMatchObject({ code: 'AUTOMATION_NOT_FOUND' });
    expect(
      await dispatch(
        'delete_automation',
        { name: NAME, expectedLatestVersion: 7 },
        { store: s },
      ),
    ).toMatchObject({
      code: 'AUTOMATION_HAS_ACTIVE_RUNS',
      hint: expect.stringContaining('cancel_run'),
    });
  });
});

describe('start_run', () => {
  it("starts Mia's mock run of the latest saved version — not the deployed one [MCP-R4]", async () => {
    const startRun = vi.fn(async () => ({ runId: 'run-1', version: 7 }));
    const result = await dispatch(
      'start_run',
      { name: NAME, mode: 'mock' },
      { store: store({ startRun }), allowLive: true },
    );
    expect(startRun).toHaveBeenCalledWith(
      NAME,
      {},
      'mock',
      7,
      undefined,
      undefined,
    );
    expect(result).toMatchObject({ runId: 'run-1', version: 7, mode: 'mock' });
  });

  it('starts the deployed version live by default on a host that runs live [MCP-R4]', async () => {
    const startRun = vi.fn(async () => ({ runId: 'run-1', version: 5 }));
    const result = await dispatch(
      'start_run',
      { name: NAME },
      { store: store({ startRun }), allowLive: true },
    );
    expect(startRun).toHaveBeenCalledWith(
      NAME,
      {},
      'live',
      undefined,
      undefined,
      undefined,
    );
    expect(result).toMatchObject({ mode: 'live' });
  });

  it('refuses a live start where the host does not run live', async () => {
    expect(
      await dispatch(
        'start_run',
        { name: NAME, mode: 'live' },
        { store: store() },
      ),
    ).toMatchObject({ code: 'LIVE_MODE_UNAVAILABLE' });
  });
});

describe('list_runs pages', () => {
  it('hands the filters and the cursor to the store and answers its nextCursor', async () => {
    const listRunsPage = vi.fn(async () => ({ runs: [], nextCursor: 'c2' }));
    const result = await dispatch(
      'list_runs',
      {
        name: NAME,
        limit: 10,
        mode: 'mock',
        statuses: ['failed'],
        cursor: 'c1',
      },
      { store: store({ listRunsPage }) },
    );
    expect(listRunsPage).toHaveBeenCalledWith({
      name: NAME,
      limit: 10,
      mode: 'mock',
      statuses: ['failed'],
      cursor: 'c1',
    });
    expect(result).toEqual({ runs: [], nextCursor: 'c2' });
  });

  it('refuses a cursor the listing did not answer', async () => {
    const result = await dispatch(
      'list_runs',
      { cursor: 'forged' },
      { store: store({ listRunsPage: async () => null }) },
    );
    expect(result).toMatchObject({ code: 'INVALID_CURSOR' });
    expect(DISPATCH_REFUSAL_CODES).toContain('INVALID_CURSOR');
  });
});

describe('list_versions', () => {
  it('answers when each version went live beside the history', async () => {
    const deployments = [
      {
        version: 5,
        previousVersion: 4,
        deployedAt: 3,
        deployedBy: 'user_ben',
        via: null,
      },
    ];
    const result = await dispatch(
      'list_versions',
      { name: NAME },
      { store: store({ listDeployments: async () => deployments }) },
    );
    expect(result).toEqual({ deployedVersion: 5, versions: [], deployments });
  });
});

describe('set_automation_projects', () => {
  it('installs and removes in one call', async () => {
    const setAutomationProjects = vi.fn(async () => ({
      added: ['p-2'],
      removed: ['p-1'],
      unchanged: [],
    }));
    const result = await dispatch(
      'set_automation_projects',
      { name: NAME, add: ['p-2'], remove: ['p-1'] },
      { store: store({ setAutomationProjects }) },
    );
    expect(setAutomationProjects).toHaveBeenCalledWith(NAME, {
      add: ['p-2'],
      remove: ['p-1'],
    });
    expect(result).toEqual({
      name: NAME,
      added: ['p-2'],
      removed: ['p-1'],
      unchanged: [],
    });
  });

  it('refuses a call that changes nothing, and a project it is not installed in', async () => {
    const setAutomationProjects = vi.fn(async () => {
      throw Object.assign(new Error('not installed'), {
        code: 'AUTOMATION_NOT_INSTALLED',
        status: 404,
        data: { projectId: 'p-9' },
      });
    });
    const s = store({ setAutomationProjects });
    expect(
      await dispatch('set_automation_projects', { name: NAME }, { store: s }),
    ).toMatchObject({ code: 'INVALID_PARAMS' });
    expect(
      await dispatch(
        'set_automation_projects',
        { name: NAME, remove: ['p-9'] },
        { store: s },
      ),
    ).toMatchObject({
      code: 'AUTOMATION_NOT_INSTALLED',
      data: { projectId: 'p-9' },
      hint: expect.stringContaining('projectIds'),
    });
  });
});

describe('answer_run_ask', () => {
  it('answers the question and says the run resumes', async () => {
    const answerAsk = vi.fn(async () => ({
      runId: 'run-1',
      askId: 'ask-1',
      taskId: null,
    }));
    const result = await dispatch(
      'answer_run_ask',
      { runId: 'run-1', askId: 'ask-1', answer: '  Yes, send it.  ' },
      { store: store({ answerAsk }) },
    );
    expect(answerAsk).toHaveBeenCalledWith('run-1', 'ask-1', 'Yes, send it.');
    expect(result).toMatchObject({ answered: true, runId: 'run-1' });
  });

  it('refuses a blank answer and lifts the store’s refusals with a hint', async () => {
    const answerAsk = vi.fn(async () => {
      throw Object.assign(new Error('this question was already answered'), {
        code: 'HUMAN_ASK_NOT_PENDING',
        status: 409,
      });
    });
    const s = store({ answerAsk });
    expect(
      await dispatch(
        'answer_run_ask',
        { runId: 'run-1', askId: 'ask-1', answer: '   ' },
        { store: s },
      ),
    ).toMatchObject({ code: 'EMPTY_ANSWER' });
    expect(answerAsk).not.toHaveBeenCalled();
    expect(
      await dispatch(
        'answer_run_ask',
        { runId: 'run-1', askId: 'ask-1', answer: 'Yes' },
        { store: s },
      ),
    ).toMatchObject({
      code: 'HUMAN_ASK_NOT_PENDING',
      hint: expect.stringContaining('get_run'),
    });
  });
});
