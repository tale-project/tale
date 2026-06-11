// Unit tests for the `stageWorkspace` helper — the part that lays out
// /workspace/code/<files> and /workspace/.tale/runner.{py,js} on the host
// bind-mounted dir before the container starts.
//
// Files are now URL-fetched (no inline content on the wire). The tests
// spin up a per-suite `node:http` fixture server that responds to
// /file/<name> with bytes from a registered map — including raw binary
// payloads so we can assert byte-for-byte preservation of e.g. ZIP magic.
//
// We do not assert ownership (chownRecursive's lchown(65534) needs root and
// is irrelevant to the layout contract). The test catches and ignores the
// EPERM that fires after the writes have completed.

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import {
  type Server,
  type IncomingMessage,
  type ServerResponse,
  createServer,
} from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { stageWorkspace } from './exec-common.ts';
import type { ExecuteRequest } from './types.ts';

// Fixture HTTP server — each test registers `{name: bytes}` on the
// shared map, then references the file via `urlFor(name)`.
const fixtureFiles = new Map<string, Buffer>();
let fixtureServer: Server;
let fixtureBaseUrl: string;

beforeAll(async () => {
  fixtureServer = createServer((req: IncomingMessage, res: ServerResponse) => {
    const name = (req.url ?? '').replace(/^\/file\//, '');
    const bytes = fixtureFiles.get(name);
    if (bytes === undefined) {
      res.statusCode = 404;
      res.end('not found');
      return;
    }
    res.statusCode = 200;
    res.setHeader('content-type', 'application/octet-stream');
    res.setHeader('content-length', String(bytes.byteLength));
    res.end(bytes);
  });
  await new Promise<void>((resolveStart) => {
    fixtureServer.listen(0, '127.0.0.1', () => resolveStart());
  });
  const addr = fixtureServer.address();
  if (addr === null || typeof addr === 'string') {
    throw new Error('fixture server failed to bind');
  }
  fixtureBaseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolveClose, reject) => {
    fixtureServer.close((err) => (err ? reject(err) : resolveClose()));
  });
});

afterEach(() => {
  fixtureFiles.clear();
});

function urlFor(name: string): string {
  return `${fixtureBaseUrl}/file/${name}`;
}

function registerText(name: string, content: string): string {
  fixtureFiles.set(name, Buffer.from(content, 'utf8'));
  return urlFor(name);
}

function registerBytes(name: string, bytes: Buffer): string {
  fixtureFiles.set(name, bytes);
  return urlFor(name);
}

async function stageIgnoringChown(
  hostDir: string,
  req: ExecuteRequest,
): Promise<void> {
  try {
    await stageWorkspace(hostDir, req);
  } catch (err) {
    if (err instanceof Error && /EPERM|EINVAL/.test(err.message)) {
      // Non-root test env can't chown to 65534 — fine, the file layout has
      // already been written by the time chownRecursive runs.
      return;
    }
    throw err;
  }
}

function baseReq(overrides: Partial<ExecuteRequest>): ExecuteRequest {
  // Register the default main.py only when the caller didn't override
  // `files` — otherwise the registration would race with the caller's
  // own `registerText('main.py', ...)` (argument evaluation order:
  // overrides' inner calls run first, baseReq's default runs second
  // and overwrites the fixture map back to "print('ok')").
  const defaultFiles =
    overrides.files === undefined
      ? [{ path: 'main.py', url: registerText('main.py', 'print("ok")') }]
      : undefined;
  return {
    executionId: 'abc-123',
    organizationId: 'org_42',
    language: 'python',
    ...(defaultFiles !== undefined && { files: defaultFiles }),
    entryPath: 'main.py',
    // Staging tests don't exercise the upload path; the callback fields
    // are passed through opaquely. An empty slot list is a valid wire
    // payload (sandbox lazily fetches when it needs the first one).
    outputUploadSlots: [],
    outputUrlEndpoint: 'http://test-endpoint/upload-url',
    reportUploadedEndpoint: 'http://test-endpoint/report-uploaded',
    ...overrides,
  };
}

