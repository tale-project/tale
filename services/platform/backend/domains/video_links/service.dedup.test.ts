// @vitest-environment node

/**
 * A re-pasted URL reuses this chat's unsent job. The lookup used to take the
 * newest row for the organization and URL hash and check its chat, uploader
 * and state afterwards, so the same URL pasted in another chat — a newer row
 * — hid the older eligible one, and the next paste back in the first chat
 * inserted a second job and a second extraction (#3704). Every eligibility
 * rule is now part of the lookup.
 *
 * The fake keeps the jobs table in memory and evaluates each read's WHERE
 * clause predicate by predicate (an unknown predicate throws), then its
 * ORDER BY and LIMIT, so a rule applied after the LIMIT picks the wrong row
 * here exactly as it did on Postgres. The real-Postgres arc through the Hono
 * routes rides `checkVideoLinkComposerChips` (backend:integration).
 */

import type { Sql } from 'postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { addJobInTx } from '../../jobs/enqueue.ts';
import { ingestVideoUrl } from './service.ts';

vi.mock('../files/service.ts', () => ({
  deleteOrgBlobRefs: vi.fn(() => Promise.resolve()),
  putOrgBlobBytes: vi.fn(),
}));
vi.mock('../knowledge/service.ts', () => ({
  markRagQueued: vi.fn(() => Promise.resolve()),
}));
vi.mock('../../jobs/enqueue.ts', () => ({
  addJobInTx: vi.fn(() => Promise.resolve('boss-job')),
}));
vi.mock('../audit_logs/service.ts', () => ({
  createAuditLog: vi.fn(() => Promise.resolve()),
}));
vi.mock('../governance/direct-calls.ts', () => ({
  directCallBlocked: vi.fn(() => Promise.resolve(null)),
}));
vi.mock('../../auth/membership.ts', () => ({
  findOrganizationMember: vi.fn(() => Promise.resolve(null)),
  getUserTeamIds: vi.fn(() => Promise.resolve([])),
}));
vi.mock('./hints.ts', () => ({
  hintVideoJobs: vi.fn(() => Promise.resolve()),
}));

/** A job row under its column names. */
interface JobRow {
  id: string;
  org_id: string;
  thread_id: string | null;
  uploaded_by: string;
  source_url_hash: string;
  pasted_token: string;
  status: string;
  lifecycle_status: string | null;
  message_bound_at_ms: number | null;
  created_at_ms: number;
  file_metadata_id: string | null;
}

const COLUMNS: ReadonlySet<string> = new Set([
  'id',
  'org_id',
  'thread_id',
  'uploaded_by',
  'source_url_hash',
  'pasted_token',
  'status',
  'lifecycle_status',
  'message_bound_at_ms',
  'created_at_ms',
  'file_metadata_id',
]);

function isColumn(name: string): name is keyof JobRow {
  return COLUMNS.has(name);
}

const FRAGMENT = Symbol('fragment');
interface Fragment {
  [FRAGMENT]: true;
  text: string;
}
function isFragment(value: unknown): value is Fragment {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { [FRAGMENT]?: true })[FRAGMENT] === true
  );
}

/** A row as `JOB_COLUMNS` aliases it. */
function asJobView(row: JobRow): Record<string, unknown> {
  return {
    id: row.id,
    organizationId: row.org_id,
    threadId: row.thread_id,
    uploadedBy: row.uploaded_by,
    sourceUrlHash: row.source_url_hash,
    pastedToken: row.pasted_token,
    status: row.status,
    lifecycleStatus: row.lifecycle_status,
    messageBoundAt: row.message_bound_at_ms,
    createdAt: row.created_at_ms,
    fileMetadataId: row.file_metadata_id,
    storageRef: null,
  };
}

