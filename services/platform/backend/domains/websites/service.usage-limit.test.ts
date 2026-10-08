// @vitest-environment node

/**
 * A scan a usage limit stopped embedding leaves a note on its website row:
 * when, the refusal's sentence, and whose spend the scan was. The hourly
 * pass scans such a site again — under the same requester, who keeps
 * paying for it — once their limits have room, and leaves it alone (no
 * page fetched) while they do not. A later scan that embedded clears the
 * note.
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../jobs/enqueue.ts', () => ({
  addJobInTx: vi.fn(() => Promise.resolve('job-1')),
}));
vi.mock('../../realtime/outbox.ts', () => ({ emitHintInTx: vi.fn() }));
vi.mock('../../lib/org-config.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/org-config.ts')>()),
  resolveOrgSlug: vi.fn(async () => 'acme'),
}));
vi.mock('../governance/direct-calls.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../governance/direct-calls.ts')>()),
  directCallBlocked: vi.fn(async () => null),
}));

import { addJobInTx } from '../../jobs/enqueue.ts';
import { directCallBlocked } from '../governance/direct-calls.ts';
import { recordEmbeddingLimit, resumeUsageLimitedScans } from './service.ts';

interface Row {
  id: string;
  organizationId: string;
  domain: string;
  status: string;
  scanInterval: string;
  metadata: Record<string, unknown> | null;
}

/** A websites table of `rows`: reads answer from it, an UPDATE writes its
 * metadata back. */
function fakeSql(rows: Row[]): {
  sql: Sql;
  updates: Record<string, unknown>[];
} {
  const updates: Record<string, unknown>[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('$');
    if (text.includes("metadata ->> 'embeddingLimitedAt' IS NOT NULL")) {
      return Promise.resolve(
        rows.filter((row) => row.metadata?.embeddingLimitedAt != null),
      );
    }
    if (text.includes('UPDATE app.websites SET')) {
      const metadata = values.find(
        (value) =>
          value !== null &&
          typeof value === 'object' &&
          !Array.isArray(value) &&
          'embeddingLimitedAt' in value,
      );
      if (metadata !== undefined)
        updates.push(metadata as Record<string, unknown>);
      return Promise.resolve([{ ...rows[0], metadata }]);
    }
    if (text.includes('FROM app.websites')) {
      return Promise.resolve(rows.slice(0, 1));
    }
    return Promise.resolve([]);
  };
  const sql = Object.assign(tag, {
    unsafe: (text: string) => ({ text }),
    json: (value: unknown) => value,
    begin: async (work: (tx: unknown) => Promise<unknown>) => work(sql),
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return { sql: sql as unknown as Sql, updates };
}

const ROW: Row = {
  id: 'w-1',
  organizationId: 'org-1',
  domain: 'ruler.example',
  status: 'active',
  scanInterval: '1d',
  metadata: null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('recordEmbeddingLimit', () => {
  it('notes when, why and for whom a usage limit stopped the scan’s embedding', async () => {
    const { sql, updates } = fakeSql([ROW]);
    await recordEmbeddingLimit(sql, {
      organizationId: 'org-1',
      domain: 'ruler.example',
      reason: 'Usage limit reached.',
      requestedBy: { userId: 'user-1', apiKeyId: 'key-1' },
    });
    expect(updates[0]).toMatchObject({
      embeddingLimitedAt: expect.any(Number),
      embeddingLimitReason: 'Usage limit reached.',
      embeddingLimitRequestedBy: { userId: 'user-1', apiKeyId: 'key-1' },
    });
  });

  it('clears the note once a scan embedded, and writes nothing without one', async () => {
    const noted = fakeSql([
      {
        ...ROW,
        metadata: { embeddingLimitedAt: 1, embeddingLimitReason: 'x' },
      },
    ]);
    await recordEmbeddingLimit(noted.sql, {
      organizationId: 'org-1',
      domain: 'ruler.example',
    });
    expect(noted.updates[0]).toEqual({
      embeddingLimitedAt: null,
      embeddingLimitReason: null,
      embeddingLimitRequestedBy: null,
    });

    const clean = fakeSql([ROW]);
    await recordEmbeddingLimit(clean.sql, {
      organizationId: 'org-1',
      domain: 'ruler.example',
    });
    expect(clean.updates).toEqual([]);
  });
});

describe('resumeUsageLimitedScans', () => {
  const noted: Row = {
    ...ROW,
    metadata: {
      embeddingLimitedAt: 1,
      embeddingLimitReason: 'Usage limit reached.',
      embeddingLimitRequestedBy: { userId: 'user-1', apiKeyId: 'key-1' },
    },
  };

  it('scans a noted site again under its requester once their limits have room [WEB-R11]', async () => {
    const { sql } = fakeSql([noted]);
    await expect(resumeUsageLimitedScans(sql)).resolves.toBe(1);
    expect(directCallBlocked).toHaveBeenCalledWith(sql, {
      organizationId: 'org-1',
      subject: {
        userId: 'user-1',
        agentSlug: '__embedding__',
        apiKeyId: 'key-1',
      },
    });
    expect(addJobInTx).toHaveBeenCalledWith(sql, 'websites.scan', {
      domain: 'ruler.example',
      orgSlug: 'acme',
      organizationId: 'org-1',
      requestedBy: { userId: 'user-1', apiKeyId: 'key-1' },
    });
  });

  it('fetches nothing for a site whose requester is still over a limit [GOV-R4]', async () => {
    vi.mocked(directCallBlocked).mockResolvedValueOnce({
      scope: 'user',
      code: 'COST_LIMIT',
      period: 'monthly',
      used: 100,
      limit: 100,
      reason: 'x',
      resetsAt: Date.UTC(2026, 10, 1),
    });
    const { sql } = fakeSql([noted]);
    await expect(resumeUsageLimitedScans(sql)).resolves.toBe(0);
    expect(addJobInTx).not.toHaveBeenCalled();
  });

  it('books a scheduled scan’s resume to the organization', async () => {
    const { sql } = fakeSql([
      { ...noted, metadata: { embeddingLimitedAt: 1 } },
    ]);
    await resumeUsageLimitedScans(sql);
    expect(directCallBlocked).toHaveBeenCalledWith(sql, {
      organizationId: 'org-1',
      subject: { userId: '__automation__', agentSlug: '__embedding__' },
    });
    expect(addJobInTx).toHaveBeenCalledWith(sql, 'websites.scan', {
      domain: 'ruler.example',
      orgSlug: 'acme',
      organizationId: 'org-1',
    });
  });
});
