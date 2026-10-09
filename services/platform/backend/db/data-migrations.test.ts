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
        '0166_project_agent_handles_backfill.ts',
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
  ['lib/shared/agent-handle.ts', 'the agent handle slug rule, imports nothing'],
  [
    'lib/shared/mention-handles.ts',
    'the handle forms a person, an automation and an agent answer to, imports nothing',
  ],
]);

/**
 * The packages that reach may import, each with why: a bare specifier —
 * `node:*`, an npm package, a workspace package such as `@tale/shared/…` —
 * is outside the app's modules, so {@link PURE_RULES} cannot vouch for it,
 * and one can do exactly what a data migration must not: `node:fs` reads the
 * disk, `node:net` the network, a runtime `postgres` opens a connection of
 * its own, and `@tale/shared/db/…` runs today's SQL. `typeOnly` admits an
 * `import type` alone, which the compiler erases (`verbatimModuleSyntax`
 * keeps every other import, even one naming only types). A package joins
 * this list only once what the reach takes from it is known to be pure.
 */
const PURE_PACKAGES: ReadonlyMap<string, { why: string; typeOnly?: true }> =
  new Map([
    [
      'postgres',
      { why: '`TransactionSql`, the type of `migrate(tx)`', typeOnly: true },
    ],
    ['node:path', { why: '`extname`, the extractor router’s string rule' }],
    ['pdfjs-dist', { why: 'parses the PDF bytes `pdf.ts` hands it' }],
    [
      'pdfjs-dist/build/pdf.worker.mjs',
      { why: 'pdfjs’s in-process worker, loaded by `pdfjs_loader.ts`' },
    ],
    ['jszip', { why: 'unpacks the OOXML and ODF bytes it is handed' }],
    ['fast-xml-parser', { why: 'parses the XML text it is handed' }],
    ['xlsx', { why: 'parses the spreadsheet bytes it is handed' }],
  ]);

function isPureRule(module: string): boolean {
  return [...PURE_RULES.keys()].some((rule) =>
    rule.endsWith('/') ? module.startsWith(rule) : module === rule,
  );
}

function isPurePackage(specifier: string, typeOnly: boolean): boolean {
  const entry = PURE_PACKAGES.get(specifier);
  return entry !== undefined && (entry.typeOnly !== true || typeOnly);
}

/** A path under `services/platform/`, `/`-separated. */
function platformPath(file: string): string {
  return path.relative(PLATFORM_DIR, file).split(path.sep).join('/');
}

/** The file a specifier names, resolved the way the backend's loader does —
 * as written, with `.ts`, or as a directory's `index.ts` — or null for a
 * bare specifier, a package, which {@link PURE_PACKAGES} judges instead. */
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

interface Import {
  readonly specifier: string;
  /** Erased by the compiler: `import type`, `export type … from`, or a type
   * position's `import('…')`. */
  readonly typeOnly: boolean;
}

/** Whether an import or re-export declaration is erased whole. */
function erased(node: ts.ImportDeclaration | ts.ExportDeclaration): boolean {
  if (ts.isExportDeclaration(node)) return node.isTypeOnly;
  return node.importClause?.isTypeOnly === true;
}

/** Every module a file imports — static, type-only, dynamic, re-exported
 * and `require`d alike — and whether the import survives compilation. */
function importsOf(file: string, text: string): Import[] {
  const found: Import[] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      found.push({
        specifier: node.moduleSpecifier.text,
        typeOnly: erased(node),
      });
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    ) {
      found.push({ specifier: node.argument.literal.text, typeOnly: true });
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === 'require'))
    ) {
      const [argument] = node.arguments;
      if (argument === undefined || !ts.isStringLiteralLike(argument)) {
        throw new Error(`${file}: an import this guard cannot follow`);
      }
      found.push({ specifier: argument.text, typeOnly: false });
    }
    ts.forEachChild(node, visit);
  };
  visit(ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true));
  return found;
}

interface Reach {
  /** The module outside the pure rules, or the package outside the pure
   * packages. */
  readonly module: string;
  /** The module that imports it. */
  readonly from: string;
}