/** One WHERE conjunct as a row filter; bound values are consumed in order. */
function predicate(
  conjunct: string,
  nextValue: () => unknown,
): (row: JobRow) => boolean {
  const column = (name: string | undefined): keyof JobRow => {
    if (name === undefined || !isColumn(name)) {
      throw new Error(`unknown column in a read: ${name}`);
    }
    return name;
  };
  let match = /^(\w+) = \?$/.exec(conjunct);
  if (match) {
    const key = column(match[1]);
    const value = nextValue();
    return (row) => row[key] === value;
  }
  match = /^(\w+) > \?$/.exec(conjunct);
  if (match) {
    const key = column(match[1]);
    const value = Number(nextValue());
    return (row) => Number(row[key]) > value;
  }
  match = /^(\w+) IS NULL$/.exec(conjunct);
  if (match) {
    const key = column(match[1]);
    return (row) => row[key] === null;
  }
  match = /^(\w+) IS DISTINCT FROM '(\w+)'$/.exec(conjunct);
  if (match) {
    const key = column(match[1]);
    const literal = match[2];
    return (row) => row[key] !== literal;
  }
  match = /^(\w+) NOT IN \(('\w+'(?:, '\w+')*)\)$/.exec(conjunct);
  if (match) {
    const key = column(match[1]);
    const literals = new Set(
      (match[2] ?? '').split(', ').map((l) => l.slice(1, -1)),
    );
    return (row) => !literals.has(String(row[key]));
  }
  throw new Error(`unknown predicate in a read: ${conjunct}`);
}

/** `SELECT … FROM app.video_link_jobs WHERE … ORDER BY created_at_ms DESC
 * LIMIT n` over the in-memory table. */
function select(table: JobRow[], text: string, values: unknown[]): unknown[] {
  const shape =
    /FROM app\.video_link_jobs WHERE (.+) ORDER BY created_at_ms DESC LIMIT (\?|\d+)$/.exec(
      text,
    );
  if (!shape) throw new Error(`unexpected read: ${text}`);
  let cursor = 0;
  const nextValue = (): unknown => values[cursor++];
  const filters = (shape[1] ?? '')
    .split(' AND ')
    .map((conjunct) => predicate(conjunct.trim(), nextValue));
  const limit = shape[2] === '?' ? Number(nextValue()) : Number(shape[2]);
  return table
    .filter((row) => filters.every((keep) => keep(row)))
    .sort((a, b) => b.created_at_ms - a.created_at_ms)
    .slice(0, limit)
    .map(asJobView);
}

interface Read {
  text: string;
  values: unknown[];
}

function fakeSql(table: JobRow[]): {
  sql: Sql;
  reads: Read[];
  inserts: number;
} {
  const state = { reads: [] as Read[], inserts: 0 };
  const handle = () => {
    const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
      let text = '';
      const flat: unknown[] = [];
      strings.forEach((part, index) => {
        text += part;
        if (index >= values.length) return;
        const value = values[index];
        if (isFragment(value)) text += value.text;
        else {
          text += '?';
          flat.push(value);
        }
      });
      text = text.replace(/\s+/g, ' ').trim();
      if (text.startsWith('SELECT count(*)::text AS count')) {
        return Promise.resolve([{ count: '0' }]);
      }
      if (text.startsWith('SELECT') && text.includes('app.video_link_jobs')) {
        state.reads.push({ text, values: flat });
        return Promise.resolve(select(table, text, flat));
      }
      if (text.startsWith('INSERT INTO app.video_link_jobs')) {
        state.inserts += 1;
        return Promise.resolve([{ id: 'job-new' }]);
      }
      if (text.startsWith('UPDATE app.video_link_jobs SET pasted_token')) {
        const [token, id] = flat;
        const row = table.find((r) => r.id === id);
        if (row) row.pasted_token = String(token);
      }
      return Promise.resolve([]);
    };
    tag.unsafe = (text: string): Fragment => ({ [FRAGMENT]: true, text });
    tag.json = (value: unknown): unknown => value;
    return tag;
  };
  const pool = Object.assign(handle(), {
    begin: async (callback: (tx: ReturnType<typeof handle>) => unknown) =>
      callback(handle()),
  });
  return {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
    sql: pool as unknown as Sql,
    get reads() {
      return state.reads;
    },
    get inserts() {
      return state.inserts;
    },
  };
}

const NOW = Date.now();
const URL = 'https://www.youtube.com/watch?v=abcdefghijk';

