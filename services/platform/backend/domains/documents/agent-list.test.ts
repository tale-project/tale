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
import { listFilesByFolder, MAX_RECURSIVE_FILES } from './agent-list.ts';

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
