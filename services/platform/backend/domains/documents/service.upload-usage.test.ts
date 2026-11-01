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
 * meter's total IS the sum of its parts.
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  assertUploadSizeAllowedForOrg,
  computeUploadUsageForUser,
  listHubDocumentsPaginated,
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
