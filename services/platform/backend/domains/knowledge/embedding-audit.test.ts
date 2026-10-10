// @vitest-environment node

/**
 * The embedding model's audit rows: a save that changes the model and a
 * removal of a stored one each leave one row naming who made it, written
 * in the transaction that writes the file; a save of what is stored, or a
 * removal of nothing, leaves none. The config store is a temporary
 * directory; the database is a double that runs the transaction's callback
 * and answers the write lock's statement.
 */

import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Sql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { createAuditLog } = vi.hoisted(() => ({ createAuditLog: vi.fn() }));
vi.mock('../audit_logs/service.ts', () => ({ createAuditLog }));

import { deleteKnowledgeEmbedding, writeKnowledgeEmbedding } from './admin.ts';

const ADA = {
  organizationId: 'org-1',
  userId: 'user-ada',
  email: 'ada@example.test',
};

const MODEL = {
  providerSlug: 'local-embedding',
  model: 'example-embedding',
  dimensions: 1024,
};

/** A database whose transaction runs its callback on a tag that answers
 * every statement with no rows. */
function fakeSql(): { sql: Sql; tx: unknown } {
  const tx = async () => [];
  const begin = (callback: (handle: unknown) => Promise<unknown>) =>
    callback(tx);
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return { sql: { begin } as unknown as Sql, tx };
}

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'tale-embedding-audit-'));
  vi.stubEnv('TALE_CONFIG_DIR', dir);
  createAuditLog.mockReset();
  createAuditLog.mockResolvedValue('row-1');
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});

describe('a change to the embedding model is audited [KNOW-R19]', () => {
  it('records a save that changes the model once, with the model before and after, in the write transaction', async () => {
    const { sql, tx } = fakeSql();
    await writeKnowledgeEmbedding(sql, 'acme', MODEL, null, ADA);
    expect(createAuditLog).toHaveBeenCalledOnce();
    expect(createAuditLog).toHaveBeenLastCalledWith(
      tx,
      expect.objectContaining({
        organizationId: 'org-1',
        actorId: 'user-ada',
        actorEmail: 'ada@example.test',
        action: 'knowledge_embedding.saved',
        category: 'admin',
        resourceType: 'knowledge_embedding',
        newState: MODEL,
      }),
    );
    expect(createAuditLog.mock.lastCall?.[1]).not.toHaveProperty(
      'previousState',
    );

    // The same model again changes nothing, and records nothing.
    await writeKnowledgeEmbedding(sql, 'acme', MODEL, undefined, ADA);
    expect(createAuditLog).toHaveBeenCalledOnce();

    const next = { ...MODEL, model: 'example-embedding-2' };
    await writeKnowledgeEmbedding(sql, 'acme', next, undefined, ADA);
    expect(createAuditLog).toHaveBeenCalledTimes(2);
    expect(createAuditLog.mock.lastCall?.[1]).toMatchObject({
      action: 'knowledge_embedding.saved',
      previousState: MODEL,
      newState: next,
    });
  });

  it('writes no file when the audit row cannot be written', async () => {
    const { sql } = fakeSql();
    createAuditLog.mockRejectedValue(new Error('audit chain unavailable'));
    await expect(
      writeKnowledgeEmbedding(sql, 'acme', MODEL, null, ADA),
    ).rejects.toThrow('audit chain unavailable');
    createAuditLog.mockResolvedValue('row-2');
    // Nothing was stored: the same save still creates the model.
    await writeKnowledgeEmbedding(sql, 'acme', MODEL, null, ADA);
    expect(createAuditLog).toHaveBeenCalledTimes(2);
  });

  it('records the removal of a stored model, and nothing when none is stored', async () => {
    const { sql, tx } = fakeSql();
    await deleteKnowledgeEmbedding(sql, 'acme', ADA);
    expect(createAuditLog).not.toHaveBeenCalled();

    await writeKnowledgeEmbedding(sql, 'acme', MODEL, null, ADA);
    createAuditLog.mockClear();
    await deleteKnowledgeEmbedding(sql, 'acme', ADA);
    expect(createAuditLog).toHaveBeenCalledOnce();
    expect(createAuditLog).toHaveBeenLastCalledWith(
      tx,
      expect.objectContaining({
        action: 'knowledge_embedding.removed',
        actorId: 'user-ada',
        resourceType: 'knowledge_embedding',
        previousState: MODEL,
      }),
    );
  });

  it('still removes a model whose file no longer parses, and records the removal without it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { sql } = fakeSql();
    const knowledge = path.join(dir, 'acme', 'knowledge');
    await mkdir(knowledge, { recursive: true });
    await writeFile(path.join(knowledge, 'embedding.json'), '{ not json');
    await deleteKnowledgeEmbedding(sql, 'acme', ADA);
    expect(createAuditLog).toHaveBeenCalledOnce();
    expect(createAuditLog.mock.lastCall?.[1]).toMatchObject({
      action: 'knowledge_embedding.removed',
    });
    expect(createAuditLog.mock.lastCall?.[1]).not.toHaveProperty(
      'previousState',
    );
    warn.mockRestore();
  });

  it('records nothing for a write that names no one', async () => {
    const { sql } = fakeSql();
    await writeKnowledgeEmbedding(sql, 'acme', MODEL);
    await deleteKnowledgeEmbedding(sql, 'acme');
    expect(createAuditLog).not.toHaveBeenCalled();
  });
});
