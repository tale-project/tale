// The projects machine door, driven end-to-end through a real convex-test
// backend: the internal create-project twin shares the session core
// (duplicate/blank externalItemId, editor gate), folders get-or-create is
// scope-safe, and the bind flow writes a project file whose RAG opt-out
// DEFAULTS the door to "never index" — asserted against the REAL scheduler
// (`_scheduled_functions`), the same drain-proof style as
// documents/create_document_from_upload_rag_skip.test.ts.

import rateLimiterComponent from '@convex-dev/rate-limiter/test';
import { convexTest, type TestConvex } from 'convex-test';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import betterAuthSchema from '../betterAuth/schema';
import schema from '../schema';

const TEST_DIR_FROM_CONVEX_ROOT = 'projects';
function toConvexRootKey(globKey: string): string {
  const stack: string[] = [];
  for (const part of `${TEST_DIR_FROM_CONVEX_ROOT}/${globKey}`.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  return stack.join('/');
}
const rawModules = import.meta.glob('../**/*.*s');
const modules: Record<string, () => Promise<unknown>> = {};
for (const [key, loader] of Object.entries(rawModules)) {
  modules[toConvexRootKey(key)] = loader;
}
const authModules = import.meta.glob('../betterAuth/**/*.*s');

const ORG = 'org_machine_door';
const OTHER_ORG = 'org_machine_door_b';
const EDITOR = 'u_door_editor';
const MEMBER = 'u_door_member';

type T = TestConvex<typeof schema>;
const testBackends = new Set<T>();

beforeAll(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await Promise.all(
    [...testBackends].map((t) => t.finishInProgressScheduledFunctions()),
  );
  testBackends.clear();
});

function makeT(): T {
  const t = convexTest(schema, modules);
  rateLimiterComponent.register(t);
  t.registerComponent('betterAuth', betterAuthSchema, authModules);
  testBackends.add(t);
  return t;
}

async function seedMember(
  t: T,
  userId: string,
  organizationId: string,
  role: string,
): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert('memberMirror', {
      memberId: `m_${userId}_${organizationId}`,
      userId,
      organizationId,
      role,
      createdAt: 0,
    });
  });
}

async function seedWorld(t: T): Promise<void> {
  await seedMember(t, EDITOR, ORG, 'editor');
  await seedMember(t, MEMBER, ORG, 'member');
}

async function createProject(
  t: T,
  extra: Record<string, unknown> = {},
): Promise<{ id: Id<'projects'>; name: string; key?: string }> {
  return t.mutation(internal.projects.internal_mutations.createProjectForUser, {
    organizationId: ORG,
    userId: EDITOR,
    userEmail: 'editor@door.test',
    name: 'Acme Books',
    ...extra,
  });
}

async function createFolder(
  t: T,
  projectId: string,
  name: string,
  parentId?: string,
): Promise<{ folderId: Id<'folders'>; name: string; created: boolean }> {
  return t.mutation(
    internal.folders.internal_mutations.getOrCreateProjectFolder,
    { organizationId: ORG, projectId, userId: EDITOR, name, parentId },
  );
}

async function bindFile(
  t: T,
  args: {
    projectId: string;
    folderId: string;
    fileName?: string;
    skipRagIndexing?: boolean;
  },
): Promise<Id<'documents'>> {
  const fileId = await t.run((ctx) =>
    ctx.storage.store(new Blob(['ledger bytes'])),
  );
  const { uploadId } = await t.mutation(
    internal.projects.rest_upload_intents.createRestUploadIntent,
    { organizationId: ORG, userId: EDITOR, projectId: args.projectId },
  );
  // ONE mutation, like the REST handler: the intent is consumed atomically
  // with the create (a refusal rolls the consume back — pinned below).
  const created = await t.mutation(
    internal.documents.internal_mutations.createDocumentFromUploadForUser,
    {
      organizationId: ORG,
      userId: EDITOR,
      userEmail: 'editor@door.test',
      projectId: args.projectId,
      folderId: args.folderId,
      fileId,
      fileName: args.fileName ?? 'ledger.pdf',
      contentType: 'application/pdf',
      // The REST handler applies the door's default (skip=true); this
      // full-DB harness passes what the handler would.
      skipRagIndexing: args.skipRagIndexing ?? true,
      uploadId,
    },
  );
  return created.documentId;
}

