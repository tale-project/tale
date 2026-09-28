// @vitest-environment node

/**
 * The `.ts` data-migration lane of the boot migrator, and each data
 * migration's own contract.
 *
 * A migration that has to decide with the application's own code — which
 * files an extractor reads — is a numbered `.ts` module, applied in the same
 * filename order and ledger as the `.sql` files. What is pinned: which files
 * the migrator applies, that every `.ts` one exports `migrate` and reaches
 * only pure rules, and what `0128` and `0129` fill and leave alone.
 */

import { existsSync, statSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { TransactionSql } from 'postgres';
import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  RAG_ERROR_IMAGE_NO_VISION,
  RAG_ERROR_UNSUPPORTED_TYPE,
} from '../core/knowledge/rag_error_codes.ts';
import {
  imageNoVisionError,
  unsupportedByName,
  unsupportedTypeError,
} from '../core/knowledge/rag_unsupported.ts';
import { isMigrationFile } from './migrate.ts';

// The indexer's by-name rule, as the migrations see it: the real rule unless
// a case stands in the one a later release ships.
vi.mock('../core/knowledge/rag_unsupported.ts', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('../core/knowledge/rag_unsupported.ts')
    >();
  return { ...actual, unsupportedByName: vi.fn(actual.unsupportedByName) };
});
const rules = await vi.importActual<
  typeof import('../core/knowledge/rag_unsupported.ts')
>('../core/knowledge/rag_unsupported.ts');

afterEach(() => {
  vi.mocked(unsupportedByName).mockImplementation(rules.unsupportedByName);
});

const MIGRATIONS_DIR = new URL('./migrations/', import.meta.url);
/** `services/platform/`, the root the pure rules are named from. */
const PLATFORM_DIR = fileURLToPath(new URL('../../', import.meta.url));

async function dataMigrationFiles(): Promise<string[]> {
  return (await readdir(MIGRATIONS_DIR)).filter(
    (name) => isMigrationFile(name) && name.endsWith('.ts'),
  );
}

describe('the files the boot migrator applies', () => {
  it.each([
    ['0010_file_metadata.sql', true],
    ['0128_rag_unsupported_type_codes.ts', true],
    ['0129_rag_unsupported_image_codes.ts', true],
    ['0128_rag_unsupported_type_codes.test.ts', false],
    ['types.d.ts', false],
    ['README.md', false],
  ])('%s → %s', (name, applied) => {
    expect(isMigrationFile(name)).toBe(applied);
  });

  it('finds a migrate(tx) in every .ts migration, under a numbered name', async () => {
    const files = await dataMigrationFiles();
    expect(files).toEqual(
      expect.arrayContaining([
        '0128_rag_unsupported_type_codes.ts',
        '0129_rag_unsupported_image_codes.ts',
      ]),
    );
    for (const file of files) {
      expect(file).toMatch(/^\d{4}_[a-z0-9]+(?:_[a-z0-9]+)*\.ts$/);
      const module: unknown = await import(new URL(file, MIGRATIONS_DIR).href);
      expect(module, file).toHaveProperty('migrate', expect.any(Function));
    }
  });
});

/**
 * What a data migration may reach, directly or through the modules those
 * import: PURE rules — code that decides from its arguments and runs no SQL
 * and no I/O. Everything else in the app is written against the schema as it
 * stands today, while a data migration runs against the schema at its own
 * number with the newest image's code (`DataMigration` in `migrate.ts`): a
 * helper that follows the schema — a domain service, the realtime outbox, a
 * job enqueue — would run a later release's SQL on an older database. A
 * module joins this list only once it is known to be pure, with why; an
 * entry ending in `/` covers the modules under it.
 */
const PURE_RULES: ReadonlyMap<string, string> = new Map([
  [
    'backend/core/knowledge/rag_error_codes.ts',
    'the RAG error code literals, imports nothing',
  ],
  [
    'backend/core/knowledge/rag_unsupported.ts',
    'the terminal causes’ sentences and the indexer’s by-name rule',
  ],
  [
    'backend/core/lib/knowledge/extraction/',
    'the extractor set: decides by extension, parses only the bytes it is handed',
  ],
]);

function isPureRule(module: string): boolean {
  return [...PURE_RULES.keys()].some((rule) =>
    rule.endsWith('/') ? module.startsWith(rule) : module === rule,
  );
}

/** A path under `services/platform/`, `/`-separated. */
function platformPath(file: string): string {
  return path.relative(PLATFORM_DIR, file).split(path.sep).join('/');
}

/** The file a specifier names, resolved the way the backend's loader does —
 * as written, with `.ts`, or as a directory's `index.ts` — or null for a
 * package, which knows nothing of the app's schema. */
