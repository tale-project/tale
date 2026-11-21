// @vitest-environment node

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  cpSync,
  readdirSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isMigrationFile } from '@tale/shared/db/migration-files';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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

let facts: BuildFacts;

beforeAll(() => {
  const result = build(FIRST);
  if (result.status !== 0) throw new Error(result.stdout + result.stderr);
  // The build's own record, read back as the checks downstream read it.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- written by the build under test
  facts = JSON.parse(
    readFileSync(join(FIRST, 'build.json'), 'utf8'),
  ) as BuildFacts;
}, 180_000);

afterAll(() => {
  for (const directory of [FIRST, SECOND, BROKEN])
    rmSync(directory, { recursive: true, force: true });
});

describe('the built backend', () => {
  it('writes the backend, the web role, the code runner child, the two operator programs and every data migration as entries', () => {
    const dataMigrations = readdirSync(
      join(PLATFORM, 'backend/db/migrations'),
    ).filter((file) => isMigrationFile(file) && file.endsWith('.ts'));
    expect(dataMigrations.length).toBeGreaterThan(0);
    expect(facts.entries).toEqual(
      [
        'main.js',
        'web-main.js',
        'node-vm-child.js',
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

  it('passes its own image check: the build, the PII tree, the catalogs, the migrations and the code runner child', () => {
    const result = node(join(FIRST, 'image-check.js'));
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toContain('ok    the PII data tree loads');
    expect(result.stdout).toContain('ok    the message catalogs load');
    expect(result.stdout).toContain(
      `ok    the boot migrations are readable (${facts.sqlMigrations} SQL, ${facts.dataMigrations.length} data)`,
    );
    expect(result.stdout).toContain(
      'ok    the code runner evaluates in its child process',
    );
  });

  it('fails the image check when the code runner child is missing from the build', () => {
    cpSync(FIRST, BROKEN, { recursive: true });
    rmSync(join(BROKEN, 'node-vm-child.js'));
    const result = node(join(BROKEN, 'image-check.js'));
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
    const result = node(join(BROKEN, 'image-check.js'));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('FAIL  the boot migrations:');
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
    expect(facts.bootFiles).not.toContain('web-main.js');
  });

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
    const result = node(join(FIRST, 'image-check.js'));
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
