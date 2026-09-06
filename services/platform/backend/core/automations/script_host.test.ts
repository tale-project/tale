// The sandbox.run_script live runner: what it stages, in which order, where
// the entry runs, and how the exec + harvest settle into the declared
// outcome. Every sandbox seam is mocked at its module boundary — the runner
// is choreography over agent_host's staging and session_exec's run/harvest.

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ActionCtx } from '../lib/ctx';

const ensureWorkflowSession = vi.fn();
const resolveRunSkillViewer = vi.fn();
const stageSkillBundle = vi.fn();
const stageWorkflowFiles = vi.fn();

vi.mock('./agent_host', () => ({
  ensureWorkflowSession: (...args: unknown[]) => ensureWorkflowSession(...args),
  resolveRunSkillViewer: (...args: unknown[]) => resolveRunSkillViewer(...args),
  stageSkillBundle: (...args: unknown[]) => stageSkillBundle(...args),
  stageWorkflowFiles: (...args: unknown[]) => stageWorkflowFiles(...args),
}));

const sessionReadFile = vi.fn();
const sessionStageFiles = vi.fn();

vi.mock('../node_only/sandbox/helpers/session_client', () => ({
  sessionReadFile: (...args: unknown[]) => sessionReadFile(...args),
  sessionStageFiles: (...args: unknown[]) => sessionStageFiles(...args),
}));

const runStepsInSession = vi.fn();
const harvestSessionOutput = vi.fn();

vi.mock('../node_only/sandbox/session_exec', () => ({
  OUTPUT_DIR: '/agent/output',
  runStepsInSession: (...args: unknown[]) => runStepsInSession(...args),
  harvestSessionOutput: (...args: unknown[]) => harvestSessionOutput(...args),
}));

import {
  DEFAULT_SCRIPT_TIMEOUT_MS,
  MAX_SCRIPT_TIMEOUT_MS,
  scriptEntryPath,
  workflowScriptRunner,
} from './script_host';

const ctx = {} as unknown as ActionCtx;
const ORG = 'org_1';
const RUN = 'run_1';

function bytesOf(text: string): { bytes: ArrayBuffer; contentType: string } {
  const buf = Buffer.from(text, 'utf8');
  return {
    bytes: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    contentType: 'application/json',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  ensureWorkflowSession.mockResolvedValue('wf-session');
  resolveRunSkillViewer.mockResolvedValue({ kind: 'org' });
  stageSkillBundle.mockResolvedValue(3);
  stageWorkflowFiles.mockResolvedValue({ mounts: [], stagedPaths: [] });
  sessionStageFiles.mockResolvedValue({ staged: [], skipped: [] });
  runStepsInSession.mockResolvedValue({
    status: 'completed',
    exitCode: 0,
    stdout: 'ran',
    stderr: '',
  });
  harvestSessionOutput.mockResolvedValue({
    files: [
      {
        path: '/agent/output/result.json',
        storageId: 's3:orgs/acme/x',
        size: 12,
        contentType: 'application/json',
      },
      {
        path: '/agent/output/report.md',
        storageId: 's3:orgs/acme/y',
        size: 40,
        contentType: 'text/markdown',
      },
    ],
    harvestSkipped: [],
  });
  sessionReadFile.mockResolvedValue(bytesOf('{"verdict":{"passed":true}}'));
});

describe('scriptEntryPath', () => {
  it('confines the entry to the skill bundle', () => {
    expect(scriptEntryPath('swiss-vat', 'scripts/run.py')).toBe(
      '/agent/code/skills/swiss-vat/scripts/run.py',
    );
    expect(scriptEntryPath('swiss-vat', '/scripts/run.py')).toBe(
      '/agent/code/skills/swiss-vat/scripts/run.py',
    );
    for (const bad of ['', '../other/run.py', 'scripts/../../x.py', 'a//b']) {
      expect(() => scriptEntryPath('swiss-vat', bad)).toThrow(
        /inside the skill bundle/,
      );
    }
  });
});

