// @vitest-environment node

/**
 * The `.ts` data-migration lane of the boot migrator, and each data
 * migration's own contract.
 *
 * A migration that has to decide with the application's own code — which
 * files an extractor reads — is a numbered `.ts` module, applied in the same
 * filename order and ledger as the `.sql` files. What is pinned: which files
 * the migrator applies, that every `.ts` one exports `migrate`, and what
 * `0128` fills and leaves alone.
 */

import { readdir } from 'node:fs/promises';

import type { TransactionSql } from 'postgres';
import { describe, expect, it } from 'vitest';

import { RAG_ERROR_UNSUPPORTED_TYPE } from '../core/knowledge/rag_error_codes.ts';
import { HELD_BY_DOCUMENT_SQL } from '../domains/knowledge/service.ts';
import { isMigrationFile } from './migrate.ts';

const MIGRATIONS_DIR = new URL('./migrations/', import.meta.url);

describe('the files the boot migrator applies', () => {
  it.each([
    ['0010_file_metadata.sql', true],
    ['0128_rag_unsupported_type_codes.ts', true],
    ['0128_rag_unsupported_type_codes.test.ts', false],
    ['types.d.ts', false],
    ['README.md', false],
  ])('%s → %s', (name, applied) => {
    expect(isMigrationFile(name)).toBe(applied);
  });

  it('finds a migrate(tx) in every .ts migration, under a numbered name', async () => {
    const files = (await readdir(MIGRATIONS_DIR)).filter(
      (name) => isMigrationFile(name) && name.endsWith('.ts'),
    );
    expect(files).toContain('0128_rag_unsupported_type_codes.ts');
    for (const file of files) {
      expect(file).toMatch(/^\d{4}_[a-z0-9]+(?:_[a-z0-9]+)*\.ts$/);
      const module: unknown = await import(new URL(file, MIGRATIONS_DIR).href);
      expect(module, file).toHaveProperty('migrate', expect.any(Function));
    }
  });
});

interface Statement {
  text: string;
  values: unknown[];
}

/**
 * Scripted transaction: the bare rows the migration's read finds, and what
 * its UPDATE returns for the rows it filled (organization, and whether a
 * document holds the file).
 */
function fakeTx(
  bare: { id: string; fileName: string }[],
  filled: { orgId: string; listed: boolean }[] = [],
): { tx: TransactionSql; statements: Statement[] } {
  const statements: Statement[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('$').replace(/\s+/g, ' ').trim();
    statements.push({ text, values });
    if (text.startsWith('SELECT id, file_name')) return Promise.resolve(bare);
    if (text.startsWith('UPDATE app.file_metadata')) {
      return Promise.resolve(filled);
    }
    return Promise.resolve([]);
  };
  const tx = Object.assign(tag, { unsafe: (raw: string) => raw });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return { tx: tx as unknown as TransactionSql, statements };
}

async function run(tx: TransactionSql): Promise<void> {
  const { migrate } =
    await import('./migrations/0128_rag_unsupported_type_codes.ts');
  await migrate(tx);
}

const updates = (statements: Statement[]): Statement[] =>
  statements.filter((s) => s.text.startsWith('UPDATE app.file_metadata'));

const hints = (statements: Statement[]): Statement[] =>
  statements.filter((s) => s.text.includes('INSERT INTO app_realtime.outbox'));

describe('0128 — the code on a bare `unsupported`', () => {
  it('reads only rows that are `unsupported` with no code, and locks them', async () => {
    const { tx, statements } = fakeTx([]);
    await run(tx);
    expect(statements).toHaveLength(1);
    expect(statements[0]?.text).toContain(
      "WHERE rag_status = 'unsupported' AND rag_error_code IS NULL",
    );
    expect(statements[0]?.text).toContain('FOR UPDATE');
  });

  it('gives a file no extractor reads the code and sentence every lane writes', async () => {
    const { tx, statements } = fakeTx(
      [
        { id: 'file-doc', fileName: 'minutes.doc' },
        { id: 'file-xls', fileName: 'budget.xls' },
        { id: 'file-ac2', fileName: 'ledger.ac2' },
      ],
      [
        { orgId: 'org-1', listed: true },
        { orgId: 'org-1', listed: true },
        { orgId: 'org-2', listed: true },
      ],
    );

    await run(tx);

    const [update] = updates(statements);
    expect(update?.values).toEqual([
      RAG_ERROR_UNSUPPORTED_TYPE,
      ['file-doc', 'file-xls', 'file-ac2'],
      [
        'No text extractor exists for "minutes.doc".',
        'No text extractor exists for "budget.xls".',
        'No text extractor exists for "ledger.ac2".',
      ],
      HELD_BY_DOCUMENT_SQL,
    ]);
    // Never a row something filled or moved since it was read.
    expect(update?.text).toContain(
      "AND fm.rag_status = 'unsupported' AND fm.rag_error_code IS NULL",
    );
    // One refetch per organization whose lists show a filled row.
    expect(hints(statements).map((s) => s.values)).toEqual([
      ['org-1', null, 'document', null],
      ['org-2', null, 'document', null],
    ]);
  });

  // The name cannot tell why these are unsupported — an image, an empty or a
  // damaged file — so naming a cause would be a guess.
  it('leaves a bare row alone when an extractor reads its file', async () => {
    const { tx, statements } = fakeTx([
      { id: 'file-png', fileName: 'photo.png' },
      { id: 'file-txt', fileName: 'notes.txt' },
      { id: 'file-log', fileName: 'server.log' },
    ]);

    await run(tx);

    expect(updates(statements)).toEqual([]);
    expect(hints(statements)).toEqual([]);
  });

  it('fills only the unreadable rows of a mixed set, and hints no list for attachments', async () => {
    const { tx, statements } = fakeTx(
      [
        { id: 'file-png', fileName: 'photo.png' },
        { id: 'file-zip', fileName: 'bundle.zip' },
      ],
      [{ orgId: 'org-1', listed: false }],
    );

    await run(tx);

    const [update] = updates(statements);
    expect(update?.values[1]).toEqual(['file-zip']);
    expect(hints(statements)).toEqual([]);
  });
});
