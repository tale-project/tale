import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { internal } from '../../../../_generated/api';
import type { Id } from '../../../../_generated/dataModel';
import schema from '../../../../schema';
import { buildModules } from '../../../framework/test_helpers';
import { meta } from './meta';

const DIR = 'migrations/versions/v0_2_89/02_thread_files_absolute_paths';
const modules = buildModules(import.meta.glob('../../../../**/*.*s'), DIR);

const ORG = 'org_tf';
const THREAD = 'thr_1';

type T = ReturnType<typeof convexTest>;

async function insertFile(
  t: T,
  path: string,
  source: 'user_upload' | 'agent_write' | 'run_output',
): Promise<Id<'threadFiles'>> {
  return await t.run(async (ctx) => {
    const storageId = await ctx.storage.store(new Blob(['x']));
    return await ctx.db.insert('threadFiles', {
      organizationId: ORG,
      threadId: THREAD,
      path,
      storageId,
      size: 1,
      contentType: 'text/plain',
      source,
      createdAt: 0,
      updatedAt: 0,
    });
  });
}

describe('0.2.89/01 thread_files_absolute_paths', () => {
  it('up prepends the source root; down strips it', async () => {
    const t = convexTest(schema, modules);
    const id = await insertFile(t, 'report.pptx', 'run_output');

    await t.action(internal.migrations.framework.entrypoints.applyUp, {
      only: [meta.id],
    });
    expect((await t.run((ctx) => ctx.db.get(id)))?.path).toBe(
      '/user/output/report.pptx',
    );

    await t.action(internal.migrations.framework.entrypoints.applyDown, {
      to: '0.2.88',
      only: [meta.id],
    });
    expect((await t.run((ctx) => ctx.db.get(id)))?.path).toBe('report.pptx');
  });

  it('maps each source to its root and is idempotent on absolute paths', async () => {
    const t = convexTest(schema, modules);
    const up = await insertFile(t, 'a.csv', 'user_upload');
    const code = await insertFile(t, 'gen.py', 'agent_write');
    const already = await insertFile(t, '/user/output/x.txt', 'run_output');

    await t.action(internal.migrations.framework.entrypoints.applyUp, {
      only: [meta.id],
    });
    expect((await t.run((ctx) => ctx.db.get(up)))?.path).toBe(
      '/user/uploads/a.csv',
    );
    expect((await t.run((ctx) => ctx.db.get(code)))?.path).toBe(
      '/user/code/gen.py',
    );
    // Already absolute → untouched.
    expect((await t.run((ctx) => ctx.db.get(already)))?.path).toBe(
      '/user/output/x.txt',
    );
  });
});
