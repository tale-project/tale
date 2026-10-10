// @vitest-environment node

/**
 * The embedding model over MCP, through the writer the Data residency page
 * uses: the config store is a temporary directory, the database a double
 * that runs the writer's transaction, and the corpus counts and the
 * documents and websites that follow a save are doubles too.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Sql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { corpus, createAuditLog } = vi.hoisted(() => ({
  corpus: { documents: 0, websites: 0 },
  createAuditLog: vi.fn(),
}));

vi.mock('../audit_logs/service.ts', () => ({ createAuditLog }));
vi.mock('../documents/service.ts', () => ({
  approxCountDocumentsForOrg: vi.fn(async () => corpus.documents),
}));
vi.mock('../websites/service.ts', () => ({
  countWebsites: vi.fn(async () => corpus.websites),
  websitesAfterEmbeddingChange: vi.fn(async () => ({ queued: 0 })),
}));
vi.mock('./service.ts', () => ({
  requeueEmbeddingBlockedDocuments: vi.fn(async () => ({ requeued: 0 })),
  requeueDocumentsWithoutVectors: vi.fn(async () => ({ requeued: 0 })),
}));

import type { McpCaller } from '../mcp/caller.ts';
import { applySettings } from '../mcp/settings/apply.ts';
import { getSettings } from '../mcp/settings/get.ts';
import { planSettings } from '../mcp/settings/plan.ts';
import type { SettingsContext } from '../mcp/settings/registry.ts';
import { knowledgeEmbeddingSettings } from './settings-resource.ts';

const registry = { 'knowledge-embedding': knowledgeEmbeddingSettings };

const MODEL = {
  providerSlug: 'local-embedding',
  model: 'example-embedding',
  dimensions: 1024,
};

function contextOf(role: string): SettingsContext {
  const caller: McpCaller = {
    organizationId: 'org-1',
    orgSlug: 'acme',
    userId: `user-${role}`,
    role,
    credential: { kind: 'api-key', apiKeyId: 'key-laptop' },
  };
  // Every statement answers the caller's address; the write lock reads
  // nothing back.
  const tag = async () => [{ email: `${role}@example.test` }];
  const sql = Object.assign(tag, {
    begin: (work: (tx: unknown) => Promise<unknown>) => work(tag),
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return { sql: sql as unknown as Sql, caller };
}

const change = (config: unknown) => ({
  kind: 'knowledge-embedding' as const,
  op: 'set' as const,
  config,
});

/** Store a model as the page would, and answer its hash. */
async function stored(config: unknown): Promise<string> {
  const answer = await applySettings(
    contextOf('admin'),
    registry,
    [change(config)],
    { 'knowledge-embedding': null },
  );
  const [applied] = (answer.applied ?? []) as Array<{ hash: string }>;
  if (applied === undefined) throw new Error(JSON.stringify(answer));
  createAuditLog.mockClear();
  return applied.hash;
}

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'tale-embedding-kind-'));
  vi.stubEnv('TALE_CONFIG_DIR', dir);
  corpus.documents = 0;
  corpus.websites = 0;
  createAuditLog.mockReset();
  createAuditLog.mockResolvedValue('row-1');
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});

describe('who reads and changes the embedding model [MCP-R10]', () => {
  it('lets an owner or admin read and change it, and nobody else', async () => {
    for (const role of ['owner', 'admin']) {
      expect(await knowledgeEmbeddingSettings.access(contextOf(role))).toEqual({
        read: true,
        write: true,
      });
    }
    for (const role of ['developer', 'member']) {
      expect(await knowledgeEmbeddingSettings.access(contextOf(role))).toEqual({
        read: false,
        write: false,
      });
      const answer = await getSettings(contextOf(role), registry, {
        kinds: ['knowledge-embedding'],
      });
      expect(answer.refused).toEqual([
        expect.objectContaining({
          kind: 'knowledge-embedding',
          code: 'ORG_FORBIDDEN',
        }),
      ]);
    }
  });
});

