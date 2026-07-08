// @vitest-environment node

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  atomicWrite,
  readFileSafe,
  removeDirSafe,
  removeFileSafe,
} from '../../../../lib/file_io';
import {
  restoreFsTree,
  snapshotFsTree,
} from '../../../framework/snapshot_store';
import type {
  NodeMigrationCtx,
  NodeMigrationHelpers,
} from '../../../framework/types';
import { migration, RETIRED_WORKFLOW_SLUGS } from './index';

const helpers: NodeMigrationHelpers = {
  atomicWrite,
  readFileSafe,
  removeFileSafe,
  removeDirSafe,
  snapshotFsTree,
  restoreFsTree,
};

const ORG = { id: 'org1', slug: 'org1' };
const DIGEST = JSON.stringify({ name: 'Send the daily digest', steps: [] });
const KEEPER = JSON.stringify({ name: 'Run an assigned task', steps: [] });
const TRIAGE = JSON.stringify({ name: 'Triage a new discussion', steps: [] });
const KEEPER_DISCUSSION = JSON.stringify({
  name: 'React to a mention in a discussion',
  steps: [],
});

describe('0.2.90/07 remove_retired_task_workflows', () => {
  let dir: string;
  let mutationCalls: Array<Record<string, unknown>>;
  let actionCalls: Array<Record<string, unknown>>;
  let ctx: NodeMigrationCtx;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'tale-mig-retiredwf-'));
    vi.stubEnv('TALE_CONFIG_DIR', dir);
    mutationCalls = [];
    actionCalls = [];
    ctx = {
      runQuery: async () => null,
      runAction: async (_fn: unknown, args: Record<string, unknown>) => {
        actionCalls.push(args);
        return { provisioned: 0, skipped: 0, failed: 0 };
      },
      runMutation: async (_fn: unknown, args: Record<string, unknown>) => {
        mutationCalls.push(args);
        return { events: 0, schedules: 0, installations: 0, provisions: 0 };
      },
    };
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(dir, { recursive: true, force: true });
  });

  async function seedFiles(): Promise<{
    tasksDir: string;
    discussionsDir: string;
  }> {
    const tasksDir = path.join(dir, ORG.slug, 'workflows', 'projects', 'tasks');
    const discussionsDir = path.join(
      dir,
      ORG.slug,
      'workflows',
      'projects',
      'discussions',
    );
    await mkdir(tasksDir, { recursive: true });
    await mkdir(discussionsDir, { recursive: true });
    await writeFile(
      path.join(tasksDir, 'send-daily-digest.json'),
      DIGEST,
      'utf8',
    );
    await writeFile(
      path.join(tasksDir, 'reassign-paused-agent-work.json'),
      DIGEST,
      'utf8',
    );
    await writeFile(
      path.join(tasksDir, 'run-assigned-task.json'),
      KEEPER,
      'utf8',
    );
    await writeFile(
      path.join(discussionsDir, 'triage-new-discussion.json'),
      TRIAGE,
      'utf8',
    );
    await writeFile(
      path.join(discussionsDir, 'react-to-discussion-mention.json'),
      KEEPER_DISCUSSION,
      'utf8',
    );
    return { tasksDir, discussionsDir };
  }

  it('deletes all three retired files, removes their rows, keeps the rest', async () => {
    const { tasksDir, discussionsDir } = await seedFiles();

    await migration.up(ctx, ORG, helpers);

    expect(
      await readFileSafe(path.join(tasksDir, 'send-daily-digest.json')),
    ).toBeNull();
    expect(
      await readFileSafe(
        path.join(tasksDir, 'reassign-paused-agent-work.json'),
      ),
    ).toBeNull();
    expect(
      await readFileSafe(path.join(tasksDir, 'run-assigned-task.json')),
    ).toBe(KEEPER);
    expect(
      await readFileSafe(
        path.join(discussionsDir, 'triage-new-discussion.json'),
      ),
    ).toBeNull();
    expect(
      await readFileSafe(
        path.join(discussionsDir, 'react-to-discussion-mention.json'),
      ),
    ).toBe(KEEPER_DISCUSSION);
    expect(mutationCalls.map((c) => c.workflowSlug)).toEqual([
      ...RETIRED_WORKFLOW_SLUGS,
    ]);
  });

  it('down restores the files and re-runs the provisioner', async () => {
    const { tasksDir, discussionsDir } = await seedFiles();

    await migration.up(ctx, ORG, helpers);
    await migration.down(ctx, ORG, helpers);

    expect(
      await readFileSafe(path.join(tasksDir, 'send-daily-digest.json')),
    ).toBe(DIGEST);
    expect(
      await readFileSafe(
        path.join(tasksDir, 'reassign-paused-agent-work.json'),
      ),
    ).toBe(DIGEST);
    expect(
      await readFileSafe(
        path.join(discussionsDir, 'triage-new-discussion.json'),
      ),
    ).toBe(TRIAGE);
    expect(actionCalls).toEqual([
      { organizationId: ORG.id, orgSlug: ORG.slug },
    ]);
  });

  it('is idempotent when the files are already gone (rows still purged)', async () => {
    const tasksDir = path.join(dir, ORG.slug, 'workflows', 'projects', 'tasks');
    await mkdir(tasksDir, { recursive: true });
    await writeFile(
      path.join(tasksDir, 'run-assigned-task.json'),
      KEEPER,
      'utf8',
    );

    await migration.up(ctx, ORG, helpers);
    await migration.up(ctx, ORG, helpers);

    expect(
      await readFileSafe(path.join(tasksDir, 'run-assigned-task.json')),
    ).toBe(KEEPER);
    // All three slugs' rows purged on both runs.
    expect(mutationCalls).toHaveLength(6);
  });
});
