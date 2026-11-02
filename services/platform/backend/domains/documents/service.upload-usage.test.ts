// @vitest-environment node

/**
 * Settings › Usage › Storage shows a meter and, under it, what fills it: the
 * bytes behind documents, files an agent made, chat attachments and anything
 * else, the chats that hold them, and a link to the viewer's own uploads in
 * Knowledge › Documents. Each of those reads the rows the upload gate counts
 * — `app.file_metadata` of this organization uploaded by this person — or
 * the parts would add up to something the gate does not refuse on.
 *
 * So these tests pin the predicate each statement carries, and that the
 * meter's total IS the sum of its parts. The storage list behind the meter's
 * View files link (DOC-R14) reads the same rows, one by one.
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  assertUploadSizeAllowedForOrg,
  computeUploadUsageForUser,
  documentSourceMode,
  listCountedUploadsForUser,
  listHubDocumentsPaginated,
  UPLOAD_FILES_PAGE_MAX,
  UPLOAD_USAGE_CHAT_MAX,
} from './service.ts';

const policy = vi.hoisted(() => ({
  current: null as null | {
    enabled: boolean;
    maxTotalVolumeBytesPerUser?: number | null;
  },
}));

vi.mock('../../lib/org-config.ts', () => ({
  readGovernancePolicyForOrg: vi.fn(() => Promise.resolve(policy.current)),
  resolveOrgSlug: vi.fn(() => Promise.resolve('acme')),
}));

const FRAGMENT = Symbol('fragment');
interface Fragment {
  [FRAGMENT]: true;
  text: string;
  values: unknown[];
}

function isFragment(value: unknown): value is Fragment {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { [FRAGMENT]?: true })[FRAGMENT] === true
  );
}

interface Statement {
  text: string;
  values: unknown[];
}

/** Inlines nested `sql\`…\`` fragments the way postgres.js does, so the
 *  recorded text is the statement Postgres would run, and answers each
 *  statement with the rows `answer` picks for its text. */
function fakeSql(answer: (text: string) => unknown[]): {
  sql: Sql;
  statements: Statement[];
} {
  const statements: Statement[] = [];
  const run = (strings: TemplateStringsArray, ...values: unknown[]) => {
    let text = '';
    const flat: unknown[] = [];
    strings.forEach((part, index) => {
      text += part;
      if (index >= values.length) return;
      const value = values[index];
      if (isFragment(value)) {
        text += value.text;
        flat.push(...value.values);
      } else {
        text += '?';
        flat.push(value);
      }
    });
    text = text.replace(/\s+/g, ' ').trim();
    statements.push({ text, values: flat });
    const fragment: Fragment = { [FRAGMENT]: true, text, values: flat };
    return Object.assign(Promise.resolve(answer(text)), fragment);
  };
  const sql = Object.assign(run, {
    unsafe: (text: string) => text,
  }) as unknown as Sql;
  return { sql, statements };
}

/** The statements that read `app.file_metadata` — not the fragments. */
function fileReads(statements: Statement[]): Statement[] {
  return statements.filter(
    (s) =>
      (s.text.startsWith('SELECT') || s.text.startsWith('WITH')) &&
      s.text.includes('app.file_metadata fm'),
  );
}

const COUNTED = 'fm.org_id = ? AND fm.uploaded_by = ?';

/** The values bound to the counted clause, wherever it sits. */
function countedValues(statement: Statement): unknown[] {
  const at = statement.text.indexOf(COUNTED);
  expect(at).toBeGreaterThan(-1);
  const before = statement.text.slice(0, at).split('?').length - 1;
  return statement.values.slice(before, before + 2);
}

const ORG = 'org_1';
const USER = 'user-1';
const LIMIT = 10 * 1024 ** 3;

beforeEach(() => {
  policy.current = { enabled: true, maxTotalVolumeBytesPerUser: LIMIT };
});

