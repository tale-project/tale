// @vitest-environment node

/**
 * The folder listing behind an agent node's `files:` mounts
 * (`documents/internal_queries:listFilesByFolderInternal`). The host stages
 * every returned `name` under the mount and fails the turn on `truncated`,
 * so the two things this double pins are the mount-relative name (subfolder
 * prefix + a leaf that cannot climb out of the mount) and the honest cap.
 * The recursive walk itself rides the integration check on real Postgres.
 */

import type { Sql } from 'postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { findHubFolderByPath } from '../folders/paths.ts';
import {
  listDocumentsForAgent,
  listFilesByFolder,
  MAX_RECURSIVE_FILES,
} from './agent-list.ts';

vi.mock('../folders/paths.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../folders/paths.ts')>()),
  findHubFolderByPath: vi.fn(),
}));

interface Statement {
  text: string;
  values: unknown[];
}

interface FileRow {
  fileId: string;
  title: string | null;
  extension: string | null;
  prefix: string;
  depth: number;
}

function fakeSql(script: {
  folder: { id: string }[];
  files: FileRow[];
  deeper?: boolean;
}): { sql: Sql; statements: Statement[] } {
  const statements: Statement[] = [];
  const sql = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    statements.push({ text, values });
    if (text.startsWith('SELECT id FROM app.folders')) {
      return Promise.resolve(script.folder);
    }
    if (text.includes('SELECT EXISTS')) {
      return Promise.resolve([{ deeper: script.deeper ?? false }]);
    }
    if (text.startsWith('WITH RECURSIVE subtree')) {
      return Promise.resolve(script.files);
    }
    return Promise.resolve([]);
  };
  return { sql: sql as unknown as Sql, statements };
}

afterEach(() => {
  vi.clearAllMocks();
});

interface ListRow {
  fileId: string;
  title: string | null;
  extension: string | null;
  folderPath: string | null;
  teamId: string | null;
  createdAt: number;
  sizeBytes: number | null;
  projectId: string | null;
  projectName: string | null;
  skipRagIndexing: boolean | null;
  ragStatus: string | null;
  ragError: string | null;
  ragErrorCode: string | null;
  hasFileRow: boolean;
}

function listRow(over: Partial<ListRow> = {}): ListRow {
  return {
    fileId: 's3:acme/a',
    title: 'brief.pdf',
    extension: 'pdf',
    folderPath: null,
    teamId: null,
    createdAt: 1_700_000_000_000,
    sizeBytes: 10,
    projectId: null,
    projectName: null,
    skipRagIndexing: false,
    ragStatus: 'completed',
    ragError: null,
    ragErrorCode: null,
    hasFileRow: true,
    ...over,
  };
}

/** The listing's one statement, recorded: the lane flags are the booleans
 * the statement binds around the project set, so a test reads which lanes
 * ran off the values. */
function listingSql(rows: ListRow[]): { sql: Sql; statements: Statement[] } {
  const statements: Statement[] = [];
  const sql = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    statements.push({ text, values });
    return Promise.resolve(rows);
  };
  return { sql: sql as unknown as Sql, statements };
}

/** The `(projectLane, projectIds, hubLane)` triple the statement binds —
 * the only array bracketed by two booleans in its parameter list. */
function laneFlags(values: unknown[]): {
  projectLane: unknown;
  projectIds: unknown;
  hubLane: unknown;
} {
  const at = values.findIndex(
    (value, i) =>
      Array.isArray(value) &&
      typeof values[i - 1] === 'boolean' &&
      typeof values[i + 1] === 'boolean',
  );
  if (at === -1) throw new Error('lane flags not bound');
  return {
    projectLane: values[at - 1],
    projectIds: values[at],
    hubLane: values[at + 1],
  };
}

describe('listDocumentsForAgent', () => {
  const ORG = { organizationId: 'org_1', teamIds: ['org_org_1', 'team_a'] };

  it('lists the hub lane alone without a project, project lane alone with one', async () => {
    const hub = listingSql([]);
    await listDocumentsForAgent(hub.sql, ORG);
    expect(laneFlags(hub.statements[0]?.values ?? [])).toEqual({
      projectLane: false,
      projectIds: [],
      hubLane: true,
    });

    const project = listingSql([]);
    await listDocumentsForAgent(project.sql, { ...ORG, projectId: 'proj_1' });
    // The project lane runs and the hub lane does NOT — the sandbox
    // document_find contract, unchanged.
    expect(laneFlags(project.statements[0]?.values ?? [])).toEqual({
      projectLane: true,
      projectIds: ['proj_1'],
      hubLane: false,
    });
  });

  it('lists both lanes in one page for a project chat (includeHub)', async () => {
    const { sql, statements } = listingSql([
      listRow({
        fileId: 's3:acme/lead',
        title: 'lead-verify.txt',
        extension: 'txt',
        projectId: 'proj_1',
        projectName: 'Website relaunch',
        skipRagIndexing: true,
        ragStatus: null,
      }),
      listRow({ fileId: 's3:acme/policy', title: 'Refund policy.pdf' }),
      listRow({
        fileId: 's3:acme/untracked',
        title: 'legacy.pdf',
        hasFileRow: false,
      }),
    ]);
    const page = await listDocumentsForAgent(sql, {
      ...ORG,
      projectId: 'proj_1',
      includeHub: true,
    });
    // Both lanes run; project rows sort first (the ORDER BY leads with
    // `project_id IS NULL`).
    expect(laneFlags(statements[0]?.values ?? [])).toEqual({
      projectLane: true,
      projectIds: ['proj_1'],
      hubLane: true,
    });
    expect(statements[0]?.text).toContain(
      'ORDER BY (d.project_id IS NULL), d.created_at_ms DESC',
    );
    expect(page.documents).toEqual([
      expect.objectContaining({
        fileId: 's3:acme/lead',
        projectId: 'proj_1',
        projectName: 'Website relaunch',
        // The REST bind's default: opted out, no status column — `skipped`.
        indexing: { status: 'skipped' },
      }),
      expect.objectContaining({
        fileId: 's3:acme/policy',
        projectId: null,
        projectName: null,
        indexing: { status: 'completed' },
      }),
      // A blob no file row tracks has no indexing fact to report.
      expect.objectContaining({ fileId: 's3:acme/untracked', indexing: null }),
    ]);
  });

  it('ignores includeHub without a project lane (the hub is already the lane)', async () => {
    const { sql, statements } = listingSql([]);
    await listDocumentsForAgent(sql, { ...ORG, includeHub: true });
    expect(laneFlags(statements[0]?.values ?? [])).toEqual({
      projectLane: false,
      projectIds: [],
      hubLane: true,
    });
  });
});