/** Every RAG-indexing job ever written to the scheduler (rows persist after
 * execution, so this is drain-proof). */
async function ragIndexingJobs(t: T): Promise<string[]> {
  return t.run(async (ctx) => {
    const fns = await ctx.db.system.query('_scheduled_functions').collect();
    return fns
      .map((fn) => fn.name)
      .filter(
        (name) =>
          name.includes('uploadFileToRag') ||
          name.includes('uploadDocumentToRag'),
      );
  });
}

function codeOf(error: unknown): string | undefined {
  const raw = (error as { data?: unknown }).data;
  let data: unknown = raw;
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw);
    } catch {
      return undefined;
    }
  }
  return typeof data === 'object' && data !== null && 'code' in data
    ? String((data as { code: unknown }).code)
    : undefined;
}

async function expectCode(p: Promise<unknown>, code: string): Promise<void> {
  const error = await p.then(
    () => {
      throw new Error(`expected a rejection with code ${code}`);
    },
    (err: unknown) => err,
  );
  expect(codeOf(error)).toBe(code);
}

describe('createProjectForUser (shared core with the session createProject)', () => {
  it('creates with a derived key and answers the REST projection', async () => {
    const t = makeT();
    await seedWorld(t);
    const project = await createProject(t, {
      externalItemId: '  erp-42  ',
      description: 'Client ledgers',
    });

    expect(project).toMatchObject({
      name: 'Acme Books',
      description: 'Client ledgers',
      externalItemId: 'erp-42',
    });
    expect(project.key).toBeTruthy();

    const row = await t.run((ctx) => ctx.db.get(project.id));
    expect(row).toMatchObject({
      organizationId: ORG,
      createdBy: EDITOR,
      externalItemId: 'erp-42',
    });
  });

  it('refuses a duplicate externalItemId (409 code) and a blank one (400 code)', async () => {
    const t = makeT();
    await seedWorld(t);
    await createProject(t, { externalItemId: 'erp-42' });

    await expectCode(
      createProject(t, { name: 'Beta', externalItemId: 'erp-42' }),
      'PROJECT_DUPLICATE_EXTERNAL_ID',
    );
    await expectCode(
      createProject(t, { name: 'Gamma', externalItemId: '   ' }),
      'PROJECT_EXTERNAL_ITEM_ID_INVALID',
    );
  });

  it('suffixes a derived-key collision instead of 409ing (bulk machine creates)', async () => {
    const t = makeT();
    await seedWorld(t);
    // Identical names guarantee identical derived keys; only external ids differ.
    const first = await createProject(t, { externalItemId: 'client-1' });
    const second = await createProject(t, { externalItemId: 'client-2' });

    expect(first.key).toBeTruthy();
    expect(second.key).toBeTruthy();
    expect(second.key).not.toBe(first.key);
    expect(second.key).toContain('1');
  });

  it('creates keyless when no key is derivable from the name', async () => {
    const t = makeT();
    await seedWorld(t);
    const project = await createProject(t, {
      name: '税务客户',
      externalItemId: 'client-cjk',
    });

    expect(project.key).toBeUndefined();
    expect(project.name).toBe('税务客户');
  });

  it('still refuses an EXPLICIT key clash loudly', async () => {
    const t = makeT();
    await seedWorld(t);
    await createProject(t, { key: 'MDX', externalItemId: 'client-a' });

    await expectCode(
      createProject(t, {
        name: 'Other',
        key: 'MDX',
        externalItemId: 'client-b',
      }),
      'PROJECT_KEY_TAKEN',
    );
  });

  it('refuses a plain member with the same RBAC code as the session path', async () => {
    const t = makeT();
    await seedWorld(t);
    await expectCode(
      t.mutation(internal.projects.internal_mutations.createProjectForUser, {
        organizationId: ORG,
        userId: MEMBER,
        name: 'Member project',
      }),
      'RBAC_FORBIDDEN',
    );
  });
});