describe('computeUploadUsageForUser', () => {
  it('reads nothing and claims nothing when no limit applies', async () => {
    policy.current = { enabled: true, maxTotalVolumeBytesPerUser: null };
    const { sql, statements } = fakeSql(() => []);

    const usage = await computeUploadUsageForUser(sql, ORG, USER);

    expect(fileReads(statements)).toEqual([]);
    expect(usage).toEqual({
      limited: false,
      usedBytes: 0,
      limitBytes: null,
      breakdown: { documents: 0, agentFiles: 0, chatAttachments: 0, other: 0 },
      chats: [],
      chatCount: 0,
    });
  });

  it('answers the used bytes as the sum of the parts, each from the counted rows', async () => {
    const { sql, statements } = fakeSql((text) =>
      text.includes('GROUP BY 1') && !text.startsWith('WITH')
        ? [
            { kind: 'documents', bytes: '27000000' },
            { kind: 'chatAttachments', bytes: '850000' },
            { kind: 'other', bytes: '50000' },
          ]
        : [],
    );

    const usage = await computeUploadUsageForUser(sql, ORG, USER);

    expect(usage.breakdown).toEqual({
      documents: 27_000_000,
      agentFiles: 0,
      chatAttachments: 850_000,
      other: 50_000,
    });
    expect(usage.usedBytes).toBe(27_900_000);
    expect(usage.limitBytes).toBe(LIMIT);

    const [parts] = fileReads(statements);
    expect(parts).toBeDefined();
    if (!parts) return;
    expect(countedValues(parts)).toEqual([ORG, USER]);
    // One statement, grouped: no row is in two parts, and the parts carry
    // no filter of their own beyond the counted rows.
    expect(parts.text).toMatch(
      /WHERE fm\.org_id = \? AND fm\.uploaded_by = \? GROUP BY 1$/,
    );
    // A document wins over the chat it came from; an agent's file over the
    // chat it was made in.
    const order = ['document_id IS NOT NULL', "source = 'agent'"].map((cut) =>
      parts.text.indexOf(cut),
    );
    expect(order[0]).toBeLessThan(order[1] ?? -1);
    expect(parts.text.indexOf("source = 'agent'")).toBeLessThan(
      parts.text.indexOf('thread_id IS NOT NULL'),
    );
  });

  it('reads the rows the upload gate counts, with the same clause', async () => {
    const usageSql = fakeSql(() => []);
    await computeUploadUsageForUser(usageSql.sql, ORG, USER);
    const gateSql = fakeSql(() => [{ total: '0' }]);
    await assertUploadSizeAllowedForOrg(
      gateSql.sql,
      { organizationId: ORG, userId: USER, role: 'member', teamIds: [] },
      { fileName: 'notes.pdf', contentType: 'application/pdf', size: 1 },
    );

    const [gate] = fileReads(gateSql.statements);
    expect(gate).toBeDefined();
    if (!gate) return;
    expect(gate.text).toBe(
      `SELECT sum(fm.size)::text AS total FROM app.file_metadata fm WHERE ${COUNTED}`,
    );
    expect(countedValues(gate)).toEqual([ORG, USER]);
    for (const statement of fileReads(usageSql.statements)) {
      expect(countedValues(statement)).toEqual([ORG, USER]);
    }
  });

  it('names the largest of the chats the viewer can open, under their lineage root', async () => {
    const { sql, statements } = fakeSql((text) =>
      text.startsWith('WITH')
        ? [
            {
              threadId: 'chat-big',
              title: 'Q3 review',
              bytes: '900',
              total: 7,
            },
            { threadId: 'chat-small', title: null, bytes: '100', total: 7 },
          ]
        : [],
    );

    const usage = await computeUploadUsageForUser(sql, ORG, USER);

    expect(usage.chats).toEqual([
      { threadId: 'chat-big', title: 'Q3 review', bytes: 900 },
      { threadId: 'chat-small', title: null, bytes: 100 },
    ]);
    expect(usage.chatCount).toBe(7);

    const chats = fileReads(statements).find((s) => s.text.startsWith('WITH'));
    expect(chats).toBeDefined();
    if (!chats) return;
    expect(countedValues(chats)).toEqual([ORG, USER]);
    // The files a chat holds — not the ones a document took over…
    expect(chats.text).toContain(
      'AND fm.document_id IS NULL AND fm.thread_id IS NOT NULL',
    );
    // …listed under the root the chat page opens (a hidden edit or
    // regenerate sibling opens inside it)…
    expect(chats.text).toContain(
      'coalesce(tm.branch_root_id, fm.thread_id) AS root_id',
    );
    // …and only the viewer's own live chats, as `loadOwnedThread` opens.
    expect(chats.text).toContain(
      "WHERE t.org_id = ? AND t.user_id = ? AND rtm.status = 'active'",
    );
    const owner = chats.text.indexOf('t.user_id = ?');
    const before = chats.text.slice(0, owner).split('?').length - 1;
    expect(chats.values[before]).toBe(USER);
    expect(chats.text).toMatch(/ORDER BY h\.bytes DESC, h\.root_id LIMIT \?$/);
    expect(chats.values.at(-1)).toBe(UPLOAD_USAGE_CHAT_MAX);
  });

  it('answers no chats when none of the viewer holds counted files', async () => {
    const { sql } = fakeSql(() => []);
    const usage = await computeUploadUsageForUser(sql, ORG, USER);
    expect(usage.chats).toEqual([]);
    expect(usage.chatCount).toBe(0);
    expect(usage.usedBytes).toBe(0);
  });
});

