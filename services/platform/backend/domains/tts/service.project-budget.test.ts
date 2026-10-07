/**
 * Reading an answer aloud in a project's thread is the project's spend: the
 * reservation measures it against the project's caps, and the settle books
 * it into the project's buckets beside the ledger. The provider, the blob
 * store and the ledger writer are stand-ins; the budget gate is the real
 * one, over a scripted `sql`.
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  budgets: null as unknown,
  incrementUsageLedger: vi.fn(async () => undefined),
}));

vi.mock('../../lib/rate-limit.ts', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../lib/rate-limit.ts')>();
  return {
    ...actual,
    checkUserRateLimit: vi.fn(async () => undefined),
    checkOrganizationRateLimit: vi.fn(async () => undefined),
  };
});
vi.mock('../../auth/membership.ts', () => ({
  findOrganizationMember: vi.fn(async () => null),
  getUserTeamIds: vi.fn(async () => []),
}));
vi.mock('../../lib/org-config.ts', () => ({
  readGovernancePolicyForOrg: vi.fn(async (_sql: unknown, _org, type) =>
    type === 'budgets' ? mocks.budgets : null,
  ),
  readSettingsForOrg: vi.fn(async () => null),
}));
vi.mock('../../jobs/enqueue.ts', () => ({
  addJobInTx: vi.fn(async () => 'job-1'),
}));
vi.mock('../files/service.ts', () => ({
  deleteOrgBlobRefs: vi.fn(async () => undefined),
  putOrgBlobBytes: vi.fn(async () => 's3:org-1/chunk-1'),
}));
vi.mock('../governance/service.ts', () => ({
  incrementUsageLedger: mocks.incrementUsageLedger,
}));
vi.mock('../../core/lib/providers/resolve_tts_model.ts', () => ({
  resolveTtsModel: vi.fn(async () => ({
    baseUrl: 'https://tts.example.test/v1',
    apiKey: 'test-key',
    modelId: 'tts-1',
    voice: 'alloy',
    audioFormat: 'mp3',
    providerName: 'openai',
    centsPerMillionCharacters: 1_500,
  })),
}));
vi.mock('../../../lib/net/host-policy.ts', () => ({
  checkProviderHostPolicy: vi.fn(),
  privateProviderHostsAllowed: vi.fn(() => false),
}));
vi.mock('../../../lib/net/safe-fetch.ts', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../lib/net/safe-fetch.ts')>();
  return {
    ...actual,
    safeFetchBinary: vi.fn(async () => ({
      status: 200,
      headers: new Headers(),
      body: new Blob([new Uint8Array(4_096)], { type: 'audio/mpeg' }),
    })),
  };
});

const { synthesizeChunk } = await import('./service.ts');

const ORG = 'org-1';
const USER = 'user-1';
const THREAD = 'thr-1';

/** A `sql` stand-in answering by the statement's text; `begin` runs the
 * callback on the same tag. */
function scriptedSql(projectId: string | null, projectSpentCents: number) {
  const tag = (strings: TemplateStringsArray) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    if (text.includes('FROM app.threads t')) return Promise.resolve([{}]);
    if (text.includes('FROM app.messages')) {
      return Promise.resolve([{ one: 1 }]);
    }
    if (text.includes('SELECT project_id AS "projectId"')) {
      return Promise.resolve([{ projectId }]);
    }
    if (text.includes('SELECT agent_slug AS "agentSlug"')) {
      return Promise.resolve([{ agentSlug: null }]);
    }
    if (text.includes('FROM app.project_usage')) {
      return Promise.resolve([
        { totalTokens: 0, costEstimate: projectSpentCents, requestCount: 1 },
      ]);
    }
    if (text.includes('INSERT INTO app.tts_audio_chunks')) {
      return Promise.resolve([{ id: 'chunk-1' }]);
    }
    // The settle's read of the reserved row.
    if (
      text.includes('FROM app.tts_audio_chunks') &&
      text.includes("status = 'pending'")
    ) {
      return Promise.resolve([
        {
          id: 'chunk-1',
          organizationId: ORG,
          threadId: THREAD,
          userId: USER,
          teamId: null,
          index: 0,
        },
      ]);
    }
    return Promise.resolve([]);
  };
  const sql = Object.assign(tag, {
    unsafe: (text: string) => text,
    json: (value: unknown) => value,
    begin: (fn: (tx: unknown) => Promise<unknown>) => fn(sql),
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double for the postgres.js tag
  return sql as unknown as Sql;
}

const CHUNK = {
  organizationId: ORG,
  userId: USER,
  messageId: 'msg-1',
  threadId: THREAD,
  index: 0,
  text: 'Hello there.',
  locale: 'en',
};

beforeEach(() => {
  mocks.budgets = null;
  mocks.incrementUsageLedger.mockClear();
});

describe('synthesizeChunk in a project’s thread [GOV-R14]', () => {
  it('books the voice output to the thread’s project', async () => {
    await expect(
      synthesizeChunk(scriptedSql('project-1', 0), CHUNK),
    ).resolves.toEqual({ status: 'ready' });
    expect(mocks.incrementUsageLedger).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: USER,
        agentSlug: '__tts__',
        projectId: 'project-1',
      }),
    );
  });

  it('books voice output outside a project to the ledger alone', async () => {
    await synthesizeChunk(scriptedSql(null, 0), CHUNK);
    expect(mocks.incrementUsageLedger).toHaveBeenCalledWith(
      expect.anything(),
      expect.not.objectContaining({ projectId: expect.anything() }),
    );
  });

  it('refuses it once the project’s cap is reached, before the provider is called', async () => {
    mocks.budgets = {
      enabled: true,
      rules: [],
      projectRules: [
        {
          scope: 'project',
          scopeId: 'project-1',
          period: 'monthly',
          maxCostCents: 100,
        },
      ],
    };
    await expect(
      synthesizeChunk(scriptedSql('project-1', 100), CHUNK),
    ).rejects.toMatchObject({ code: 'BUDGET_EXCEEDED', status: 429 });
    expect(mocks.incrementUsageLedger).not.toHaveBeenCalled();
    // Outside the project the same spend binds nothing.
    await expect(
      synthesizeChunk(scriptedSql(null, 100), CHUNK),
    ).resolves.toEqual({ status: 'ready' });
  });
});