describe('getProjectAccessForUser', () => {
  it('collapses invisible, cross-org, and garbage ids into {canRead: false}', async () => {
    const t = makeT();
    await seedWorld(t);
    await seedMember(t, EDITOR, OTHER_ORG, 'editor');
    const visible = await createProject(t, {});
    const restricted = await t.run((ctx) =>
      ctx.db.insert('projects', {
        organizationId: ORG,
        name: 'Team-only',
        teamId: 'team_hidden',
        createdBy: 'someone',
        createdAt: 0,
        updatedAt: 0,
      }),
    );

    const query = (projectId: string, organizationId = ORG) =>
      t.query(internal.projects.internal_queries.getProjectAccessForUser, {
        organizationId,
        userId: EDITOR,
        projectId,
      });

    expect(await query(visible.id)).toEqual({ canRead: true, canEdit: true });
    expect(await query(restricted)).toEqual({
      canRead: false,
      canEdit: false,
    });
    expect(await query(visible.id, OTHER_ORG)).toEqual({
      canRead: false,
      canEdit: false,
    });
    expect(await query('garbage-id')).toEqual({
      canRead: false,
      canEdit: false,
    });
  });
});

describe('getOrCreateProjectFolder', () => {
  it('creates once, then answers the SAME folder with created: false', async () => {
    const t = makeT();
    await seedWorld(t);
    const project = await createProject(t, {});

    const first = await createFolder(t, project.id, ' Q1 ');
    const second = await createFolder(t, project.id, 'Q1');

    expect(first.created).toBe(true);
    expect(first.name).toBe('Q1');
    expect(second.created).toBe(false);
    expect(second.folderId).toBe(first.folderId);
  });

  it('creates nested folders under a parent of the SAME project only', async () => {
    const t = makeT();
    await seedWorld(t);
    const project = await createProject(t, {});
    const other = await createProject(t, {
      name: 'Other client',
      externalItemId: 'erp-other',
    });
    const root = await createFolder(t, project.id, 'Q1');
    const foreignRoot = await createFolder(t, other.id, 'Q1');

    const nested = await createFolder(t, project.id, 'Ledgers', root.folderId);
    expect(nested.created).toBe(true);
    const row = await t.run((ctx) => ctx.db.get(nested.folderId));
    expect(row).toMatchObject({
      parentId: root.folderId,
      projectId: project.id,
    });

    // A parent from another project answers the opaque 404 code.
    await expectCode(
      createFolder(t, project.id, 'Sneaky', foreignRoot.folderId),
      'FOLDER_NOT_FOUND',
    );
  });

  it('keeps the session path name validation (separator refused)', async () => {
    const t = makeT();
    await seedWorld(t);
    const project = await createProject(t, {});
    await expectCode(
      createFolder(t, project.id, 'a/b'),
      'FOLDER_NAME_HAS_SEPARATOR',
    );
  });
});