describe('stageWorkspace', () => {
  let hostDir: string;

  beforeEach(async () => {
    hostDir = await mkdtemp(join(tmpdir(), 'tale-sandbox-stage-'));
  });

  afterEach(async () => {
    await rm(hostDir, { recursive: true, force: true });
  });

  test('single-script mode stages user files at declared paths and writes NO synthetic main.py mirror', async () => {
    await stageIgnoringChown(
      hostDir,
      baseReq({
        files: [
          {
            path: 'main.py',
            url: registerText('main.py', 'print("user main")'),
          },
          { path: 'helpers.py', url: registerText('helpers.py', 'X = 1') },
        ],
        entryPath: 'main.py',
      }),
    );

    // Files land at /workspace/code/<path>.
    const main = await readFile(join(hostDir, 'code', 'main.py'), 'utf8');
    expect(main).toBe('print("user main")');
    const helpers = await readFile(join(hostDir, 'code', 'helpers.py'), 'utf8');
    expect(helpers).toBe('X = 1');

    // No /workspace/.tale/ in single-script mode.
    let taleExists = true;
    try {
      await stat(join(hostDir, '.tale'));
    } catch {
      taleExists = false;
    }
    expect(taleExists).toBe(false);
  });

  test('multi-step mode writes the wrapper at /workspace/.tale/runner.py and leaves user files untouched', async () => {
    await stageIgnoringChown(
      hostDir,
      baseReq({
        files: [
          // Critically: user file named main.py — the leaky-abstraction
          // regression gate. The wrapper must NOT overwrite it.
          {
            path: 'main.py',
            url: registerText('main.py', 'print("user generator")'),
          },
          {
            path: 'test.py',
            url: registerText('test.py', 'print("user validator")'),
          },
        ],
        entryPath: undefined,
        steps: ['main.py', 'test.py'],
      }),
    );

    // User's main.py survives intact.
    const userMain = await readFile(join(hostDir, 'code', 'main.py'), 'utf8');
    expect(userMain).toBe('print("user generator")');
    const userTest = await readFile(join(hostDir, 'code', 'test.py'), 'utf8');
    expect(userTest).toBe('print("user validator")');

    // Wrapper lands in /workspace/.tale/, NOT /workspace/code/.
    const wrapper = await readFile(join(hostDir, '.tale', 'runner.py'), 'utf8');
    expect(wrapper).toContain('Tale multi-step wrapper');
    expect(wrapper).toContain('"main.py"');
    expect(wrapper).toContain('"test.py"');

    // /workspace/code/ only contains user files + packages.json + options.json.
    const codeEntries = await readdir(join(hostDir, 'code'));
    expect(codeEntries.sort()).toEqual(
      ['main.py', 'options.json', 'packages.json', 'test.py'].sort(),
    );
    // /workspace/.tale/ only contains the wrapper.
    const taleEntries = await readdir(join(hostDir, '.tale'));
    expect(taleEntries).toEqual(['runner.py']);
  });

  test('multi-step mode for node language writes runner.js', async () => {
    await stageIgnoringChown(
      hostDir,
      baseReq({
        language: 'node',
        files: [
          {
            path: 'main.js',
            url: registerText('main.js', 'console.log("gen")'),
          },
          {
            path: 'test.js',
            url: registerText('test.js', 'console.log("validate")'),
          },
        ],
        entryPath: undefined,
        steps: ['main.js', 'test.js'],
      }),
    );

    const wrapper = await readFile(join(hostDir, '.tale', 'runner.js'), 'utf8');
    expect(wrapper).toContain('Tale multi-step wrapper');
    expect(wrapper).toContain('"main.js"');
  });

  test('polyglot mode writes runner.py + packages-{python,node}.json with per-bucket specs', async () => {
    await stageIgnoringChown(
      hostDir,
      baseReq({
        language: 'polyglot',
        files: [
          { path: 'gen.js', url: registerText('gen.js', 'console.log("gen")') },
          { path: 'qa.py', url: registerText('qa.py', 'print("qa")') },
        ],
        entryPath: undefined,
        steps: ['gen.js', 'qa.py'],
        packagesByLang: {
          python: ['markitdown[pptx]==0.0.1a3'],
          node: ['pptxgenjs@3.12.0'],
        },
      }),
    );

    // Polyglot uses the Python-hosted dispatcher.
    const wrapper = await readFile(join(hostDir, '.tale', 'runner.py'), 'utf8');
    expect(wrapper).toContain('Tale polyglot multi-step wrapper');
    expect(wrapper).toContain('interpreter_for');
    expect(wrapper).toContain('"gen.js"');
    expect(wrapper).toContain('"qa.py"');

    const pyPkgs = JSON.parse(
      await readFile(join(hostDir, 'code', 'packages-python.json'), 'utf8'),
    );
    expect(pyPkgs).toEqual(['markitdown[pptx]==0.0.1a3']);
    const nodePkgs = JSON.parse(
      await readFile(join(hostDir, 'code', 'packages-node.json'), 'utf8'),
    );
    expect(nodePkgs).toEqual(['pptxgenjs@3.12.0']);
    // Legacy packages.json is empty in polyglot mode — the entrypoint
    // reads packages-python.json / packages-node.json directly.
    const legacy = JSON.parse(
      await readFile(join(hostDir, 'code', 'packages.json'), 'utf8'),
    );
    expect(legacy).toEqual([]);
  });

  test('packages.json and options.json land in /workspace/code/ alongside user files', async () => {
    await stageIgnoringChown(
      hostDir,
      baseReq({
        packages: ['numpy', 'pandas'],
      }),
    );

    const pkgs = JSON.parse(
      await readFile(join(hostDir, 'code', 'packages.json'), 'utf8'),
    );
    expect(pkgs).toEqual(['numpy', 'pandas']);
    // options.json is reserved for future install-time flags; written as an
    // empty object today so the entrypoint's positional arg shape stays stable.
    const opts = JSON.parse(
      await readFile(join(hostDir, 'code', 'options.json'), 'utf8'),
    );
    expect(opts).toEqual({});
  });

  test('preserves binary payloads byte-for-byte (regression: legacy inline UTF-8 path mangled PPTX/XLSX/ZIP)', async () => {
    // ZIP local-file-header magic (0x50 0x4B 0x03 0x04 — "PK\x03\x04") with
    // some adjacent high-bit bytes that are NOT valid UTF-8 starters. If the
    // pipeline ever regresses to UTF-8 stringification, these bytes get
    // replaced with U+FFFD and the assertion below fails.
    const zipFixture = Buffer.from([
      0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x08, 0x00, 0xff, 0xfe,
      0xfd, 0xfc, 0xc0, 0xc1, 0xa9, 0xb5, 0x80, 0x81,
    ]);
    await stageIgnoringChown(
      hostDir,
      baseReq({
        files: [
          { path: 'main.py', url: registerText('main.py', 'print(1)') },
          { path: 'deck.pptx', url: registerBytes('deck.pptx', zipFixture) },
        ],
      }),
    );
    const written = await readFile(join(hostDir, 'code', 'deck.pptx'));
    expect(written.equals(zipFixture)).toBe(true);
  });

  test('fails fast when a workspace file URL returns 404', async () => {
    // Reference a URL the fixture server does not know about.
    let threw = false;
    try {
      await stageWorkspace(
        hostDir,
        baseReq({
          files: [
            {
              path: 'missing.py',
              // never registered — server returns 404
              url: `${fixtureBaseUrl}/file/never-registered`,
            },
          ],
          entryPath: 'missing.py',
        }),
      );
    } catch (err) {
      threw = true;
      expect(err).toBeInstanceOf(Error);
      const message = err instanceof Error ? err.message : String(err);
      expect(message).toMatch(/workspace file fetch failed/);
      expect(message).toMatch(/http_error/);
    }
    expect(threw).toBe(true);
  });

  test('stages userUploadDownloads under /workspace/uploads/ byte-for-byte', async () => {
    // Binary fixture (ZIP magic + non-UTF-8 bytes) to also catch any
    // future UTF-8 mangle regression on this newer ingress path.
    const zipFixture = Buffer.from([
      0x50, 0x4b, 0x03, 0x04, 0xff, 0xfe, 0xfd, 0xfc, 0xc0, 0xc1, 0xa9, 0xb5,
    ]);
    await stageIgnoringChown(
      hostDir,
      baseReq({
        userUploadDownloads: [
          { name: 'data.csv', url: registerText('data.csv', 'a,b\n1,2\n') },
          {
            name: 'template.pptx',
            url: registerBytes('template.pptx', zipFixture),
          },
        ],
      }),
    );

    const csv = await readFile(join(hostDir, 'uploads', 'data.csv'), 'utf8');
    expect(csv).toBe('a,b\n1,2\n');
    const pptx = await readFile(join(hostDir, 'uploads', 'template.pptx'));
    expect(pptx.equals(zipFixture)).toBe(true);
  });

  test('three sources land in three distinct dirs (code / output / uploads) without cross-contamination', async () => {
    await stageIgnoringChown(
      hostDir,
      baseReq({
        files: [
          // agent_write → /workspace/code/
          {
            path: 'qa.py',
            url: registerText('qa.py', 'print("qa")'),
          },
        ],
        entryPath: 'qa.py',
        priorOutputDownloads: [
          // run_output → /workspace/output/
          {
            name: 'deck.pptx',
            url: registerText('deck.pptx', 'deck-bytes'),
          },
        ],
        userUploadDownloads: [
          // user_upload → /workspace/uploads/
          {
            name: 'data.csv',
            url: registerText('data.csv', 'csv-bytes'),
          },
        ],
      }),
    );

    // Each file in its own dir.
    expect(await readFile(join(hostDir, 'code', 'qa.py'), 'utf8')).toBe(
      'print("qa")',
    );
    expect(await readFile(join(hostDir, 'output', 'deck.pptx'), 'utf8')).toBe(
      'deck-bytes',
    );
    expect(await readFile(join(hostDir, 'uploads', 'data.csv'), 'utf8')).toBe(
      'csv-bytes',
    );

    // Reverse: confirm no leakage across dirs.
    const codeEntries = (await readdir(join(hostDir, 'code'))).sort();
    expect(codeEntries).toEqual(
      ['options.json', 'packages.json', 'qa.py'].sort(),
    );
    const outputEntries = await readdir(join(hostDir, 'output'));
    expect(outputEntries).toEqual(['deck.pptx']);
    const uploadEntries = await readdir(join(hostDir, 'uploads'));
    expect(uploadEntries).toEqual(['data.csv']);
  });

  test('skips userUploadDownloads on 404 (does not fail-fast)', async () => {
    // Best-effort semantics, mirroring priorOutputDownloads: a single
    // missing upload should not abort the entire run.
    await stageIgnoringChown(
      hostDir,
      baseReq({
        userUploadDownloads: [
          { name: 'ghost.csv', url: `${fixtureBaseUrl}/file/never-registered` },
          { name: 'present.csv', url: registerText('present.csv', 'present') },
        ],
      }),
    );
    // The 404'd file is absent, the registered one is present.
    let ghostMissing = false;
    try {
      await stat(join(hostDir, 'uploads', 'ghost.csv'));
    } catch {
      ghostMissing = true;
    }
    expect(ghostMissing).toBe(true);
    const present = await readFile(
      join(hostDir, 'uploads', 'present.csv'),
      'utf8',
    );
    expect(present).toBe('present');
  });
});
