// @vitest-environment node

import { fork, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, gzipSync } from 'node:zlib';

import { isMigrationFile } from '@tale/shared/db/migration-files';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { readCountedMemory } from '../backend/lib/heavy-slot/memory';
import {
  childEnvironment,
  childHeapFlags,
} from '../backend/lib/heavy-slot/slot';
import { builtMigrationName } from '../backend/lib/layout';

/**
 * The production backend is built (`scripts/build-backend.ts`) and run by
 * plain `node`. These cases build it for real, into directories beside
 * `backend/` (the build reads the message catalogs from one level up, as the
 * image lays them out), and run what it wrote.
 */

const PLATFORM = fileURLToPath(new URL('..', import.meta.url));
const SUFFIX = `${process.pid}-${Date.now().toString(36)}`;
const FIRST = join(PLATFORM, `backend-dist.test-${SUFFIX}`);
const SECOND = join(PLATFORM, `backend-dist.test-${SUFFIX}-again`);
const BROKEN = join(PLATFORM, `backend-dist.test-${SUFFIX}-broken`);
/** A built app for the image check to judge: one bundle with its
 * precompressed neighbours, as scripts/precompress-dist.ts leaves it. The
 * checkout's own `dist/` is whatever a developer last built, or nothing. */
const APP = mkdtempSync(join(tmpdir(), 'tale-image-check-app-'));
const APP_BUNDLE = 'app-BQ4kL2mZ.js';

function build(outdir: string, environment: Record<string, string> = {}) {
  return spawnSync('bun', ['scripts/build-backend.ts', outdir], {
    cwd: PLATFORM,
    encoding: 'utf8',
    timeout: 120_000,
    env: { ...process.env, ...environment },
  });
}

/** Run a built program with nothing of the caller's environment but PATH. */
function node(file: string, args: string[] = [], input?: string) {
  return spawnSync('node', [file, ...args], {
    cwd: PLATFORM,
    encoding: 'utf8',
    timeout: 60_000,
    env: { PATH: process.env.PATH ?? '' },
    ...(input === undefined ? {} : { input }),
  });
}