describe('bind flow (uploads → files)', () => {
  it('default skip: binds the file, persists the opt-out, schedules NO RAG indexing', async () => {
    const t = makeT();
    await seedWorld(t);
    const project = await createProject(t, {});
    const folder = await createFolder(t, project.id, 'Q1');

    const documentId = await bindFile(t, {
      projectId: project.id,
      folderId: folder.folderId,
    });

    const doc = await t.run((ctx) => ctx.db.get(documentId));
    expect(doc).toMatchObject({
      organizationId: ORG,
      projectId: project.id,
      folderId: folder.folderId,
      title: 'ledger.pdf',
    });

    const docFileId = doc?.fileId;
    expect(docFileId).toBeTruthy();
    const meta = await t.run(async (ctx) =>
      docFileId
        ? await ctx.db
            .query('fileMetadata')
            .withIndex('by_storageId', (q) => q.eq('storageId', docFileId))
            .first()
        : null,
    );
    expect(meta?.skipRagIndexing).toBe(true);
    expect(meta?.ragStatus).toBeUndefined();
    expect(meta?.documentId).toBe(documentId);
    expect(await ragIndexingJobs(t)).toEqual([]);
  });

  it('explicit skipRagIndexing: false opts back into indexing', async () => {
    const t = makeT();
    await seedWorld(t);
    const project = await createProject(t, {});
    const folder = await createFolder(t, project.id, 'Q1');

    const documentId = await bindFile(t, {
      projectId: project.id,
      folderId: folder.folderId,
      skipRagIndexing: false,
    });

    const doc = await t.run((ctx) => ctx.db.get(documentId));
    const docFileId = doc?.fileId;
    const meta = await t.run(async (ctx) =>
      docFileId
        ? await ctx.db
            .query('fileMetadata')
            .withIndex('by_storageId', (q) => q.eq('storageId', docFileId))
            .first()
        : null,
    );
    expect(meta?.skipRagIndexing).toBeUndefined();
    expect(meta?.ragStatus).toBe('queued');
    expect((await ragIndexingJobs(t)).length).toBeGreaterThan(0);
  });

  it('refuses a folder from another project (opaque 404 code) before writing anything', async () => {
    const t = makeT();
    await seedWorld(t);
    const project = await createProject(t, {});
    const other = await createProject(t, {
      name: 'Other client',
      externalItemId: 'erp-other',
    });
    const foreignFolder = await createFolder(t, other.id, 'Q1');

    await expectCode(
      bindFile(t, { projectId: project.id, folderId: foreignFolder.folderId }),
      'FOLDER_NOT_FOUND',
    );
    // Nothing landed in the project.
    const docs = await t.run((ctx) =>
      ctx.db
        .query('documents')
        .withIndex('by_organizationId_and_projectId', (q) =>
          q.eq('organizationId', ORG).eq('projectId', project.id),
        )
        .collect(),
    );
    expect(docs).toEqual([]);
  });

  it('a refused create rolls the consume back — the SAME uploadId retries; success burns it', async () => {
    const t = makeT();
    await seedWorld(t);
    const project = await createProject(t, {});
    const folder = await createFolder(t, project.id, 'Q1');
    const other = await createProject(t, {
      name: 'Other client',
      externalItemId: 'erp-retry-other',
    });
    const foreignFolder = await createFolder(t, other.id, 'Q1');

    const fileId = await t.run((ctx) =>
      ctx.storage.store(new Blob(['ledger bytes'])),
    );
    const { uploadId } = await t.mutation(
      internal.projects.rest_upload_intents.createRestUploadIntent,
      { organizationId: ORG, userId: EDITOR, projectId: project.id },
    );
    const bindWith = (folderId: string) =>
      t.mutation(
        internal.documents.internal_mutations.createDocumentFromUploadForUser,
        {
          organizationId: ORG,
          userId: EDITOR,
          userEmail: 'editor@door.test',
          projectId: project.id,
          folderId,
          fileId,
          fileName: 'ledger.pdf',
          contentType: 'application/pdf',
          skipRagIndexing: true,
          uploadId,
        },
      );

    // A wrong folder refuses AFTER the consume ran — the rollback must keep
    // the intent alive, or an S3-lane worker's typo permanently orphans the
    // uploaded object.
    await expectCode(bindWith(foreignFolder.folderId), 'FOLDER_NOT_FOUND');
    const survivor = await t.run((ctx) =>
      ctx.db.query('restUploadIntents').collect(),
    );
    expect(survivor).toHaveLength(1);

    // The corrected retry with the SAME uploadId succeeds…
    const created = await bindWith(folder.folderId);
    expect(created.documentId).toBeTruthy();

    // …and only success burns the handshake (single-use).
    await expectCode(bindWith(folder.folderId), 'UPLOAD_BLOB_INVALID');
    expect(
      await t.run((ctx) => ctx.db.query('restUploadIntents').collect()),
    ).toEqual([]);
  });

  it('keeps bound project files OUT of the hub documents feed (projectId travels)', async () => {
    const t = makeT();
    await seedWorld(t);
    const project = await createProject(t, {});
    const folder = await createFolder(t, project.id, 'Q1');
    const documentId = await bindFile(t, {
      projectId: project.id,
      folderId: folder.folderId,
    });

    // The hub REST list drops every row whose projectId is set (pinned at
    // the handler in rest_api.test.ts) — prove the row CARRIES it here.
    const result = await t.query(
      internal.documents.internal_queries.queryDocuments,
      { organizationId: ORG, paginationOpts: { numItems: 10, cursor: null } },
    );
    const mine = result.page.find(
      (doc: { _id: string }) => doc._id === documentId,
    );
    expect(mine?.projectId).toBe(project.id);
  });
});

