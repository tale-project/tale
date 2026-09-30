// @vitest-environment node

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ActionCtx } from '../lib/ctx';
import { scanWebsiteImpl } from './crawl_action';
import { getKnowledgePoolForOrg } from './pool';

vi.mock('./pool', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./pool')>()),
  getKnowledgePoolForOrg: vi.fn(),
}));

/**
 * The first link of a scan the scheduler resumes. A scan cut off by a
 * restart left its claim held for the two-hour takeover window; the resumed
 * link names the claim it replaces, and a link whose job has already ended
 * keeps the shutdown out of the site's failure ledger.
 */

const SCAN = {
  domain: 'ruler.example',
  orgSlug: 'ruler',
  organizationId: 'org-1',
};
const CLAIM = '2026-09-30 13:19:05.123456+00';

interface Statement {
  text: string;
  params: unknown[];
}

/** A corpus double whose claim is held by another scan. */
function heldCorpus(): { sql: Sql; statements: Statement[] } {
  const statements: Statement[] = [];
  const unsafe = (text: string, params: unknown[] = []): Promise<unknown[]> => {
    const statement = text.replace(/\s+/g, ' ').trim();
    statements.push({ text: statement, params });
    if (statement.startsWith('SELECT kind')) {
      return Promise.resolve([{ kind: 'site', robots_disallow: null }]);
    }
    if (statement.startsWith('SELECT domain')) {
      return Promise.resolve([{ domain: SCAN.domain }]);
    }
    return Promise.resolve([]);
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return { sql: { unsafe } as unknown as Sql, statements };
}

/** A corpus double whose pool was closed under the link. */
function closedCorpus(): Sql {
  const ended = Object.assign(new Error('write CONNECTION_ENDED'), {
    code: 'CONNECTION_ENDED',
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return { unsafe: () => Promise.reject(ended) } as unknown as Sql;
}

function engineCtx(): { ctx: ActionCtx; recorded: ReturnType<typeof vi.fn> } {
  const recorded = vi.fn(async () => ({ paused: false }));
  const ctx = {
    runMutation: recorded,
    runQuery: vi.fn(),
    scheduler: { runAfter: vi.fn() },
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only what the link reaches
  return { ctx: ctx as unknown as ActionCtx, recorded };
}

const claimOf = (statements: Statement[]): Statement | undefined =>
  statements.find((statement) => statement.text.startsWith('UPDATE'));

beforeEach(() => {
  vi.mocked(getKnowledgePoolForOrg).mockReset();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('scanWebsiteImpl — taking a stopped scan over', () => {
  it('claims against the heartbeat the scheduler named', async () => {
    const { sql, statements } = heldCorpus();
    vi.mocked(getKnowledgePoolForOrg).mockResolvedValue(sql);

    await scanWebsiteImpl(engineCtx().ctx, { ...SCAN, takeover: CLAIM });

    const claim = claimOf(statements);
    expect(claim?.text).toContain("status = 'scanning'");
    // As text: bound as a timestamp the driver rounds the heartbeat to the
    // millisecond and the claim, stored to the microsecond, never matches.
    expect(claim?.text).toContain('updated_at = $2::text::timestamptz');
    expect(claim?.params).toEqual([SCAN.domain, CLAIM]);
  });

  it('names no heartbeat on an ordinary scan, and a continuation claims nothing', async () => {
    const ordinary = heldCorpus();
    vi.mocked(getKnowledgePoolForOrg).mockResolvedValue(ordinary.sql);
    await scanWebsiteImpl(engineCtx().ctx, SCAN);
    expect(claimOf(ordinary.statements)?.params).toEqual([SCAN.domain, null]);

    const later = heldCorpus();
    vi.mocked(getKnowledgePoolForOrg).mockResolvedValue(later.sql);
    await scanWebsiteImpl(engineCtx().ctx, {
      ...SCAN,
      continuation: 2,
      scanStartedAt: '2026-09-30T13:00:00.000Z',
      takeover: CLAIM,
    });
    expect(
      later.statements.some((statement) =>
        statement.text.includes("SET status = 'scanning'"),
      ),
    ).toBe(false);
  });
});

describe('scanWebsiteImpl — a continuation link', () => {
  // A resume takes over only a claim older than a link can hold it; a
  // continuation may have waited in the queue long after the link before it
  // refreshed the claim, so it refreshes the claim itself when it starts.
  it('refreshes the claim when it starts, and only a claim that is scanning', async () => {
    const { sql, statements } = heldCorpus();
    vi.mocked(getKnowledgePoolForOrg).mockResolvedValue(sql);

    await scanWebsiteImpl(engineCtx().ctx, {
      ...SCAN,
      continuation: 1,
      scanStartedAt: '2026-09-30T13:00:00.000Z',
    });

    const refresh = statements.find((statement) =>
      statement.text.startsWith('UPDATE'),
    );
    expect(refresh?.text).toContain('SET updated_at = NOW()');
    expect(refresh?.text).toContain("status = 'scanning'");
    expect(refresh?.params).toEqual([SCAN.domain]);
  });
});

describe('scanWebsiteImpl — a link whose job has ended', () => {
  // A process that stops closes its pools under the links still running,
  // and their next query fails as a lost connection. Recorded as an
  // unreachable corpus, that would count toward the three failures that
  // pause a site and notify its admins.
  it('records nothing when the connection is lost after its job ended', async () => {
    vi.mocked(getKnowledgePoolForOrg).mockResolvedValue(closedCorpus());
    const { ctx, recorded } = engineCtx();
    const job = new AbortController();
    job.abort();

    await expect(
      scanWebsiteImpl(ctx, { ...SCAN, signal: job.signal }),
    ).resolves.toBeNull();

    expect(recorded).not.toHaveBeenCalled();
  });

  it('still records an unreachable corpus while its job is running', async () => {
    vi.mocked(getKnowledgePoolForOrg).mockResolvedValue(closedCorpus());
    const { ctx, recorded } = engineCtx();

    await scanWebsiteImpl(ctx, {
      ...SCAN,
      signal: new AbortController().signal,
    });

    expect(recorded).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        domain: SCAN.domain,
        corpusUnreachable: true,
      }),
    );
  });
});
