import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resolveHistoryDir, resolveWorkflowFilePath } from './file_utils';

// Workflow files are FILE-based ONLY for standalone org workflows under
// `org/workflows/` — a foldered slug like `general/…` is just a nested dir.
// An automation's single workflow lives INLINE in its `automation.json`
// (resolved/persisted via `definition_store.ts`), never as a file, so path
// resolution is global-only: there is no automation branch.
let configRoot: string;
let prev: string | undefined;

beforeEach(async () => {
  configRoot = await mkdtemp(path.join(tmpdir(), 'wf-fu-test-'));
  prev = process.env.TALE_CONFIG_DIR;
  process.env.TALE_CONFIG_DIR = configRoot;
});

afterEach(async () => {
  if (prev === undefined) delete process.env.TALE_CONFIG_DIR;
  else process.env.TALE_CONFIG_DIR = prev;
  await rm(configRoot, { recursive: true, force: true });
});

const globalWorkflowsDir = (): string =>
  path.join(configRoot, 'default', 'workflows');

describe('workflow path resolution (global org/workflows/ only)', () => {
  it('a foldered slug resolves under org/workflows/ preserving the folder', () => {
    expect(
      resolveWorkflowFilePath('default', 'general/conversation-sync'),
    ).toBe(
      path.join(globalWorkflowsDir(), 'general', 'conversation-sync.json'),
    );
  });

  it('a flat (single-segment) slug resolves directly under org/workflows/', () => {
    expect(resolveWorkflowFilePath('default', 'my-workflow')).toBe(
      path.join(globalWorkflowsDir(), 'my-workflow.json'),
    );
  });

  it('the history dir uses the flattened slug under org/workflows/.history', () => {
    expect(resolveHistoryDir('default', 'general/conversation-sync')).toBe(
      path.join(globalWorkflowsDir(), '.history', 'general__conversation-sync'),
    );
  });
});