describe('listing internals', () => {
  it('listProjectRootFoldersForUser answers roots only, and null for the invisible', async () => {
    const t = makeT();
    await seedWorld(t);
    const project = await createProject(t, {});
    const root = await createFolder(t, project.id, 'Q1');
    await createFolder(t, project.id, 'Ledgers', root.folderId);

    const folders = await t.query(
      internal.folders.internal_queries.listProjectRootFoldersForUser,
      { organizationId: ORG, userId: EDITOR, projectId: project.id },
    );
    expect(folders).toEqual([{ id: root.folderId, name: 'Q1' }]);

    const restricted = await t.run((ctx) =>
      ctx.db.insert('projects', {
        organizationId: ORG,
        name: 'Team-only',
        teamId: 'team_hidden',
        createdBy: 'someone',
        createdAt: 0,
        updatedAt: 0,
      }),
    );
    expect(
      await t.query(
        internal.folders.internal_queries.listProjectRootFoldersForUser,
        { organizationId: ORG, userId: EDITOR, projectId: restricted },
      ),
    ).toBeNull();
  });

  it('listProjectFilesForUser lists the bound file, honors the folder filter, refuses foreign folders', async () => {
    const t = makeT();
    await seedWorld(t);
    const project = await createProject(t, {});
    const folderA = await createFolder(t, project.id, 'Q1');
    const folderB = await createFolder(t, project.id, 'Q2');
    const other = await createProject(t, {
      name: 'Other client',
      externalItemId: 'erp-other',
    });
    const foreignFolder = await createFolder(t, other.id, 'Q1');
    const documentId = await bindFile(t, {
      projectId: project.id,
      folderId: folderA.folderId,
    });

    const list = (folderId?: string) =>
      t.query(internal.documents.internal_queries.listProjectFilesForUser, {
        organizationId: ORG,
        userId: EDITOR,
        projectId: project.id,
        folderId,
        paginationOpts: { numItems: 10, cursor: null },
      });

    const all = await list();
    expect(all?.status).toBe('ok');
    if (all?.status !== 'ok') throw new Error('expected ok');
    expect(all.page).toHaveLength(1);
    expect(all.page[0]).toMatchObject({
      id: documentId,
      fileName: 'ledger.pdf',
      folderId: folderA.folderId,
      size: 12,
    });
    expect(all.page[0]?.ragStatus).toBeUndefined();

    const filtered = await list(folderA.folderId);
    if (filtered?.status !== 'ok') throw new Error('expected ok');
    expect(filtered.page.map((row) => row.id)).toEqual([documentId]);

    const empty = await list(folderB.folderId);
    if (empty?.status !== 'ok') throw new Error('expected ok');
    expect(empty.page).toEqual([]);

    expect(await list(foreignFolder.folderId)).toEqual({
      status: 'folder_not_found',
    });
  });
});
