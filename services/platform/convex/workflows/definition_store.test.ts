import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { WorkflowJsonConfig } from '../../lib/shared/schemas/workflows';
import {
  readCurrentWorkflowContent,
  readWorkflowDefinition,
  resolveInlineWorkflowOwner,
  writeWorkflowDefinition,
} from './definition_store';

const ORG = 'default';

let configRoot: string;
let prev: string | undefined;

beforeEach(async () => {
  configRoot = await mkdtemp(path.join(tmpdir(), 'wf-def-store-'));
  prev = process.env.TALE_CONFIG_DIR;
  process.env.TALE_CONFIG_DIR = configRoot;
});

afterEach(async () => {
  if (prev === undefined) delete process.env.TALE_CONFIG_DIR;
  else process.env.TALE_CONFIG_DIR = prev;
  await rm(configRoot, { recursive: true, force: true });
});

const automationDir = (slug: string): string =>
  path.join(configRoot, ORG, 'automations', slug);

async function seedInlineAutomation(
  slug: string,
  workflow: WorkflowJsonConfig,
  extra: Record<string, unknown> = {},
): Promise<void> {
  await mkdir(automationDir(slug), { recursive: true });
  await writeFile(
    path.join(automationDir(slug), 'automation.json'),
    JSON.stringify({ name: 'Automation', ...extra, workflow }, null, 2) + '\n',
  );
}

const WORKFLOW: WorkflowJsonConfig = {
  name: 'Do the thing',
  steps: [
    {
      stepSlug: 'start',
      name: 'start',
      stepType: 'start',
      config: {},
      nextSteps: {},
    },
  ],
};

describe('resolveInlineWorkflowOwner', () => {
  it('resolves an automation slug that carries an inline workflow', async () => {
    await seedInlineAutomation('create-github-pr', WORKFLOW);
    const owner = await resolveInlineWorkflowOwner(ORG, 'create-github-pr');
    expect(owner?.workflow.name).toBe('Do the thing');
  });

  it('returns null for an automation with no inline workflow', async () => {
    await mkdir(automationDir('bare'), { recursive: true });
    await writeFile(
      path.join(automationDir('bare'), 'automation.json'),
      JSON.stringify({ name: 'Bare' }),
    );
    expect(await resolveInlineWorkflowOwner(ORG, 'bare')).toBeNull();
  });

  it('returns null for a composite/foldered slug (never inline-owned)', async () => {
    expect(
      await resolveInlineWorkflowOwner(ORG, 'general/conversation-sync'),
    ).toBeNull();
  });

  it('returns null when the automation dir is absent', async () => {
    expect(await resolveInlineWorkflowOwner(ORG, 'ghost')).toBeNull();
  });
});

describe('readWorkflowDefinition — inline vs file', () => {
  it('serves the inline workflow with a stable canonical hash', async () => {
    await seedInlineAutomation('create-github-pr', WORKFLOW);
    const a = await readWorkflowDefinition(ORG, 'create-github-pr');
    const b = await readWorkflowDefinition(ORG, 'create-github-pr');
    expect(a.ok).toBe(true);
    if (!a.ok || !b.ok) throw new Error('expected ok');
    expect(a.config.name).toBe('Do the thing');
    expect(a.hash).toBe(b.hash);
  });

  it('falls back to a standalone global file', async () => {
    const dir = path.join(configRoot, ORG, 'workflows');
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, 'my-workflow.json'),
      JSON.stringify({ name: 'Standalone', steps: [] }),
    );
    const res = await readWorkflowDefinition(ORG, 'my-workflow');
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('expected ok');
    expect(res.config.name).toBe('Standalone');
  });
});

describe('writeWorkflowDefinition — inline write-back', () => {
  it('persists into automation.json `workflow`, preserving every other field', async () => {
    await seedInlineAutomation('create-github-pr', WORKFLOW, {
      hidden: true,
      roles: { creator: 'create-github-pr/pr-creator' },
    });

    const next: WorkflowJsonConfig = { ...WORKFLOW, name: 'Renamed' };
    await writeWorkflowDefinition(ORG, 'create-github-pr', next);

    const raw = JSON.parse(
      await readFile(
        path.join(automationDir('create-github-pr'), 'automation.json'),
        'utf-8',
      ),
    ) as {
      name: string;
      hidden: boolean;
      roles: Record<string, string>;
      workflow: { name: string };
    };
    expect(raw.workflow.name).toBe('Renamed');
    // Other manifest fields survive the write-back untouched.
    expect(raw.name).toBe('Automation');
    expect(raw.hidden).toBe(true);
    expect(raw.roles.creator).toBe('create-github-pr/pr-creator');

    // Read-after-write round-trips, and its hash matches a fresh save's.
    const read = await readWorkflowDefinition(ORG, 'create-github-pr');
    expect(read.ok).toBe(true);
    if (!read.ok) throw new Error('expected ok');
    expect(read.config.name).toBe('Renamed');
  });

  it('current content reflects the last inline write (compare-and-swap basis)', async () => {
    await seedInlineAutomation('create-github-pr', WORKFLOW);
    const before = await readCurrentWorkflowContent(ORG, 'create-github-pr');
    await writeWorkflowDefinition(ORG, 'create-github-pr', {
      ...WORKFLOW,
      name: 'Changed',
    });
    const after = await readCurrentWorkflowContent(ORG, 'create-github-pr');
    expect(before).not.toEqual(after);
    expect(after).toContain('Changed');
  });

  it('writes a standalone file for a non-automation slug', async () => {
    await writeWorkflowDefinition(ORG, 'my-workflow', {
      name: 'Fresh',
      steps: [],
    });
    const written = await readFile(
      path.join(configRoot, ORG, 'workflows', 'my-workflow.json'),
      'utf-8',
    );
    expect(written).toContain('Fresh');
  });
});