describe('workflowScriptRunner', () => {
  it('stages bundle, mounts and params into the run session, then runs the entry there', async () => {
    const outcome = await workflowScriptRunner(ctx)({
      organizationId: ORG,
      runId: RUN,
      skill: 'swiss-vat',
      entry: 'scripts/run_quarter.py',
      params: { period: '2026Q1' },
      files: { setup: 'folder_1' },
      packages: { python: ['openpyxl'] },
    });

    expect(ensureWorkflowSession).toHaveBeenCalledWith(ctx, ORG, RUN);
    expect(resolveRunSkillViewer).toHaveBeenCalledWith(ctx, ORG, RUN);
    expect(stageSkillBundle).toHaveBeenCalledWith(
      ctx,
      ORG,
      'wf-session',
      'swiss-vat',
      'code/skills/swiss-vat',
      { kind: 'org' },
    );
    expect(stageWorkflowFiles).toHaveBeenCalledWith(
      ctx,
      ORG,
      'wf-session',
      { setup: 'folder_1' },
      'uploads/',
    );
    // params.json is written every run, under /agent/code.
    expect(sessionStageFiles).toHaveBeenCalledWith('wf-session', [
      {
        path: 'code/params.json',
        contentBase64: Buffer.from('{"period":"2026Q1"}').toString('base64'),
      },
    ]);
    expect(runStepsInSession).toHaveBeenCalledWith('wf-session', {
      stepPaths: ['/agent/code/skills/swiss-vat/scripts/run_quarter.py'],
      packagesByLang: { python: ['openpyxl'] },
      timeoutMs: DEFAULT_SCRIPT_TIMEOUT_MS,
    });
    expect(harvestSessionOutput).toHaveBeenCalledWith(ctx, {
      organizationId: ORG,
      sessionId: 'wf-session',
    });
    expect(sessionReadFile).toHaveBeenCalledWith(
      'wf-session',
      '/agent/output/result.json',
    );
    expect(outcome).toMatchObject({
      ok: true,
      status: 'completed',
      exitCode: 0,
      result: { verdict: { passed: true } },
      files: [
        {
          name: 'result.json',
          storageId: 's3:orgs/acme/x',
          size: 12,
          contentType: 'application/json',
        },
        { name: 'report.md', storageId: 's3:orgs/acme/y' },
      ],
      stdoutPreview: 'ran',
      stderrPreview: '',
    });
    expect(outcome.resultError).toBeUndefined();
  });

  it('writes an empty params.json when the node declares none — nothing leaks between nodes', async () => {
    await workflowScriptRunner(ctx)({
      organizationId: ORG,
      runId: RUN,
      skill: 's',
      entry: 'run.py',
    });
    expect(sessionStageFiles).toHaveBeenCalledWith('wf-session', [
      {
        path: 'code/params.json',
        contentBase64: Buffer.from('{}').toString('base64'),
      },
    ]);
  });

  it('clamps the requested timeout into the host bounds', async () => {
    const run = workflowScriptRunner(ctx);
    await run({
      organizationId: ORG,
      runId: RUN,
      skill: 's',
      entry: 'a.py',
      timeoutMs: 10,
    });
    await run({
      organizationId: ORG,
      runId: RUN,
      skill: 's',
      entry: 'a.py',
      timeoutMs: 10_000_000,
    });
    expect(runStepsInSession.mock.calls[0]?.[1]).toMatchObject({
      timeoutMs: 1_000,
    });
    expect(runStepsInSession.mock.calls[1]?.[1]).toMatchObject({
      timeoutMs: MAX_SCRIPT_TIMEOUT_MS,
    });
  });

  it('refuses an entry outside the bundle before touching a session', async () => {
    await expect(
      workflowScriptRunner(ctx)({
        organizationId: ORG,
        runId: RUN,
        skill: 's',
        entry: '../../etc/passwd',
      }),
    ).rejects.toThrow(/inside the skill bundle/);
    expect(ensureWorkflowSession).not.toHaveBeenCalled();
    expect(sessionStageFiles).not.toHaveBeenCalled();
  });

  it('fails when params.json cannot be staged', async () => {
    sessionStageFiles.mockResolvedValue({
      staged: [],
      skipped: [{ path: 'code/params.json', reason: 'quota' }],
    });
    await expect(
      workflowScriptRunner(ctx)({
        organizationId: ORG,
        runId: RUN,
        skill: 's',
        entry: 'a.py',
      }),
    ).rejects.toThrow(
      /staging params\.json failed: code\/params\.json \(quota\)/,
    );
    expect(runStepsInSession).not.toHaveBeenCalled();
  });

  it('reports a failed exec honestly and still harvests what the script wrote', async () => {
    runStepsInSession.mockResolvedValue({
      status: 'failed',
      exitCode: 2,
      stdout: 'partial',
      stderr: 'Traceback…',
      errorCode: 'INSTALL_FAILED',
      errorMessage: 'pip install failed (exit 2)',
    });
    sessionReadFile.mockResolvedValue(null);
    const outcome = await workflowScriptRunner(ctx)({
      organizationId: ORG,
      runId: RUN,
      skill: 's',
      entry: 'a.py',
      output: undefined,
    } as never);
    expect(outcome).toMatchObject({
      ok: false,
      status: 'failed',
      exitCode: 2,
      errorMessage: 'pip install failed (exit 2)',
      resultError: 'the script wrote no result.json',
      stderrPreview: 'Traceback…',
    });
    expect(outcome.result).toBeUndefined();
    expect(harvestSessionOutput).toHaveBeenCalledTimes(1);
  });

  it('reads the declared result file and reports a non-JSON verdict without failing', async () => {
    sessionReadFile.mockResolvedValue({
      bytes: bytesOf('not json').bytes,
      contentType: 'text/plain',
    });
    const outcome = await workflowScriptRunner(ctx)({
      organizationId: ORG,
      runId: RUN,
      skill: 's',
      entry: 'a.py',
      resultFile: 'verdict.json',
    });
    expect(sessionReadFile).toHaveBeenCalledWith(
      'wf-session',
      '/agent/output/verdict.json',
    );
    expect(outcome.ok).toBe(true);
    expect(outcome.result).toBeUndefined();
    expect(outcome.resultError).toMatch(/verdict\.json is not valid JSON/);
  });

  it('passes harvest skips through so a consumer can surface them', async () => {
    harvestSessionOutput.mockResolvedValue({
      files: [],
      harvestSkipped: [{ path: '/agent/output/huge.bin', reason: 'over cap' }],
    });
    const outcome = await workflowScriptRunner(ctx)({
      organizationId: ORG,
      runId: RUN,
      skill: 's',
      entry: 'a.py',
    });
    expect(outcome.files).toEqual([]);
    expect(outcome.harvestSkipped).toEqual([
      { path: '/agent/output/huge.bin', reason: 'over cap' },
    ]);
  });
});