/**
 * What `entry` reaches — through static, type-only and dynamic imports
 * alike, following each import of a pure rule in turn: every module outside
 * {@link PURE_RULES} and every package import {@link PURE_PACKAGES} does not
 * admit (`unlisted`), and every package it imports (`packages`). `source`
 * stands in for the entry's bytes, so the guard can be shown a migration
 * that is not on disk.
 */
async function walkReach(
  entry: string,
  source?: string,
): Promise<{ unlisted: Reach[]; packages: Set<string> }> {
  const unlisted: Reach[] = [];
  const packages = new Set<string>();
  const seen = new Set<string>([entry]);
  const queue: { file: string; source?: string }[] = [{ file: entry, source }];
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    const text = next.source ?? (await readFile(next.file, 'utf8'));
    const from = platformPath(next.file);
    for (const { specifier, typeOnly } of importsOf(next.file, text)) {
      const target = resolveImport(next.file, specifier);
      if (target === null) {
        packages.add(specifier);
        const reported = unlisted.some(
          (reach) => reach.module === specifier && reach.from === from,
        );
        if (!isPurePackage(specifier, typeOnly) && !reported) {
          unlisted.push({ module: specifier, from });
        }
        continue;
      }
      if (seen.has(target)) continue;
      seen.add(target);
      if (isPureRule(platformPath(target))) {
        queue.push({ file: target });
      } else {
        unlisted.push({ module: platformPath(target), from });
      }
    }
  }
  return { unlisted, packages };
}