describe('listHubDocumentsPaginated, uploaded by the viewer', () => {
  const auth = {
    organizationId: ORG,
    userId: USER,
    role: 'member',
    teamIds: ['team-mine'],
  };

  function pageStatement(statements: Statement[]): Statement {
    const found = statements.find((s) => s.text.startsWith('SELECT'));
    if (!found) throw new Error('no page statement was issued');
    return found;
  }

  /** The value bound to the placeholder right before `marker`. */
  function boundBefore(statement: Statement, marker: string): unknown {
    const at = statement.text.indexOf(marker);
    expect(at).toBeGreaterThan(-1);
    return statement.values[statement.text.slice(0, at).split('?').length - 2];
  }

  it('lists every folder, only documents a file the viewer uploaded backs', async () => {
    const { sql, statements } = fakeSql(() => []);
    await listHubDocumentsPaginated(sql, auth, {
      cursor: null,
      numItems: 20,
      folderId: null,
      uploadedByViewer: true,
    });

    const page = pageStatement(statements);
    // The folder cut is switched off…
    expect(boundBefore(page, ' OR folder_id IS NOT DISTINCT FROM')).toBe(true);
    // …and the counted rows decide instead: the viewer's own uploads.
    expect(page.text).toContain(
      `AND (NOT ? OR EXISTS ( SELECT 1 FROM app.file_metadata fm WHERE ${COUNTED} AND fm.document_id = documents.id))`,
    );
    expect(boundBefore(page, ' OR EXISTS')).toBe(true);
    expect(countedValues(page)).toEqual([ORG, USER]);
    // Still hub rows the viewer may see.
    expect(page.text).toContain('project_id IS NULL');
    expect(page.text).toContain('team_tags && ?::text[]');
  });

  it('keeps the folder page as it was when the filter is off', async () => {
    const { sql, statements } = fakeSql(() => []);
    await listHubDocumentsPaginated(sql, auth, {
      cursor: null,
      numItems: 20,
      folderId: 'folder-meetings',
    });

    const page = pageStatement(statements);
    expect(boundBefore(page, ' OR folder_id IS NOT DISTINCT FROM')).toBe(false);
    expect(boundBefore(page, ' OR EXISTS')).toBe(false);
  });
});