describe('listFilesByFolder', () => {
  it('answers null for a folder id outside the organization', async () => {
    const { sql, statements } = fakeSql({ folder: [], files: [] });
    const listing = await listFilesByFolder(sql, {
      organizationId: 'org_1',
      folderId: 'folder_other_org',
    });
    expect(listing).toBeNull();
    expect(statements).toHaveLength(1);
    expect(statements[0]?.values).toEqual(['folder_other_org', 'org_1']);
  });

  it('resolves a hub path and answers null when a segment is missing', async () => {
    vi.mocked(findHubFolderByPath).mockResolvedValue(null);
    const { sql, statements } = fakeSql({ folder: [], files: [] });
    const listing = await listFilesByFolder(sql, {
      organizationId: 'org_1',
      folderPath: 'Clients/Acme GmbH',
    });
    expect(listing).toBeNull();
    expect(findHubFolderByPath).toHaveBeenCalledWith(sql, 'org_1', [
      'Clients',
      'Acme GmbH',
    ]);
    expect(statements).toHaveLength(0);
  });

  it('names each file by its subfolder prefix and a mount-safe leaf', async () => {
    const { sql, statements } = fakeSql({
      folder: [{ id: 'folder_root' }],
      files: [
        {
          fileId: 's3:acme/a',
          title: 'Invoice 123',
          extension: 'pdf',
          prefix: '',
          depth: 0,
        },
        {
          fileId: 's3:acme/b',
          title: 'notes.MD',
          extension: 'md',
          prefix: 'Documentation/',
          depth: 1,
        },
        {
          fileId: 's3:acme/c',
          title: '../../output/x',
          extension: null,
          prefix: 'Documentation/Deep/',
          depth: 2,
        },
        {
          fileId: 's3:acme/d',
          title: null,
          extension: 'txt',
          prefix: '',
          depth: 0,
        },
      ],
    });
    const listing = await listFilesByFolder(sql, {
      organizationId: 'org_1',
      folderId: 'folder_root',
      recursive: true,
    });
    expect(listing).toEqual({
      files: [
        { fileId: 's3:acme/a', name: 'Invoice 123.pdf' },
        { fileId: 's3:acme/b', name: 'Documentation/notes.MD' },
        { fileId: 's3:acme/c', name: 'Documentation/Deep/.._.._output_x' },
        { fileId: 's3:acme/d', name: 's3:acme_d.txt' },
      ],
      truncated: false,
    });
    // The walk asks one row past the cap so the cap can be told apart from
    // an exactly-full folder, and the recursive flag rides the CTE.
    const walk = statements.find((s) => s.text.startsWith('WITH RECURSIVE'));
    expect(walk?.values).toContain(MAX_RECURSIVE_FILES + 1);
    expect(walk?.values).toContain(true);
  });

  it('lists only the folder itself unless asked to recurse', async () => {
    const { sql, statements } = fakeSql({
      folder: [{ id: 'folder_root' }],
      files: [],
    });
    await listFilesByFolder(sql, {
      organizationId: 'org_1',
      folderId: 'folder_root',
    });
    const walk = statements.find((s) => s.text.startsWith('WITH RECURSIVE'));
    expect(walk?.values).toContain(false);
    // No depth probe for a non-recursive read.
    expect(statements.some((s) => s.text.includes('SELECT EXISTS'))).toBe(
      false,
    );
  });

  it('marks the listing truncated at the file cap and cuts to the cap', async () => {
    const files: FileRow[] = Array.from(
      { length: MAX_RECURSIVE_FILES + 1 },
      (_, i) => ({
        fileId: `s3:acme/${i}`,
        title: `file-${i}`,
        extension: 'txt',
        prefix: '',
        depth: 0,
      }),
    );
    const { sql } = fakeSql({ folder: [{ id: 'folder_root' }], files });
    const listing = await listFilesByFolder(sql, {
      organizationId: 'org_1',
      folderId: 'folder_root',
      recursive: true,
    });
    expect(listing?.truncated).toBe(true);
    expect(listing?.files).toHaveLength(MAX_RECURSIVE_FILES);
  });

  it('marks the listing truncated when subfolders sit below the depth cap', async () => {
    const { sql } = fakeSql({
      folder: [{ id: 'folder_root' }],
      files: [],
      deeper: true,
    });
    const listing = await listFilesByFolder(sql, {
      organizationId: 'org_1',
      folderId: 'folder_root',
      recursive: true,
    });
    expect(listing).toEqual({ files: [], truncated: true });
  });
});