function sha256(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

interface BuildFacts {
  entries: string[];
  chunks: number;
  sqlMigrations: number;
  dataMigrations: string[];
  bytes: number;
  bootFiles: string[];
  bootPackages: string[];
  webBootFiles: string[];
  webBootPackages: string[];
  heavyBootFiles: string[];
  heavyBootPackages: string[];
  escapedUnits: number;
}

/**
 * What a boot must not read, with what reads each instead. A backend process
 * held all of them from its first second, whether or not it ever reported an
 * error, opened a spreadsheet, took a SAML sign-in or served a request
 * (tale-project/tale#4942, finding 2): 14 MiB at rest for the first three,
 * and a third of a worker's modules for the sign-in stack.
 */
const NOT_AT_BOOT: Record<string, string> = {
  // Error reporting: `backend/sentry-sdk.ts`, with a SENTRY_DSN only.
  '@sentry/node': 'error reporting with a DSN',
  '@sentry/core': 'error reporting with a DSN',
  // Document extraction: the first document of each kind.
  xlsx: 'the first spreadsheet',
  'pdfjs-dist': 'the first PDF',
  // SAML: `core/enterprise_sso/saml/validate_assertion.ts`.
  '@node-saml/node-saml': 'the first SAML sign-in',
  'xml-crypto': 'the first SAML sign-in',
  xpath: 'the first SAML sign-in',
  // Mail connectors.
  imapflow: 'the first IMAP call',
  nodemailer: 'the first SMTP call',
  mailparser: 'the first parsed mail',
  // The HTTP surface, which `main.ts` loads for the api and all roles only:
  // a pure worker never reads the sign-in stack behind the routes, nor the
  // web tier that is served beside them.
  '@better-auth/oauth-provider': 'a role that serves requests',
  '@simplewebauthn/server': 'a role that serves requests',
  '@hono/node-server': 'a role that serves requests',
  chokidar: 'a role that serves the web tier',
  // Rendered math: the mention scanner parses math and never renders it.
  katex: 'nothing in the backend',
};

/**
 * What the web role must never read. It serves the built app and asks the
 * API for everything else, so it holds no database client, no job queue and
 * no sign-in stack: that is the point of running it alone, and what keeps it
 * a process of a few dozen megabytes. One import of a backend module from
 * `server.ts` (the request-id helper once pulled in error reporting, and
 * with it the metrics collectors and two database clients) would bring them
 * all in without a test failing anywhere else.
 */
const NEVER_IN_THE_WEB_ROLE = [
  'postgres',
  'pg',
  'pg-boss',
  'better-auth',
  '@better-auth/oauth-provider',
  '@simplewebauthn/server',
  '@aws-sdk/client-s3',
  'openai',
  '@sentry/node',
];

/**
 * What the heavy slot's child must never read. It is started for every file
 * that is indexed or read, under a memory cap, to read that file and nothing
 * else: every package it loads is memory each of those starts pays, out of
 * the cap. It opens no connection and is handed no credential, so a
 * database client or the object store's signer in its graph would be code
 * with nothing to do there. One import of a backend module from
 * `lib/heavy-slot/operations.ts` would bring them in without a test failing
 * anywhere else (tale-project/tale#4942).
 */
const NEVER_IN_THE_HEAVY_CHILD = [
  'postgres',
  'pg',
  'pg-boss',
  'better-auth',
  'hono',
  '@hono/node-server',
  'aws4fetch',
  'openai',
  '@sentry/node',
  'undici',
  // Read with the first file of their kind, not with every file.
  'pdfjs-dist',
  'xlsx',
];

let facts: BuildFacts;

beforeAll(() => {
  const result = build(FIRST);
  if (result.status !== 0) throw new Error(result.stdout + result.stderr);
  // The build's own record, read back as the checks downstream read it.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- written by the build under test
  facts = JSON.parse(
    readFileSync(join(FIRST, 'build.json'), 'utf8'),
  ) as BuildFacts;

  const bundle = Buffer.from(
    'export const answer = () => "the built app, one chunk of it";\n'.repeat(
      64,
    ),
  );
  mkdirSync(join(APP, 'assets'));
  writeFileSync(join(APP, 'assets', APP_BUNDLE), bundle);
  writeFileSync(
    join(APP, 'assets', `${APP_BUNDLE}.br`),
    brotliCompressSync(bundle),
  );
  writeFileSync(join(APP, 'assets', `${APP_BUNDLE}.gz`), gzipSync(bundle));
}, 180_000);

afterAll(() => {
  for (const directory of [FIRST, SECOND, BROKEN, APP])
    rmSync(directory, { recursive: true, force: true });
});

describe('the built backend', () => {
  it('writes the backend, the web role, the two child programs, the two operator programs and every data migration as entries', () => {
    const dataMigrations = readdirSync(
      join(PLATFORM, 'backend/db/migrations'),
    ).filter((file) => isMigrationFile(file) && file.endsWith('.ts'));
    expect(dataMigrations.length).toBeGreaterThan(0);
    expect(facts.entries).toEqual(
      [
        'main.js',
        'web-main.js',
        'node-vm-child.js',
        'heavy-child.js',
        'image-check.js',
        'symbolicate-trace.js',
        ...dataMigrations.map((file) => file.replace(/\.ts$/, '.js')),
      ].sort(),
    );
    expect(facts.dataMigrations).toEqual(dataMigrations.sort());
  });

  it('lays every built file flat in one directory, so a path worked out from a module means the same wherever its code landed', () => {
    const nested = readdirSync(FIRST, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    expect(nested).toEqual(['migrations']);
  });

  it('puts every boot migration beside the build under the name the sources record it by', () => {
    const source = readdirSync(join(PLATFORM, 'backend/db/migrations'))
      .filter(isMigrationFile)
      .sort();
    const files = readdirSync(join(FIRST, 'migrations'));
    const built = files
      .map(builtMigrationName)
      .filter((name): name is string => name !== null)
      .sort();
    // Nothing else is in the directory: every file is a migration.
    expect(built).toHaveLength(files.length);
    expect(built).toEqual(source);
    expect(facts.sqlMigrations + facts.dataMigrations.length).toBe(
      source.length,
    );
  });

  it('links no file to its source map: a running backend never loads one', () => {
    const scripts = readdirSync(FIRST).filter((file) => file.endsWith('.js'));
    expect(scripts.length).toBe(facts.entries.length + facts.chunks);
    for (const file of scripts) {
      expect(readdirSync(FIRST)).toContain(`${file}.map`);
      expect(
        readFileSync(join(FIRST, file), 'utf8').includes('sourceMappingURL'),
        file,
      ).toBe(false);
    }
  });

  it('evaluates its whole module graph under plain node and stops at the first thing it needs from the environment', () => {
    const result = node(join(FIRST, 'main.js'));
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('[backend] fatal startup error');
    expect(result.stderr).toContain('DATABASE_URL');
    // The trace is the build's: minified names at positions in main.js.
    expect(result.stderr).toMatch(/backend-dist[^/]*\/main\.js:\d+:\d+/);
  });

  it('reads that trace back as lines of the sources', () => {
    const boot = node(join(FIRST, 'main.js'));
    const mapped = node(join(FIRST, 'symbolicate-trace.js'), [], boot.stderr);
    expect(mapped.status, mapped.stderr).toBe(0);
    expect(mapped.stdout).toMatch(/\(backend\/env\.ts:\d+:\d+\)/);
    expect(mapped.stdout).toMatch(/\(backend\/main\.ts:\d+:\d+\)/);
    expect(mapped.stdout).not.toMatch(/main\.js:\d+:\d+/);
    // The message itself is untouched.
    expect(mapped.stdout).toContain('DATABASE_URL');
  });

  it('passes its own image check: the build, the app, the PII tree, the catalogs, the migrations and the two child programs', () => {
    const result = node(join(FIRST, 'image-check.js'), ['--app', APP]);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toContain(
      "ok    the app's bundles are precompressed (1, brotli and gzip)",
    );
    expect(result.stdout).toContain('ok    the PII data tree loads');
    expect(result.stdout).toContain('ok    the message catalogs load');
    expect(result.stdout).toContain(
      `ok    the boot migrations are readable (${facts.sqlMigrations} SQL, ${facts.dataMigrations.length} data)`,
    );
    expect(result.stdout).toContain(
      'ok    the code runner evaluates in its child process',
    );
    expect(result.stdout).toContain(
      'ok    the heavy slot reads a document in its child process',
    );
  });

  it("fails the image check when the heavy slot's child is missing from the build", () => {
    rmSync(BROKEN, { recursive: true, force: true });
    cpSync(FIRST, BROKEN, { recursive: true });
    rmSync(join(BROKEN, 'heavy-child.js'));
    const result = node(join(BROKEN, 'image-check.js'), ['--app', APP]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('FAIL  the heavy slot:');
    // The checks before it still report.
    expect(result.stdout).toContain(
      'ok    the code runner evaluates in its child process',
    );
  });

  it('fails the image check when the code runner child is missing from the build', () => {
    cpSync(FIRST, BROKEN, { recursive: true });
    rmSync(join(BROKEN, 'node-vm-child.js'));
    const result = node(join(BROKEN, 'image-check.js'), ['--app', APP]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('FAIL  the code runner:');
    // The checks before it still report.
    expect(result.stdout).toContain('ok    the PII data tree loads');
  });

  it('fails the image check when a compiled data migration is missing from the build', () => {
    rmSync(BROKEN, { recursive: true, force: true });
    cpSync(FIRST, BROKEN, { recursive: true });
    copyFileSync(
      join(FIRST, 'node-vm-child.js'),
      join(BROKEN, 'node-vm-child.js'),
    );
    const migration = facts.dataMigrations[0]?.replace(/\.ts$/, '.js');
    if (migration === undefined) throw new Error('no data migration to remove');
    rmSync(join(BROKEN, migration));
    const result = node(join(BROKEN, 'image-check.js'), ['--app', APP]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('FAIL  the boot migrations:');
  });

  // Every page still loads without them, and the edge compresses each
  // bundle per request instead: megabytes of encoder per open answer.
  it.each([
    ['a brotli neighbour', `${APP_BUNDLE}.br`],
    ['a gzip neighbour', `${APP_BUNDLE}.gz`],
  ])(
    'fails the image check when a bundle of the app lacks %s',
    (_what, missing) => {
      const bare = `${APP}-bare`;
      rmSync(bare, { recursive: true, force: true });
      cpSync(APP, bare, { recursive: true });
      try {
        rmSync(join(bare, 'assets', missing));
        const result = node(join(FIRST, 'image-check.js'), ['--app', bare]);
        expect(result.status).toBe(1);
        expect(result.stderr).toContain('FAIL  the built app:');
        expect(result.stderr).toContain(
          'bundles of the app without a precompressed neighbour: 1 of 1 in ',
        );
        expect(result.stderr).toContain(`${APP_BUNDLE} for one`);
        // The checks after it still report.
        expect(result.stdout).toContain('ok    the PII data tree loads');
      } finally {
        rmSync(bare, { recursive: true, force: true });
      }
    },
  );

  it('fails the image check when the app it is to judge is not there', () => {
    const result = node(join(FIRST, 'image-check.js'), [
      '--app',
      `${APP}-absent`,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('FAIL  the built app:');
    expect(result.stderr).toContain('has no assets directory');
  });

  it('asks nothing of a file too small to be worth a neighbour, or of one that is no bundle', () => {
    const small = `${APP}-small`;
    rmSync(small, { recursive: true, force: true });
    cpSync(APP, small, { recursive: true });
    try {
      writeFileSync(join(small, 'assets', 'tiny-AAAAAAAA.js'), 'export {};');
      writeFileSync(
        join(small, 'assets', 'logo-AAAAAAAA.png'),
        'x'.repeat(4096),
      );
      writeFileSync(
        join(small, 'assets', `${APP_BUNDLE}.map`),
        'x'.repeat(4096),
      );
      const result = node(join(FIRST, 'image-check.js'), ['--app', small]);
      expect(result.status, result.stdout + result.stderr).toBe(0);
    } finally {
      rmSync(small, { recursive: true, force: true });
    }
  });

  it('writes every script in one-byte characters, so V8 holds its text at a byte a character', () => {
    // One character above U+00FF makes V8 keep the whole script two bytes a
    // character; the sources are full of em dashes and arrows.
    expect(facts.escapedUnits).toBeGreaterThan(1000);
    for (const file of readdirSync(FIRST).filter((name) =>
      name.endsWith('.js'),
    )) {
      const text = readFileSync(join(FIRST, file), 'utf8');
      let wide = 0;
      for (let index = 0; index < text.length; index += 1)
        if (text.charCodeAt(index) > 0xff) wide += 1;
      expect(wide, file).toBe(0);
    }
  });

  it('reads at boot only main.js and what it imports statically', () => {
    expect(facts.bootFiles).toContain('main.js');
    expect(facts.bootFiles.length).toBeLessThan(facts.chunks);
    // The programs beside the backend are no part of its boot.
    expect(facts.bootFiles).not.toContain('image-check.js');
    expect(facts.bootFiles).not.toContain('symbolicate-trace.js');
    expect(facts.bootFiles).not.toContain('node-vm-child.js');
    expect(facts.bootFiles).not.toContain('heavy-child.js');
    expect(facts.bootFiles).not.toContain('web-main.js');
  });

  it("reads for the heavy slot's child only heavy-child.js and what it imports statically", () => {
    expect(facts.heavyBootFiles).toContain('heavy-child.js');
    expect(facts.heavyBootFiles).not.toContain('main.js');
    // A fraction of the backend's own boot: the readers, the scan, the
    // policy and the chunker.
    expect(facts.heavyBootPackages.length).toBeLessThan(
      facts.bootPackages.length / 4,
    );
    for (const name of ['yauzl', 'saxes', 'fast-xml-parser', 'zod'])
      expect(facts.heavyBootPackages).toContain(name);
  });

  it.each(NEVER_IN_THE_HEAVY_CHILD)(
    "keeps %s out of the heavy slot's child: it reads one file and holds nothing else",
    (name) => {
      expect(facts.heavyBootPackages).not.toContain(name);
    },
  );

  // The child as the backend starts it, from the built files alone: its
  // readers load the chunks they are in (a PDF's reader is not part of its
  // start), and what it makes comes back over the channel.
  it("runs the heavy slot's child from the build, and reads a PDF and a spreadsheet in it", async () => {
    const work = mkdtempSync(join(tmpdir(), 'tale-built-heavy-child-'));
    try {
      const pdf = join(work, 'two-lines.pdf');
      const stream = 'BT /F1 12 Tf 72 700 Td (Read by the built child) Tj ET';
      const objects = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
        `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
      ];
      let body = '%PDF-1.4\n';
      const offsets: number[] = [];
      objects.forEach((object, at) => {
        offsets.push(body.length);
        body += `${at + 1} 0 obj\n${object}\nendobj\n`;
      });
      const xref = body.length;
      body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
      for (const offset of offsets)
        body += `${String(offset).padStart(10, '0')} 00000 n \n`;
      body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
      writeFileSync(pdf, body, 'latin1');

      const ask = (request: Record<string, unknown>): Promise<unknown> =>
        new Promise((resolve, reject) => {
          const child = fork(join(FIRST, 'heavy-child.js'), [], {
            execArgv: ['--max-old-space-size=57', '--expose-gc'],
            env: { PATH: process.env.PATH ?? '' },
            stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
          });
          let answer: unknown;
          child.on('message', (message: unknown) => {
            if (
              typeof message === 'object' &&
              message !== null &&
              'ready' in message
            ) {
              child.send(request);
            } else answer = message;
          });
          child.on('error', reject);
          child.on('close', (code) => {
            if (answer === undefined) {
              reject(new Error(`the child exited ${String(code)} unanswered`));
            } else resolve(answer);
          });
        });
      const limits = {
        memoryMb: 96,
        maxImagePixels: 6_000_000,
        reopenAfterBytes: 16_000_000,
      };

      const textPath = join(work, 'pdf.txt');
      expect(
        await ask({
          op: 'extract',
          inputPath: pdf,
          fileName: 'two-lines.pdf',
          textPath,
          processImages: true,
          ...limits,
        }),
      ).toMatchObject({ ok: true, op: 'extract', facts: { pageCount: 1 } });
      expect(readFileSync(textPath, 'utf8')).toBe(
        '--- Page 1 ---\nRead by the built child',
      );

      // No workbook: SheetJS, which is a chunk of its own, reads the text.
      const sheet = join(work, 'table.xlsx');
      writeFileSync(sheet, 'name,count\nalpha,3\n');
      const prepared = await ask({
        op: 'prepare',
        inputPath: sheet,
        input: 'file',
        fileName: 'table.xlsx',
        piiConfig: null,
        textPath: join(work, 'sheet.txt'),
        chunksPath: join(work, 'chunks.jsonl'),
        indexPath: join(work, 'chunks.idx'),
        ...limits,
      });
      expect(prepared).toMatchObject({
        ok: true,
        op: 'prepare',
        prepared: { kind: 'ready', chunksTotal: 1 },
      });
      expect(readFileSync(join(work, 'chunks.jsonl'), 'utf8')).toContain(
        'name | count\\nalpha | 3',
      );
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }, 60_000);

  // What a deployment on a small host is promised: a document of sixteen
  // megabytes of text is read where one file is given 96 MiB. The child
  // holds the text once and writes its chunks as it cuts them; holding them
  // as lists, as it once did, it ran out of memory at ten megabytes. Every
  // character is two bytes in memory here, as in a text from a word
  // processor.
  it("prepares sixteen megabytes of text in the built child, within a small host's 96 MiB", async () => {
    const work = mkdtempSync(join(tmpdir(), 'tale-built-heavy-child-'));
    try {
      const line = 'The figures of the region follow, „as agreed“, for 20 €.\n';
      const lines = Math.ceil((16 * 1024 * 1024) / Buffer.byteLength(line));
      const input = join(work, 'large.txt');
      writeFileSync(input, line.repeat(lines));

      const capMb = 96;
      let peak = 0;
      const answer = await new Promise<unknown>((resolve, reject) => {
        const child = fork(join(FIRST, 'heavy-child.js'), [], {
          execArgv: childHeapFlags(capMb),
          env: childEnvironment({ PATH: process.env.PATH ?? '' }),
          stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
        });
        const watch = setInterval(() => {
          if (child.pid === undefined) return;
          peak = Math.max(peak, readCountedMemory(child.pid) ?? 0);
        }, 20);
        let answered: unknown;
        child.on('message', (message: unknown) => {
          if (
            typeof message === 'object' &&
            message !== null &&
            'ready' in message
          ) {
            child.send({
              op: 'prepare',
              inputPath: input,
              input: 'file',
              fileName: 'large.txt',
              piiConfig: null,
              textPath: join(work, 'large.text'),
              chunksPath: join(work, 'chunks.jsonl'),
              indexPath: join(work, 'chunks.idx'),
              memoryMb: capMb,
              maxImagePixels: 6_000_000,
              reopenAfterBytes: 16_000_000,
            });
          } else answered = message;
        });
        child.on('error', reject);
        child.on('close', (code, signal) => {
          clearInterval(watch);
          if (answered === undefined) {
            reject(
              new Error(
                `the child stopped unanswered (${signal ?? String(code)})`,
              ),
            );
          } else resolve(answered);
        });
      });

      expect(answer).toMatchObject({
        ok: true,
        op: 'prepare',
        prepared: { kind: 'ready' },
      });
      // The index holds where each chunk starts, and where the last ends.
      const chunks = readFileSync(join(work, 'chunks.idx')).length / 8 - 1;
      expect(chunks).toBeGreaterThan(5000);
      // What it held is read from /proc, which is Linux's.
      if (process.platform === 'linux') {
        expect(peak).toBeGreaterThan(0);
        expect(peak / (1024 * 1024)).toBeLessThan(capMb);
      }
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }, 60_000);

  it('reads for the web role only web-main.js and what it imports statically', () => {
    expect(facts.webBootFiles).toContain('web-main.js');
    expect(facts.webBootFiles).not.toContain('main.js');
    // A fraction of the backend's own boot: the web tier and little else.
    expect(facts.webBootPackages.length).toBeLessThan(
      facts.bootPackages.length / 4,
    );
    for (const name of ['hono', '@hono/node-server', 'prom-client'])
      expect(facts.webBootPackages).toContain(name);
  });

  it.each(NEVER_IN_THE_WEB_ROLE)(
    'keeps %s out of the web role: it holds no database, no jobs and no sign-in',
    (name) => {
      expect(facts.webBootPackages).not.toContain(name);
    },
  );

  it.each(Object.entries(NOT_AT_BOOT))(
    'does not read %s at boot: it waits for %s',
    (name) => {
      expect(facts.bootPackages).not.toContain(name);
    },
  );

  it('still reads at boot what every role needs', () => {
    for (const name of ['postgres', 'pg-boss', 'zod', 'yaml'])
      expect(facts.bootPackages).toContain(name);
  });

  // Bun writes the NODE_ENV of the build's environment into the code. This
  // build ran under the test runner's (NODE_ENV=test) and the check below
  // runs with no NODE_ENV at all: what it reads is what the build was given.
  // Built as anything else, the backend ran every library's development
  // checks and put the dev image's live-reload script in the page.
  it('is a production build, whatever environment built it and whatever it runs in', () => {
    const result = node(join(FIRST, 'image-check.js'), ['--app', APP]);
    expect(result.stdout).toContain('ok    the backend is a production build');
  });

  // The first build ran under this test's environment (NODE_ENV=test) and
  // this one runs as a development shell would: Bun writes the NODE_ENV of
  // the build's environment into the code unless the build names one.
  it('builds the same bytes twice, whatever environment builds it', () => {
    const again = build(SECOND, { NODE_ENV: 'development' });
    expect(again.status, again.stdout + again.stderr).toBe(0);
    const files = readdirSync(FIRST).filter((file) => file.endsWith('.js'));
    expect(readdirSync(SECOND).filter((file) => file.endsWith('.js'))).toEqual(
      files,
    );
    for (const file of files)
      expect(sha256(join(SECOND, file)), file).toBe(sha256(join(FIRST, file)));
  }, 180_000);
});

describe('the check that a built file asks the runtime for no package', () => {
  it('names a package import, and passes node builtins, relative files and strings that read like imports', () => {
    const source = [
      'import a from"left-pad";',
      'import b from"node:fs";',
      'import c from"fs";',
      'import{d}from"./chunk-abc.js";',
      'const e=await import("@scope/pkg/sub");',
      'const f=`from "not-an-import"`;',
    ].join('');
    const result = spawnSync(
      'bun',
      [
        '-e',
        `import { runtimeImports } from './scripts/build-backend.ts'; console.log(JSON.stringify(runtimeImports(${JSON.stringify(source)})));`,
      ],
      { cwd: PLATFORM, encoding: 'utf8', timeout: 60_000 },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(['@scope/pkg/sub', 'left-pad']);
  });
});
