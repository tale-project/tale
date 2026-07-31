import { describe, expect, it, vi } from 'vitest';

import type { NativeConnectorContext } from '../dispatcher';
import {
  sandboxScriptNatives,
  type SandboxScriptRunner,
} from './sandbox-script';

function ctxWith(
  caller: NativeConnectorContext['caller'],
): NativeConnectorContext {
  const notReached = (): never => {
    throw new Error('the script native performs no HTTP');
  };
  return {
    organizationId: 'org_scripts',
    credentialId: 'platform',
    authMethod: 'platform',
    caller,
    secrets: { get: () => '' },
    idempotencyKey: 'run_1:node_1:0',
    config: {},
    http: {
      get: notReached,
      post: notReached,
      put: notReached,
      patch: notReached,
      delete: notReached,
    },
    base64Encode: (value: string) => Buffer.from(value).toString('base64'),
    base64Decode: (value: string) =>
      Buffer.from(value, 'base64').toString('utf8'),
  };
}

const OUTCOME = {
  ok: true,
  status: 'completed',
  files: [],
  exitCode: 0,
  stdoutPreview: '',
  stderrPreview: '',
  durationMs: 1,
};

describe('sandbox.run_script native rim', () => {
  it('refuses input that does not match the schema, naming the field', async () => {
    const runner = vi.fn<SandboxScriptRunner>();
    const impl = sandboxScriptNatives(runner)['sandbox.run_script'];
    await expect(
      impl(
        { entry: 'run.py' },
        ctxWith({ kind: 'workflow', runId: 'r', nodeId: 'n' }),
      ),
    ).rejects.toMatchObject({
      code: 'INPUT_INVALID',
      message: expect.stringContaining('skill'),
    });
    expect(runner).not.toHaveBeenCalled();
  });

  it('runs only for a workflow caller — the run owns the session', async () => {
    const runner = vi.fn<SandboxScriptRunner>();
    const impl = sandboxScriptNatives(runner)['sandbox.run_script'];
    await expect(
      impl(
        { skill: 'cascadia-levy-return', entry: 'scripts/run_quarter.py' },
        ctxWith({ kind: 'user', userId: 'u_1' }),
      ),
    ).rejects.toMatchObject({
      code: 'INPUT_INVALID',
      message: expect.stringContaining('automation run'),
    });
    expect(runner).not.toHaveBeenCalled();
  });

  it('hands the runner the parsed run with the dispatch-bound org and run', async () => {
    const runner = vi.fn<SandboxScriptRunner>(async () => OUTCOME);
    const impl = sandboxScriptNatives(runner)['sandbox.run_script'];
    const output = await impl(
      {
        skill: 'cascadia-levy-return',
        entry: 'scripts/run_quarter.py',
        params: { period: '2026Q1', fxRefresh: false },
        files: { input: 'fld_1', setup: { folderPath: 'Setup' } },
        output: { resultFile: 'result.json' },
        timeoutMs: 60_000,
      },
      ctxWith({ kind: 'workflow', runId: 'run_9', nodeId: 'pipeline' }),
    );
    expect(output).toEqual(OUTCOME);
    expect(runner).toHaveBeenCalledWith({
      organizationId: 'org_scripts',
      runId: 'run_9',
      skill: 'cascadia-levy-return',
      entry: 'scripts/run_quarter.py',
      params: { period: '2026Q1', fxRefresh: false },
      files: { input: 'fld_1', setup: { folderPath: 'Setup' } },
      resultFile: 'result.json',
      timeoutMs: 60_000,
    });
  });
});