describe('planning a change of the embedding model', () => {
  it('takes a first model while the knowledge base is empty, saying so [MCP-R28]', async () => {
    const plan = await planSettings(contextOf('admin'), registry, [
      change(MODEL),
    ]);
    expect(plan.changes[0]).toMatchObject({
      key: 'knowledge-embedding',
      action: 'create',
      currentHash: null,
      effects: ['requires-empty-corpus'],
      risk: 'critical',
    });
  });

  it('refuses another model while documents or websites are indexed, naming how many [MCP-R28]', async () => {
    const hash = await stored(MODEL);
    corpus.documents = 40;
    corpus.websites = 2;
    const plan = await planSettings(contextOf('admin'), registry, [
      change({ ...MODEL, model: 'example-embedding-2' }),
    ]);
    expect(plan.changes[0]).toMatchObject({
      currentHash: hash,
      refusal: {
        code: 'EMBEDDING_CORPUS_NOT_EMPTY',
        error: expect.stringContaining('40 documents and 2 websites'),
        hint: expect.stringContaining('Settings > Data residency'),
        data: { documents: 40, websites: 2 },
      },
    });
  });

  it('changes the similarity floor and the serving limits at any time [MCP-R28]', async () => {
    await stored(MODEL);
    corpus.documents = 40;
    const plan = await planSettings(contextOf('admin'), registry, [
      change({ ...MODEL, minSimilarity: 0.4, maxConcurrentRequests: 2 }),
    ]);
    expect(plan.changes[0]).toMatchObject({
      action: 'update',
      effects: [],
      diff: [
        { path: '/maxConcurrentRequests', after: 2 },
        { path: '/minSimilarity', after: 0.4 },
      ],
    });
  });

  it('keeps a stored setting the change leaves out, as the page does', async () => {
    await stored({ ...MODEL, minSimilarity: 0.4 });
    const plan = await planSettings(contextOf('admin'), registry, [
      change(MODEL),
    ]);
    expect(plan.changes[0]).toMatchObject({ action: 'unchanged' });
  });

  it('names every problem, a field the model does not have among them', async () => {
    const plan = await planSettings(contextOf('admin'), registry, [
      change({ ...MODEL, dimensions: 1000, modle: 'x' }),
    ]);
    expect(plan.changes[0]?.refusal).toMatchObject({
      code: 'SETTINGS_INVALID',
      data: {
        issues: [expect.objectContaining({ path: '/config/dimensions' })],
      },
    });
    const misspelled = await planSettings(contextOf('admin'), registry, [
      change({ ...MODEL, modle: 'x' }),
    ]);
    expect(misspelled.changes[0]?.refusal?.data).toEqual({
      issues: [
        {
          path: '/config/modle',
          code: 'unrecognized_key',
          message: 'is not a field of this setting',
        },
      ],
    });
  });
});

describe('applying a change of the embedding model', () => {
  it('saves through the page’s writer, audited under the person who holds the key', async () => {
    const answer = await applySettings(
      contextOf('admin'),
      registry,
      [change(MODEL)],
      { 'knowledge-embedding': null },
    );
    const read = await knowledgeEmbeddingSettings.read(
      contextOf('admin'),
      null,
    );
    expect(answer).toEqual({
      applied: [
        {
          kind: 'knowledge-embedding',
          id: null,
          key: 'knowledge-embedding',
          action: 'create',
          hash: read?.hash,
        },
      ],
      skipped: [],
    });
    expect(read?.config).toEqual(MODEL);
    expect(createAuditLog).toHaveBeenCalledOnce();
    expect(createAuditLog.mock.lastCall?.[1]).toMatchObject({
      action: 'knowledge_embedding.saved',
      actorId: 'user-admin',
      actorEmail: 'admin@example.test',
      newState: MODEL,
    });
  });

  it('lands only on the model the agent read', async () => {
    const hash = await stored(MODEL);
    // Someone changes the floor in Tale after the agent read the model.
    await applySettings(
      contextOf('owner'),
      registry,
      [change({ ...MODEL, minSimilarity: 0.5 })],
      { 'knowledge-embedding': hash },
    );
    const answer = await applySettings(
      contextOf('admin'),
      registry,
      [change({ ...MODEL, minSimilarity: 0.3 })],
      { 'knowledge-embedding': hash },
    );
    expect(answer).toMatchObject({
      code: 'SETTINGS_STALE',
      applied: [],
    });
  });
});
