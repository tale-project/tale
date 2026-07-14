import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  resolveAgentFilePath,
  resolveAutomationAgentsDir,
  resolveHistoryDir,
} from './file_utils';
import { validateAgentName } from './validators';

// Agent identities are either a flat GLOBAL name (`coder`, under `org/agents/`)
// or an automation-owned COMPOSITE `<slug>/<name>` (`issue-desk/desk-coordinator`, under
// `org/automations/<slug>/agents/`). A `/` is UNAMBIGUOUS for agents — they are flat by
// default — so the dispatch is purely lexical (no fs check, unlike workflows).
let configRoot: string;
let prev: string | undefined;

beforeEach(async () => {
  configRoot = await mkdtemp(path.join(tmpdir(), 'agent-fu-test-'));
  prev = process.env.TALE_CONFIG_DIR;
  process.env.TALE_CONFIG_DIR = configRoot;
});

afterEach(async () => {
  if (prev === undefined) delete process.env.TALE_CONFIG_DIR;
  else process.env.TALE_CONFIG_DIR = prev;
  await rm(configRoot, { recursive: true, force: true });
});

const globalAgentsDir = (): string =>
  path.join(configRoot, 'default', 'agents');
const automationAgentsDir = (slug: string): string =>
  path.join(configRoot, 'default', 'automations', slug, 'agents');

describe('validateAgentName (flat global OR composite app-owned)', () => {
  it('accepts a flat global name', () => {
    expect(validateAgentName('coder')).toBe(true);
    expect(validateAgentName('chat-agent')).toBe(true);
  });

  it('accepts a composite <automationSlug>/<name>', () => {
    expect(validateAgentName('issue-desk/desk-coordinator')).toBe(true);
  });

  it('accepts a composite over a NESTED automation slug', () => {
    // An automation slug is a path, so the agent name is the LAST segment and
    // everything before it is the automation it belongs to.
    expect(validateAgentName('github/create-pull-requests/pr-creator')).toBe(
      true,
    );
    // The automation half is capped at 4 segments; a 5th makes it invalid.
    expect(validateAgentName('a/b/c/d/agent')).toBe(true);
    expect(validateAgentName('a/b/c/d/e/agent')).toBe(false);
  });

  it('rejects traversal / malformed segments', () => {
    expect(validateAgentName('issue-desk/../escape')).toBe(false);
    expect(validateAgentName('../escape')).toBe(false);
    expect(validateAgentName('Issue-Desk/x')).toBe(false); // app slug must be lowercase
    expect(validateAgentName('issue-desk/')).toBe(false);
    expect(validateAgentName('/desk-coordinator')).toBe(false);
  });
});

describe('agent path dispatch (flat → global dir, composite → app dir)', () => {
  it('flat slug resolves under org/agents/', () => {
    expect(resolveAgentFilePath('default', 'coder')).toBe(
      path.join(globalAgentsDir(), 'coder.json'),
    );
  });

  it('composite slug resolves under org/automations/<slug>/agents/', () => {
    expect(resolveAgentFilePath('default', 'issue-desk/desk-coordinator')).toBe(
      path.join(automationAgentsDir('issue-desk'), 'desk-coordinator.json'),
    );
  });

  it('resolveAutomationAgentsDir points under the app bundle', () => {
    expect(resolveAutomationAgentsDir('default', 'issue-desk')).toBe(
      automationAgentsDir('issue-desk'),
    );
  });

  it('history dir follows the same root, with the bare name as final segment', () => {
    expect(resolveHistoryDir('default', 'coder')).toBe(
      path.join(globalAgentsDir(), '.history', 'coder'),
    );
    expect(resolveHistoryDir('default', 'issue-desk/desk-coordinator')).toBe(
      path.join(
        automationAgentsDir('issue-desk'),
        '.history',
        'desk-coordinator',
      ),
    );
  });

  it('rejects an invalid composite name before building a path', () => {
    expect(() =>
      resolveAgentFilePath('default', 'issue-desk/../escape'),
    ).toThrow();
  });
});