async function unlistedReach(entry: string, source?: string): Promise<Reach[]> {
  return (await walkReach(entry, source)).unlisted;
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
          'runs no SQL and no I/O joins PURE_RULES here, and a package ' +
          'PURE_PACKAGES, with why.',
      ).toEqual([]);
    }
  });

  // The regression itself: 0128 once took its documents probe from the
  // knowledge service and its hint from the realtime outbox. A package can
  // do the same from outside the app's modules.
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
        "import { readFile } from 'node:fs/promises';",
        "import { transactSerializable } from '@tale/shared/db/serializable';",
        // A runtime `postgres` opens a connection of its own.
        "import postgres from 'postgres';",
      ].join('\n'),
    );
    const from = 'backend/db/migrations/9999_probe.ts';
    expect(unlisted).toEqual([
      { module: 'backend/domains/knowledge/status-hints.ts', from },
      { module: 'backend/realtime/outbox.ts', from },
      { module: 'backend/jobs/enqueue.ts', from },
      { module: 'node:fs/promises', from },
      { module: '@tale/shared/db/serializable', from },
      { module: 'postgres', from },
    ]);
  });

  // Only the compiler's erased forms are types alone: under
  // `verbatimModuleSyntax` an import naming only types inline still loads
  // the package.
  it.each([
    ["import type { Sql } from 'postgres';", false],
    ["export type { Sql } from 'postgres';", false],
    ["type Handle = typeof import('postgres');", false],
    ["import { type Sql } from 'postgres';", true],
    ["import postgres from 'postgres';", true],
    ["const load = () => import('postgres');", true],
    ["const pg = require('postgres');", true],
  ])('a type-only package: `%s` reported → %s', async (line, reported) => {
    const probe = fileURLToPath(new URL('9999_probe.ts', MIGRATIONS_DIR));
    expect(await unlistedReach(probe, line)).toEqual(
      reported
        ? [{ module: 'postgres', from: 'backend/db/migrations/9999_probe.ts' }]
        : [],
    );
  });

  it('names only modules that exist', () => {
    for (const rule of PURE_RULES.keys()) {
      expect(existsSync(path.join(PLATFORM_DIR, rule)), rule).toBe(true);
    }
  });

  it('names only packages a data migration still reaches', async () => {
    const reached = new Set<string>();
    for (const file of await dataMigrationFiles()) {
      const { packages } = await walkReach(
        fileURLToPath(new URL(file, MIGRATIONS_DIR)),
      );
      for (const name of packages) reached.add(name);
    }
    expect(
      [...PURE_PACKAGES.keys()].filter((name) => !reached.has(name)),
      'PURE_PACKAGES entries no data migration imports any more',
    ).toEqual([]);
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

/**
 * Scripted transaction for 0166, answered by statement text: the agents of
 * the projects that need a fill, the auth-table probe, the organization's
 * people, its automations, then the fill.
 */
function fakeAgentTx(answers: {
  agents: unknown[];
  members?: unknown[];
  automations?: unknown[];
}): { tx: TransactionSql; statements: Statement[] } {
  const statements: Statement[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('$').replace(/\s+/g, ' ').trim();
    statements.push({ text, values });
    if (text.includes('FROM app.project_agents') && text.startsWith('SELECT')) {
      return Promise.resolve(answers.agents);
    }
    if (text.includes('to_regclass')) return Promise.resolve([{ ready: true }]);
    if (text.includes('FROM "member"')) {
      return Promise.resolve(answers.members ?? []);
    }
    if (text.includes('FROM app.automations')) {
      return Promise.resolve(answers.automations ?? []);
    }
    return Promise.resolve([]);
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return { tx: tag as unknown as TransactionSql, statements };
}

const m0166 = await load('0166_project_agent_handles_backfill.ts');

describe('0166 — handles for the agents that existed before them [PROJ-R18]', () => {
  const agent = (
    id: string,
    projectId: string,
    name: string,
    createdAt: number,
    extra: { handle?: string; legacyHandles?: string[] } = {},
  ) => ({
    id,
    projectId,
    orgId: 'org-1',
    name,
    handle: extra.handle ?? null,
    legacyHandles: extra.legacyHandles ?? null,
    createdAt,
  });

  it('mints per project, oldest first, skipping what people and automations answer to, and freezes the older forms', async () => {
    const { tx, statements } = fakeAgentTx({
      agents: [
        agent('a2', 'p1', 'My Opus Agent 3', 2),
        agent('a1', 'p1', 'My Opus Agent #3', 1),
        agent('a3', 'p1', '发票助手', 3),
        agent('a4', 'p1', 'Ops', 4),
        agent('a5', 'p1', 'Invoice checker', 5),
        agent('b1', 'p2', 'My Opus Agent #3', 1),
        agent('c1', 'p3', 'Kept', 1, { handle: 'kept', legacyHandles: [] }),
        agent('c2', 'p3', 'Research Bot', 2),
      ],
      members: [
        {
          orgId: 'org-1',
          userId: 'u1',
          email: 'ops@example.com',
          name: 'Ops Team',
        },
      ],
      automations: [{ orgId: 'org-1', name: 'invoice-checker' }],
    });

    await m0166.migrate(tx);

    const fill = statements.at(-1);
    expect(fill?.text).toContain('UPDATE app.project_agents');
    expect(fill?.text).toContain(
      'AND (a.handle IS NULL OR a.legacy_handles IS NULL)',
    );
    const [ids, handles, legacies] = (fill?.values ?? []) as string[][];
    const byId = Object.fromEntries(
      (ids ?? []).map((id, index) => [
        id,
        [handles?.[index], JSON.parse(legacies?.[index] ?? 'null')],
      ]),
    );
    expect(byId).toEqual({
      // `#` was never part of a handle: this agent answered only to its id.
      a1: ['my-opus-agent-3', []],
      a2: ['my-opus-agent-3-02', ['my.opus.agent.3', 'myopusagent3']],
      a3: ['agent', []],
      a4: ['ops-02', ['ops']],
      a5: ['invoice-checker-02', ['invoice.checker', 'invoicechecker']],
      b1: ['my-opus-agent-3', []],
      c2: ['research-bot', ['research.bot', 'researchbot']],
    });
  });

  it('reads only the projects that need a fill, locks them, and stops when none does', async () => {
    const { tx, statements } = fakeAgentTx({ agents: [] });
    await m0166.migrate(tx);
    expect(statements).toHaveLength(1);
    expect(statements[0]?.text).toContain(
      'WHERE handle IS NULL OR legacy_handles IS NULL',
    );
    expect(statements[0]?.text).toContain('FOR UPDATE');
  });

  it('writes nothing when every agent of the read projects is filled', async () => {
    const { tx, statements } = fakeAgentTx({
      agents: [
        agent('c1', 'p3', 'Kept', 1, { handle: 'kept', legacyHandles: [] }),
      ],
    });
    await m0166.migrate(tx);
    expect(statements.some((s) => s.text.startsWith('UPDATE'))).toBe(false);
  });
});
