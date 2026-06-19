import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  resolveAppWorkflowsDir,
  resolveHistoryDir,
  resolveWorkflowFilePath,
} from './file_utils';

// Workflow slugs OVERLOAD `/`: global folders (`general/…`) vs an app prefix
// (`issue-desk/…`). So — unlike agents — the app-vs-global decision is made by a
// (sync) on-disk check: a slug `a/b` is app-owned iff `org/apps/a/workflows/`
// exists. The install guard forbids an app slug from shadowing a global folder.
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
const appWorkflowsDir = (app: string): string =>
  path.join(configRoot, 'default', 'apps', app, 'workflows');

async function installAppWorkflowsDir(app: string): Promise<void> {
  await mkdir(appWorkflowsDir(app), { recursive: true });
}

describe('workflow path dispatch (app-owned vs global, by app-dir existence)', () => {
  it('a global folder slug resolves under org/workflows/ when no app dir exists', () => {
    expect(
      resolveWorkflowFilePath('default', 'general/conversation-sync'),
    ).toBe(
      path.join(globalWorkflowsDir(), 'general', 'conversation-sync.json'),
    );
  });

  it('an app-prefixed slug falls back to GLOBAL while the app has no workflows dir', () => {
    expect(resolveWorkflowFilePath('default', 'issue-desk/desk-process')).toBe(
      path.join(globalWorkflowsDir(), 'issue-desk', 'desk-process.json'),
    );
  });

  it('an app-prefixed slug resolves under the app once its workflows dir exists', async () => {
    await installAppWorkflowsDir('issue-desk');
    expect(resolveWorkflowFilePath('default', 'issue-desk/desk-process')).toBe(
      path.join(
        appWorkflowsDir('issue-desk'),
        'issue-desk',
        'desk-process.json',
      ),
    );
  });

  it('a flat (single-segment) slug is never app-owned', () => {
    expect(resolveWorkflowFilePath('default', 'my-workflow')).toBe(
      path.join(globalWorkflowsDir(), 'my-workflow.json'),
    );
  });

  it('history dir follows the app root (flattened slug) once the app dir exists', async () => {
    await installAppWorkflowsDir('issue-desk');
    expect(resolveHistoryDir('default', 'issue-desk/desk-process')).toBe(
      path.join(
        appWorkflowsDir('issue-desk'),
        '.history',
        'issue-desk__desk-process',
      ),
    );
  });

  it('resolveAppWorkflowsDir points under the app bundle', () => {
    expect(resolveAppWorkflowsDir('default', 'issue-desk')).toBe(
      appWorkflowsDir('issue-desk'),
    );
  });
});