function resolveImport(fromFile: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith('.')) {
    base = path.resolve(path.dirname(fromFile), specifier);
  } else if (specifier.startsWith('@/')) {
    base = path.join(PLATFORM_DIR, specifier.slice(2));
  } else {
    return null;
  }
  const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`];
  const found = candidates.find(
    (candidate) => existsSync(candidate) && statSync(candidate).isFile(),
  );
  if (found === undefined) {
    throw new Error(`cannot resolve ${specifier} from ${fromFile}`);
  }
  return found;
}

interface Reach {
  /** The module outside the pure rules. */
  readonly module: string;
  /** The module that imports it. */
  readonly from: string;
}

/**
 * Every module outside {@link PURE_RULES} that `entry` reaches — through
 * static, type-only and dynamic imports alike, following each import of a
 * pure rule in turn. `source` stands in for the entry's bytes, so the guard
 * can be shown a migration that is not on disk.
 */
async function unlistedReach(entry: string, source?: string): Promise<Reach[]> {
  const unlisted: Reach[] = [];
  const seen = new Set<string>([entry]);
  const queue: { file: string; source?: string }[] = [{ file: entry, source }];
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    const text = next.source ?? (await readFile(next.file, 'utf8'));
    for (const imported of ts.preProcessFile(text, true, true).importedFiles) {
      const target = resolveImport(next.file, imported.fileName);
      if (target === null || seen.has(target)) continue;
      seen.add(target);
      if (isPureRule(platformPath(target))) {
        queue.push({ file: target });
      } else {
        unlisted.push({
          module: platformPath(target),
          from: platformPath(next.file),
        });
      }
    }
  }
  return unlisted;
}

describe('a data migration reaches only pure rules', () => {
  it('holds for every .ts migration', async () => {
    for (const file of await dataMigrationFiles()) {
      const unlisted = await unlistedReach(
        fileURLToPath(new URL(file, MIGRATIONS_DIR)),
      );
      expect(
        unlisted,
        `${file} reaches ${unlisted.map((r) => `${r.module} (from ${r.from})`).join(', ')}. ` +
          'A data migration writes every statement itself and imports only ' +
          'pure rules (DataMigration, backend/db/migrate.ts); a module that ' +
          'runs no SQL and no I/O joins PURE_RULES here, with why.',
      ).toEqual([]);
    }
  });

  // The regression itself: 0128 once took its documents probe from the
  // knowledge service and its hint from the realtime outbox.
  it('fails a migration that imports a helper written against today’s schema', async () => {
    const probe = fileURLToPath(new URL('9999_probe.ts', MIGRATIONS_DIR));
    const unlisted = await unlistedReach(
      probe,
      [
        "import type { TransactionSql } from 'postgres';",
        "import { isSupported } from '../../core/lib/knowledge/extraction/router.ts';",
        "import { HELD_BY_DOCUMENT_SQL } from '../../domains/knowledge/status-hints.ts';",
        "import type { Hint } from '../../realtime/outbox.ts';",
        "const later = () => import('../../jobs/enqueue.ts');",
      ].join('\n'),
    );
    expect(unlisted).toEqual([
      {
        module: 'backend/domains/knowledge/status-hints.ts',
        from: 'backend/db/migrations/9999_probe.ts',
      },
      {
        module: 'backend/realtime/outbox.ts',
        from: 'backend/db/migrations/9999_probe.ts',
      },
      {
        module: 'backend/jobs/enqueue.ts',
        from: 'backend/db/migrations/9999_probe.ts',
      },
    ]);
  });

  it('names only modules that exist', () => {
    for (const rule of PURE_RULES.keys()) {
      expect(existsSync(path.join(PLATFORM_DIR, rule)), rule).toBe(true);
    }
  });
});

interface Statement {
  text: string;
  values: unknown[];
}

interface DataMigrationModule {
  migrate(tx: TransactionSql): Promise<void>;
}

/**
 * Scripted transaction, answered by position: a data migration runs its
 * statements in a fixed order — the read (the bare rows), the fill (each
 * filled row's organization, and whether a document holds its file), then
 * the hint. The answers never depend on how the SQL is worded; the
 * statements themselves are proven on real Postgres (`integration-check.ts`,
 * `migrations 0128 and 0129 …`).
 */
function fakeTx(
  bare: { id: string; fileName: string }[],
  filled: { orgId: string; listed: boolean }[] = [],
): { tx: TransactionSql; statements: Statement[] } {
  const statements: Statement[] = [];
  const answers: unknown[][] = [bare, filled];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('$').replace(/\s+/g, ' ').trim();
    statements.push({ text, values });
    return Promise.resolve(answers[statements.length - 1] ?? []);
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return { tx: tag as unknown as TransactionSql, statements };
}

async function load(file: string): Promise<DataMigrationModule> {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the lane's contract, pinned above
  return (await import(
    new URL(file, MIGRATIONS_DIR).href
  )) as DataMigrationModule;
}

const m0128 = await load('0128_rag_unsupported_type_codes.ts');
const m0129 = await load('0129_rag_unsupported_image_codes.ts');

/** The read, the fill and the hint, by position. */
const readOf = (statements: Statement[]) => statements[0];
const fillOf = (statements: Statement[]) => statements[1];
const hintOf = (statements: Statement[]) => statements[2];

describe.each([
  ['0128', m0128],
  ['0129', m0129],
])('%s — the rows it reads', (_number, migration) => {
  it('reads only rows that are `unsupported` with no code, and locks them', async () => {
    const { tx, statements } = fakeTx([]);
    await migration.migrate(tx);
    expect(statements).toHaveLength(1);
    expect(readOf(statements)?.text).toContain(
      "WHERE rag_status = 'unsupported' AND rag_error_code IS NULL",
    );
    expect(readOf(statements)?.text).toContain('FOR UPDATE');
  });

  it('re-checks the condition on the rows it fills', async () => {
    const { tx, statements } = fakeTx([
      { id: 'file-doc', fileName: 'minutes.doc' },
      { id: 'file-png', fileName: 'photo.png' },
    ]);
    await migration.migrate(tx);
    // Never a row something filled or moved since it was read.
    expect(fillOf(statements)?.text).toContain(
      "AND fm.rag_status = 'unsupported' AND fm.rag_error_code IS NULL",
    );
  });
});

describe('0128 — the code on a bare `unsupported`', () => {
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

    await m0128.migrate(tx);

    expect(fillOf(statements)?.values).toEqual([
      RAG_ERROR_UNSUPPORTED_TYPE,
      ['file-doc', 'file-xls', 'file-ac2'],
      [
        'No text extractor exists for "minutes.doc".',
        'No text extractor exists for "budget.xls".',
        'No text extractor exists for "ledger.ac2".',
      ],
    ]);
    // One refetch per organization whose lists show a filled row.
    expect(hintOf(statements)?.values).toEqual([['org-1', 'org-2']]);
    expect(statements).toHaveLength(3);
  });

  // An image is 0129's to fill; for any other name an extractor reads, the
  // name cannot tell an empty file from a damaged one.
  it('leaves a bare row alone when an extractor reads its file', async () => {
    const { tx, statements } = fakeTx([
      { id: 'file-png', fileName: 'photo.png' },
      { id: 'file-txt', fileName: 'notes.txt' },
      { id: 'file-log', fileName: 'server.log' },
    ]);

    await m0128.migrate(tx);

    expect(statements).toHaveLength(1);
  });

  it('fills only the unreadable rows of a mixed set, and hints no list for attachments', async () => {
    const { tx, statements } = fakeTx(
      [
        { id: 'file-png', fileName: 'photo.png' },
        { id: 'file-zip', fileName: 'bundle.zip' },
      ],
      [{ orgId: 'org-1', listed: false }],
    );

    await m0128.migrate(tx);

    expect(fillOf(statements)?.values[1]).toEqual(['file-zip']);
    expect(statements).toHaveLength(2);
  });
});

describe('0129 — the code on a bare `unsupported` image', () => {
  it('gives an image the code and sentence the indexer writes', async () => {
    const { tx, statements } = fakeTx(
      [
        { id: 'file-png', fileName: 'photo.png' },
        { id: 'file-jpg', fileName: 'SCAN.JPG' },
        { id: 'file-webp', fileName: 'diagram.webp' },
      ],
      [
        { orgId: 'org-1', listed: true },
        { orgId: 'org-2', listed: false },
        { orgId: 'org-3', listed: true },
      ],
    );

    await m0129.migrate(tx);

    expect(fillOf(statements)?.values).toEqual([
      RAG_ERROR_IMAGE_NO_VISION,
      ['file-png', 'file-jpg', 'file-webp'],
      [
        imageNoVisionError('photo.png'),
        imageNoVisionError('SCAN.JPG'),
        imageNoVisionError('diagram.webp'),
      ],
    ]);
    // The indexer's own sentence, not a copy of it.
    expect(fillOf(statements)?.values[2]).toContain(
      'Images cannot be indexed for search: no vision (OCR) model lane is available to read "photo.png".',
    );
    // org-2's filled row is an attachment: its lists are not told.
    expect(hintOf(statements)?.values).toEqual([['org-1', 'org-3']]);
  });

  // A `.doc` is 0128's; an extractor reads the rest, and their names cannot
  // tell an empty file from a damaged one.
  it('leaves every bare row that is no image alone', async () => {
    const { tx, statements } = fakeTx([
      { id: 'file-doc', fileName: 'minutes.doc' },
      { id: 'file-txt', fileName: 'notes.txt' },
      { id: 'file-pdf', fileName: 'report.pdf' },
      { id: 'file-log', fileName: 'server.log' },
    ]);

    await m0129.migrate(tx);

    expect(statements).toHaveLength(1);
  });

  it('fills only the images of a mixed set, and hints no list for attachments', async () => {
    const { tx, statements } = fakeTx(
      [
        { id: 'file-txt', fileName: 'notes.txt' },
        { id: 'file-png', fileName: 'photo.png' },
        { id: 'file-doc', fileName: 'minutes.doc' },
      ],
      [{ orgId: 'org-1', listed: false }],
    );

    await m0129.migrate(tx);

    expect(fillOf(statements)?.values[1]).toEqual(['file-png']);
    expect(statements).toHaveLength(2);
  });

  // It runs with the newest image's code. Once the vision lane returns, the
  // indexer's rule drops its image leg: an image then reads as a file the
  // indexer indexes, and "no vision" would be a false cause to stamp on it.
  it('follows the indexer’s rule, not the image extensions: an image the rule no longer refuses stays bare', async () => {
    vi.mocked(unsupportedByName).mockImplementation((fileName) => {
      const cause = rules.unsupportedByName(fileName);
      return cause?.code === RAG_ERROR_IMAGE_NO_VISION ? null : cause;
    });
    const { tx, statements } = fakeTx([
      { id: 'file-png', fileName: 'photo.png' },
      { id: 'file-jpg', fileName: 'SCAN.JPG' },
    ]);

    await m0129.migrate(tx);

    expect(statements).toHaveLength(1);
  });

  it('fills only what the rule answers as `image_no_vision`, with the sentence it answers', async () => {
    vi.mocked(unsupportedByName).mockImplementation((fileName) => {
      if (fileName === 'photo.png') {
        return {
          code: RAG_ERROR_IMAGE_NO_VISION,
          error: 'The rule’s own sentence for "photo.png".',
        };
      }
      // An image the rule's release no longer reads is `unsupported_type`:
      // `0128`'s to fill, never this migration's.
      return fileName === 'legacy.tiff'
        ? { code: RAG_ERROR_UNSUPPORTED_TYPE, error: 'not this one' }
        : null;
    });
    const { tx, statements } = fakeTx(
      [
        { id: 'file-png', fileName: 'photo.png' },
        { id: 'file-tiff', fileName: 'legacy.tiff' },
        { id: 'file-webp', fileName: 'diagram.webp' },
      ],
      [{ orgId: 'org-1', listed: true }],
    );

    await m0129.migrate(tx);

    expect(fillOf(statements)?.values).toEqual([
      RAG_ERROR_IMAGE_NO_VISION,
      ['file-png'],
      ['The rule’s own sentence for "photo.png".'],
    ]);
  });
});

describe('0128 and 0129 together', () => {
  // Every bare row the indexer's by-name rule decides ends with the code and
  // sentence the indexer writes for it today; every other stays bare.
  it('fill exactly the rows whose name decides the cause, as the indexer does', async () => {
    const bare = [
      'minutes.doc',
      'photo.png',
      'SCAN.JPEG',
      'notes.txt',
      'report.pdf',
      'bundle.zip',
      'server.log',
      'README',
    ].map((fileName, index) => ({ id: `file-${index}`, fileName }));
    const fills = new Map<string, { code: unknown; error: unknown }>();
    for (const migration of [m0128, m0129]) {
      const { tx, statements } = fakeTx(bare);
      await migration.migrate(tx);
      const [code, ids = [], errors = []] = (fillOf(statements)?.values ??
        []) as [unknown, string[]?, string[]?];
      ids.forEach((id, index) => {
        fills.set(id, { code, error: errors[index] });
      });
    }

    const expected = new Map(
      bare.flatMap((row) => {
        const cause = unsupportedByName(row.fileName);
        return cause === null
          ? []
          : [[row.id, { code: cause.code, error: cause.error }] as const];
      }),
    );
    expect(fills).toEqual(expected);
    expect(fills.get('file-0')?.error).toBe(
      unsupportedTypeError('minutes.doc'),
    );
    expect([...fills.keys()].sort()).toEqual([
      'file-0',
      'file-1',
      'file-2',
      'file-5',
      'file-7',
    ]);
  });
});