describe('listCountedUploadsForUser, the files behind the meter', () => {
  const auth = {
    organizationId: ORG,
    userId: USER,
    role: 'member',
    teamIds: ['team-mine'],
  };

  function listStatement(statements: Statement[]): Statement {
    const found = statements.find((s) => s.text.startsWith('WITH page AS'));
    if (!found) throw new Error('no list statement was issued');
    return found;
  }

  /** The value bound to the placeholder right before `marker`. */
  function boundBefore(statement: Statement, marker: string): unknown {
    const at = statement.text.indexOf(marker);
    expect(at).toBeGreaterThan(-1);
    return statement.values[statement.text.slice(0, at).split('?').length - 2];
  }

  /** The value bound to the page's LIMIT. */
  function limitOf(statement: Statement): unknown {
    const at = statement.text.indexOf(' LIMIT ?');
    expect(at).toBeGreaterThan(-1);
    return statement.values[statement.text.slice(0, at).split('?').length - 1];
  }

  function cursorOf(value: unknown): string {
    return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
  }

  const LIVE = {
    fileTrashed: false,
    documentId: null,
    documentTitle: null,
    documentSourceProvider: null,
    documentSourceMode: null,
    documentCurrent: false,
    documentRecord: null,
    documentTrashed: false,
    documentInHub: false,
    placeProjectId: null,
    projectReadable: false,
    projectName: null,
    projectArchived: false,
    inChat: false,
    chatId: null,
    chatTitle: null,
    chatStatus: null,
  };

  function fileRow(id: string, size: number, fields: object) {
    return {
      ...LIVE,
      id,
      storageRef: `s3:${id}`,
      name: `${id}.pdf`,
      contentType: 'application/pdf',
      size,
      createdAt: 1_700_000_000_000,
      kind: 'documents',
      ...fields,
    };
  }

  it('cuts each page from the counted rows alone, largest first [DOC-R14]', async () => {
    const { sql, statements } = fakeSql(() => []);
    await listCountedUploadsForUser(sql, auth, { cursor: null, numItems: 20 });

    const list = listStatement(statements);
    expect(countedValues(list)).toEqual([ORG, USER]);
    // The counted clause and the keyset are the page's only filter, so
    // the walk reaches every row the gate and the meter count…
    expect(list.text).toContain(
      `FROM app.file_metadata fm WHERE ${COUNTED} AND (? OR (fm.size, fm.id) < (?, ?)) ORDER BY fm.size DESC, fm.id DESC LIMIT ? )`,
    );
    expect(boundBefore(list, ' OR (fm.size, fm.id)')).toBe(true);
    expect(limitOf(list)).toBe(21);
    // …and every place is read beside a row, never instead of one.
    const places = list.text.slice(list.text.indexOf('FROM page p'));
    const joins = places.match(/\b\w+ JOIN\b/g) ?? [];
    expect(joins.length).toBeGreaterThan(0);
    expect(joins.every((join) => join === 'LEFT JOIN')).toBe(true);
    expect(places).toMatch(/ORDER BY p\.size DESC, p\.id DESC$/);
  });

  it('names each file by the part the meter counts it in', async () => {
    const meter = fakeSql(() => []);
    await computeUploadUsageForUser(meter.sql, ORG, USER);
    const list = fakeSql(() => []);
    await listCountedUploadsForUser(list.sql, auth, {
      cursor: null,
      numItems: 20,
    });

    const kindOf = (text: string) =>
      text.slice(
        text.indexOf('CASE WHEN fm.document_id'),
        text.indexOf(' END AS kind') + ' END'.length,
      );
    const [parts] = fileReads(meter.statements);
    expect(parts).toBeDefined();
    if (!parts) return;
    const kind = kindOf(parts.text);
    expect(kind).toContain("WHEN fm.source = 'agent' THEN 'agentFiles'");
    expect(kindOf(listStatement(list.statements).text)).toBe(kind);
  });

  it('walks on from the last row it answered', async () => {
    const rows = [
      fileRow('fm-c', 900, {}),
      fileRow('fm-b', 500, {}),
      fileRow('fm-a', 500, {}),
    ];
    const first = fakeSql(() => rows);
    const page = await listCountedUploadsForUser(first.sql, auth, {
      cursor: null,
      numItems: 2,
    });
    expect(page.page.map((file) => file.id)).toEqual(['fm-c', 'fm-b']);
    expect(page.isDone).toBe(false);

    const next = fakeSql(() => []);
    const rest = await listCountedUploadsForUser(next.sql, auth, {
      cursor: page.continueCursor,
      numItems: 2,
    });
    const list = listStatement(next.statements);
    expect(boundBefore(list, ' OR (fm.size, fm.id)')).toBe(false);
    const at = list.text.indexOf('(fm.size, fm.id) < (?, ?)');
    const before = list.text.slice(0, at).split('?').length - 1;
    expect(list.values.slice(before, before + 2)).toEqual([500, 'fm-b']);
    expect(rest).toEqual({ page: [], isDone: true, continueCursor: '' });
  });

  it('starts over on a cursor it did not make', async () => {
    for (const cursor of [
      'not-a-cursor',
      cursorOf({ c: 1.5, i: 'fm-a' }),
      cursorOf({ c: '500', i: 'fm-a' }),
      cursorOf({ c: 500 }),
    ]) {
      const { sql, statements } = fakeSql(() => []);
      await listCountedUploadsForUser(sql, auth, { cursor, numItems: 20 });
      expect(
        boundBefore(listStatement(statements), ' OR (fm.size, fm.id)'),
      ).toBe(true);
    }
  });

  it('answers between one row and a full page', async () => {
    for (const [numItems, limit] of [
      [0, 2],
      [-5, 2],
      // A fractional count is cut to its whole rows, never sent as is.
      [2.5, 3],
      [1_000, UPLOAD_FILES_PAGE_MAX + 1],
    ] as const) {
      const { sql, statements } = fakeSql(() => []);
      await listCountedUploadsForUser(sql, auth, { cursor: null, numItems });
      expect(limitOf(listStatement(statements))).toBe(limit);
    }
  });

  it('opens a place only as far as the viewer reaches it', async () => {
    const { sql, statements } = fakeSql(() => []);
    await listCountedUploadsForUser(sql, auth, { cursor: null, numItems: 20 });

    const list = listStatement(statements);
    // Knowledge: the hub's own audience rule, over the viewer's teams.
    expect(list.text).toContain(
      'SELECT 1 FROM app.documents hub WHERE hub.id = d.id AND project_id IS NULL AND (? OR cardinality(team_tags) = 0 OR team_tags && ?::text[])',
    );
    expect(boundBefore(list, 'OR cardinality(team_tags) = 0')).toBe(false);
    expect(list.values).toContainEqual(['team-mine']);
    // Projects: the readable ones, archived ones too.
    expect(list.text).toContain('FROM app.projects WHERE org_id = ?');
    expect(boundBefore(list, ' OR archived_at_ms IS NULL')).toBe(true);
    // Chats: the viewer's own, under the root the chat page opens.
    expect(list.text).toContain(
      'LEFT JOIN app.thread_metadata rtm ON rtm.thread_id = coalesce(tm.branch_root_id, tm.thread_id)',
    );
    expect(list.text).toContain(
      'LEFT JOIN app.threads rt ON rt.id = rtm.thread_id AND rt.org_id = ? AND rt.user_id = ?',
    );
    const owner = list.text.indexOf('rt.user_id = ?');
    expect(list.values[list.text.slice(0, owner).split('?').length - 1]).toBe(
      USER,
    );
  });

  it('says where each file lives, what opens and what is in Trash', async () => {
    const { sql } = fakeSql(() => [
      fileRow('hub', 90, {
        documentId: 'doc-hub',
        documentTitle: 'Q3 plan',
        documentSourceProvider: 'upload',
        documentSourceMode: 'manual',
        documentCurrent: true,
        documentInHub: true,
      }),
      fileRow('hub-trashed', 80, {
        documentId: 'doc-old',
        documentTitle: 'Old plan',
        documentTrashed: true,
        documentInHub: true,
      }),
      fileRow('project', 70, {
        documentId: 'doc-p',
        documentTitle: 'Brief',
        placeProjectId: 'proj-1',
        projectReadable: true,
        projectName: 'Launch',
        projectArchived: true,
      }),
      fileRow('project-hidden', 60, {
        documentId: 'doc-q',
        placeProjectId: 'proj-2',
      }),
      fileRow('chat', 50, {
        kind: 'chatAttachments',
        inChat: true,
        chatId: 'chat-root',
        chatTitle: 'Q3 review',
        chatStatus: 'active',
      }),
      fileRow('chat-other', 40, {
        kind: 'chatAttachments',
        inChat: true,
        chatTitle: 'Not mine',
      }),
      fileRow('chat-trashed', 30, {
        kind: 'chatAttachments',
        inChat: true,
        chatId: 'chat-gone',
        chatTitle: 'Gone',
        chatStatus: 'trashed',
      }),
      fileRow('chat-archived', 25, {
        kind: 'chatAttachments',
        inChat: true,
        chatId: 'chat-shelf',
        chatTitle: 'Shelved',
        chatStatus: 'archived',
      }),
      fileRow('run', 20, {
        kind: 'agentFiles',
        placeProjectId: 'proj-1',
        projectReadable: true,
        projectName: 'Launch',
      }),
      fileRow('loose', 10, { kind: 'other' }),
      fileRow('loose-trashed', 5, { kind: 'other', fileTrashed: true }),
    ]);

    const { page } = await listCountedUploadsForUser(sql, auth, {
      cursor: null,
      numItems: 20,
    });
    const byId = new Map(page.map((file) => [file.id, file]));

    expect(byId.get('hub')).toEqual({
      id: 'hub',
      storageRef: 's3:hub',
      name: 'hub.pdf',
      contentType: 'application/pdf',
      size: 90,
      createdAt: 1_700_000_000_000,
      kind: 'documents',
      document: {
        id: 'doc-hub',
        title: 'Q3 plan',
        sourceProvider: 'upload',
        sourceMode: 'manual',
        current: true,
        recordProtected: false,
      },
      place: { type: 'knowledge', open: true },
      inTrash: false,
    });
    expect(byId.get('hub-trashed')).toMatchObject({
      place: { type: 'knowledge', open: false },
      inTrash: true,
    });
    expect(byId.get('project')?.place).toEqual({
      type: 'project',
      id: 'proj-1',
      name: 'Launch',
      archived: true,
      open: true,
    });
    // A project the viewer may not read keeps its type, never its name.
    expect(byId.get('project-hidden')?.place).toEqual({
      type: 'project',
      id: null,
      name: null,
      archived: false,
      open: false,
    });
    expect(byId.get('chat')?.place).toEqual({
      type: 'chat',
      id: 'chat-root',
      title: 'Q3 review',
      open: true,
    });
    expect(byId.get('chat-other')?.place).toEqual({
      type: 'chat',
      id: null,
      title: null,
      open: false,
    });
    expect(byId.get('chat-trashed')).toMatchObject({
      place: { type: 'chat', id: 'chat-gone', open: false },
      inTrash: true,
    });
    expect(byId.get('chat-archived')).toMatchObject({
      place: { type: 'chat', id: 'chat-shelf', title: 'Shelved', open: false },
      inTrash: false,
    });
    // A task run's file has no chat: it lives in the run's project.
    expect(byId.get('run')?.place).toMatchObject({
      type: 'project',
      id: 'proj-1',
      open: true,
    });
    expect(byId.get('loose')).toMatchObject({
      document: null,
      place: { type: 'none', open: false },
      inTrash: false,
    });
    expect(byId.get('loose-trashed')?.inTrash).toBe(true);
    expect(page.map((file) => file.size)).toEqual([
      90, 80, 70, 60, 50, 40, 30, 25, 20, 10, 5,
    ]);
  });

  /** The first page the list answers when the database holds `rows`, and
   *  the statement it ran. */
  async function listed(rows: object[]) {
    const { sql, statements } = fakeSql(() => rows);
    const { page } = await listCountedUploadsForUser(sql, auth, {
      cursor: null,
      numItems: 20,
    });
    return {
      page,
      byId: new Map(page.map((file) => [file.id, file])),
      text: listStatement(statements).text,
    };
  }

  it('names the document behind a file only where the viewer may read its place [DOC-R14]', async () => {
    const { byId } = await listed([
      fileRow('hub', 90, {
        documentId: 'doc-hub',
        documentTitle: 'Q3 plan',
        documentCurrent: true,
        documentInHub: true,
      }),
      // A library document whose teams leave the viewer out.
      fileRow('hub-hidden', 80, {
        documentId: 'doc-board',
        documentTitle: 'Board minutes',
        documentSourceProvider: 'upload',
        documentCurrent: true,
      }),
      fileRow('project', 70, {
        documentId: 'doc-brief',
        documentTitle: 'Brief',
        documentCurrent: true,
        placeProjectId: 'proj-1',
        projectReadable: true,
        projectName: 'Launch',
      }),
      // A project the viewer may no longer read.
      fileRow('project-hidden', 60, {
        documentId: 'doc-pay',
        documentTitle: 'Salaries',
        documentSourceProvider: 'upload',
        documentCurrent: true,
        placeProjectId: 'proj-2',
      }),
    ]);

    expect(byId.get('hub')?.document).toMatchObject({
      id: 'doc-hub',
      title: 'Q3 plan',
    });
    expect(byId.get('project')?.document).toMatchObject({
      id: 'doc-brief',
      title: 'Brief',
    });
    // Neither its title nor anything a delete would need travels…
    expect(byId.get('hub-hidden')?.document).toBeNull();
    expect(byId.get('project-hidden')?.document).toBeNull();
    // …and the place reads as it does for any file there.
    expect(byId.get('hub-hidden')?.place).toEqual({
      type: 'knowledge',
      open: false,
    });
    expect(byId.get('project-hidden')?.place).toEqual({
      type: 'project',
      id: null,
      name: null,
      archived: false,
      open: false,
    });
  });

  it('marks a controlled record that refuses every delete as protected [DOC-R14]', async () => {
    const approvedV1 = {
      version: 1,
      fileId: 's3:org_1/sop-v1.pdf',
      approvedAt: 1,
      approvedBy: 'user-2',
    };
    const records: [string, Record<string, unknown> | null][] = [
      ['in-review', { state: 'in_review', version: 1, approvedVersions: [] }],
      [
        'approved',
        { state: 'approved', version: 1, approvedVersions: [approvedV1] },
      ],
      // A revision under way keeps its approved version as a record.
      [
        'revision',
        { state: 'draft', version: 2, approvedVersions: [approvedV1] },
      ],
      ['uncontrolled', null],
      ['first-draft', { state: 'draft', version: 1, approvedVersions: [] }],
    ];
    const { page, text } = await listed(
      records.map(([id, record], index) =>
        fileRow(id, 50 - index, {
          documentId: `doc-${id}`,
          documentCurrent: true,
          documentRecord: record,
          documentInHub: true,
        }),
      ),
    );

    expect(text).toContain('d.record AS "documentRecord"');
    expect(
      Object.fromEntries(
        page.map((file) => [file.id, file.document?.recordProtected]),
      ),
    ).toEqual({
      'in-review': true,
      approved: true,
      revision: true,
      uncontrolled: false,
      'first-draft': false,
    });
  });

  it('reads a synced document as auto and one that names no mode as manual [DOC-R14]', async () => {
    const { page, text } = await listed(
      (['sync', 'auto', 'manual', null] as const).map((mode, index) =>
        fileRow(`mode-${mode ?? 'none'}`, 50 - index, {
          documentId: `doc-${mode ?? 'none'}`,
          documentSourceMode: mode,
          documentCurrent: true,
          documentInHub: true,
        }),
      ),
    );

    expect(text).toContain(`d.metadata->>'sourceMode' AS "documentSourceMode"`);
    expect(
      Object.fromEntries(
        page.map((file) => [file.id, file.document?.sourceMode]),
      ),
    ).toEqual({
      'mode-sync': 'auto',
      'mode-auto': 'auto',
      'mode-manual': 'manual',
      'mode-none': 'manual',
    });
  });

  it('tells the current file of a document from an older version of it [DOC-R14]', async () => {
    const { byId, text } = await listed([
      fileRow('plan-v2', 90, {
        documentId: 'doc-plan',
        documentCurrent: true,
        documentInHub: true,
      }),
      fileRow('plan-v1', 80, {
        documentId: 'doc-plan',
        documentCurrent: false,
        documentInHub: true,
      }),
    ]);

    // The document's file reference names its current file; every other
    // file row of it is an older version.
    expect(text).toContain(
      'coalesce(d.file_ref = p.storage_ref, false) AS "documentCurrent"',
    );
    expect(byId.get('plan-v2')?.document).toMatchObject({
      id: 'doc-plan',
      current: true,
    });
    expect(byId.get('plan-v1')?.document).toMatchObject({
      id: 'doc-plan',
      current: false,
    });
  });
});

describe('documentSourceMode, how Knowledge reads where a document came from', () => {
  it('keeps auto and manual, reads a sync as auto and anything else as manual', () => {
    expect(documentSourceMode('auto')).toBe('auto');
    expect(documentSourceMode('manual')).toBe('manual');
    expect(documentSourceMode('sync')).toBe('auto');
    for (const raw of [null, undefined, '', 'Auto', 'upload', 1]) {
      expect(documentSourceMode(raw)).toBe('manual');
    }
  });
});