function paste(threadId: string, pastedToken = URL) {
  return {
    organizationId: 'org-1',
    userId: 'user-1',
    threadId,
    url: pastedToken,
    pastedToken,
  };
}

/** The dedup key the server derives for `URL`: the value the first read
 * binds against `source_url_hash` on an empty table. */
async function urlHash(): Promise<string> {
  const fake = fakeSql([]);
  await ingestVideoUrl(fake.sql, paste('thread-x'));
  vi.mocked(addJobInTx).mockClear();
  const hash = fake.reads[0]?.values[1];
  if (typeof hash !== 'string') throw new Error('no dedup read ran');
  return hash;
}

/** A queued, unsent job of this member for `URL` in chat A. */
function job(hash: string, overrides: Partial<JobRow> = {}): JobRow {
  return {
    id: 'job-a',
    org_id: 'org-1',
    thread_id: 'thread-a',
    uploaded_by: 'user-1',
    source_url_hash: hash,
    pasted_token: URL,
    status: 'queued',
    lifecycle_status: 'active',
    message_bound_at_ms: null,
    created_at_ms: NOW - 60_000,
    file_metadata_id: null,
    ...overrides,
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('in-thread dedup [VID-R3]', () => {
  it('keeps chat A’s job after the same URL was pasted in chat B (A/B/A)', async () => {
    const hash = await urlHash();
    const table = [
      job(hash),
      job(hash, {
        id: 'job-b',
        thread_id: 'thread-b',
        created_at_ms: NOW - 1_000,
      }),
    ];
    const fake = fakeSql(table);
    const variant = `${URL}&si=shared#t=3`;

    const jobId = await ingestVideoUrl(fake.sql, paste('thread-a', variant));

    expect(jobId).toBe('job-a');
    expect(fake.inserts).toBe(0);
    expect(addJobInTx).not.toHaveBeenCalled();
    // The re-paste's token replaces the old one, so the send strips it.
    expect(table[0]?.pasted_token).toBe(variant);
  });

  it('reuses the job for a consecutive paste in the same chat', async () => {
    const hash = await urlHash();
    const fake = fakeSql([job(hash)]);

    expect(await ingestVideoUrl(fake.sql, paste('thread-a'))).toBe('job-a');
    expect(fake.inserts).toBe(0);
  });

  it('starts its own job in a chat that has none for the URL', async () => {
    const hash = await urlHash();
    const fake = fakeSql([job(hash)]);

    expect(await ingestVideoUrl(fake.sql, paste('thread-b'))).toBe('job-new');
    expect(fake.inserts).toBe(1);
    expect(addJobInTx).toHaveBeenCalledOnce();
  });

  it.each([
    ['a failed', { status: 'failed' }],
    ['a removed', { status: 'skipped' }],
    ['an already sent', { message_bound_at_ms: NOW - 30_000 }],
    ['another member’s', { uploaded_by: 'user-2' }],
    ['a day-old', { created_at_ms: NOW - 25 * 60 * 60 * 1000 }],
    ['a trashed', { lifecycle_status: 'trashed' }],
  ] as const)('does not reuse %s job', async (_label, overrides) => {
    const hash = await urlHash();
    const fake = fakeSql([job(hash, overrides)]);

    expect(await ingestVideoUrl(fake.sql, paste('thread-a'))).toBe('job-new');
  });

  it('reuses a job whose lifecycle was never stamped', async () => {
    const hash = await urlHash();
    const fake = fakeSql([job(hash, { lifecycle_status: null })]);

    expect(await ingestVideoUrl(fake.sql, paste('thread-a'))).toBe('job-a');
  });

  it('finds the eligible job behind a newer failed one in the same chat', async () => {
    const hash = await urlHash();
    const fake = fakeSql([
      job(hash),
      job(hash, {
        id: 'job-a-failed',
        status: 'failed',
        created_at_ms: NOW - 5_000,
      }),
    ]);

    expect(await ingestVideoUrl(fake.sql, paste('thread-a'))).toBe('job-a');
    expect(fake.inserts).toBe(0);
  });
});
