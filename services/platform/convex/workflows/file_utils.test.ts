import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resolveAutomationWorkflowHistoryDir } from '../automations/file_utils';
import { resolveWorkflowFilePath } from './file_utils';

// A workflow lives INLINE in its automation's `automation.json` (resolved and
// persisted via `definition_store.ts`) and its edit history under the
// automation's own `.history/`. `resolveWorkflowFilePath` survives ONLY for
// the pre-cutover migration chain (v0_3_4/06, /30), which still operates on
// org trees that carry a legacy `workflows/` dir mid-upgrade — these tests pin
// that legacy path shape so the chain keeps replaying correctly.
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

const legacyWorkflowsDir = (): string =>
  path.join(configRoot, 'default', 'workflows');

describe('legacy workflow path resolution (migration-chain only)', () => {
  it('a foldered slug resolves under org/workflows/ preserving the folder', () => {
    expect(
      resolveWorkflowFilePath('default', 'general/conversation-sync'),
    ).toBe(
      path.join(legacyWorkflowsDir(), 'general', 'conversation-sync.json'),
    );
  });

  it('a flat (single-segment) slug resolves directly under org/workflows/', () => {
    expect(resolveWorkflowFilePath('default', 'my-workflow')).toBe(
      path.join(legacyWorkflowsDir(), 'my-workflow.json'),
    );
  });
});

describe('inline workflow history (the automation owns it)', () => {
  it("nests under the automation's own dir", () => {
    expect(
      resolveAutomationWorkflowHistoryDir('default', 'sync-shopify-products'),
    ).toBe(
      path.join(
        configRoot,
        'default',
        'automations',
        'sync-shopify-products',
        '.history',
      ),
    );
  });
});
