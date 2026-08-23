import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const CLI = resolve(import.meta.dir, '../../tale-vision');

// Host-run guards: the baked venv always has python3+Pillow; on dev hosts the
// suite needs python3 (all tests) and Pillow (downscale test only) — the
// container conformance test covers the full matrix unconditionally.
const hasPython = spawnSync('python3', ['-V']).status === 0;
const hasPil =
  hasPython && spawnSync('python3', ['-c', 'import PIL']).status === 0;
const pyTest = hasPython ? test : test.skip;
const pilTest = hasPil ? test : test.skip;

// Canonical 1×1 transparent PNG — decodes under Pillow and sniffs without it.
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

interface StubRequest {
  authorization: string | null;
  anthropicVersion: string | null;
  model: unknown;
  imageBytes: number;
  mediaType: unknown;
}

// Assertion-free traversal of the unknown request body (satisfies both the
// strict tsconfig and the no-unsafe-type-assertion lint rule).
const pick = (value: unknown, key: string): unknown => {
  if (typeof value !== 'object' || value === null) return undefined;
  return Object.entries(value).find(([k]) => k === key)?.[1];
};
const head = (value: unknown): unknown =>
  Array.isArray(value) ? value[0] : undefined;

/** Anthropic-Messages-shaped stub gateway; `failFirst` 429s the first call.
 * The CLI must be spawned ASYNC (Bun.spawn): a spawnSync would block this
 * process's event loop and the stub could never answer. */
const startStub = (opts: { failFirst?: boolean } = {}) => {
  const requests: StubRequest[] = [];
  const server = Bun.serve({
    port: 0,
    fetch: async (req) => {
      const body: unknown = await req.json();
      const source = pick(
        head(pick(head(pick(body, 'messages')), 'content')),
        'source',
      );
      const data = pick(source, 'data');
      requests.push({
        authorization: req.headers.get('authorization'),
        anthropicVersion: req.headers.get('anthropic-version'),
        model: pick(body, 'model'),
        imageBytes: Buffer.from(typeof data === 'string' ? data : '', 'base64')
          .length,
        mediaType: pick(source, 'media_type'),
      });
      if (opts.failFirst && requests.length === 1) {
        return new Response('rate limited', { status: 429 });
      }
      return Response.json({
        content: [{ type: 'text', text: `STUB ANALYSIS #${requests.length}` }],
      });
    },
  });
  return { server, requests, url: `http://127.0.0.1:${server.port}` };
};

let workDir: string;

beforeEach(() => {
  workDir = realpathSync(mkdtempSync(`${tmpdir()}/tale-vision-`));
});
afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

const runCli = async (
  args: string[],
  env: Record<string, string>,
  input?: Buffer,
) => {
  const cleanEnv: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) cleanEnv[key] = value;
  }
  const proc = Bun.spawn({
    cmd: ['python3', CLI, ...args],
    env: {
      ...cleanEnv,
      TALE_GATEWAY_URL: '',
      TALE_GATEWAY_TOKEN: '',
      TALE_VISION_MODEL: '',
      // Cache falls back to $TMPDIR/tale-vision (no /agent on hosts); pin it
      // into the per-test dir so cache tests are isolated.
      TMPDIR: workDir,
      ...env,
    },
    stdin: input ? new Uint8Array(input) : 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, status] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { status, stdout, stderr };
};

const gatewayEnv = (url: string) => ({
  TALE_GATEWAY_URL: url,
  TALE_GATEWAY_TOKEN: 'sk-bf-test',
  TALE_VISION_MODEL: 'stub-vision',
});

const ndjson = (stdout: string) =>
  stdout
    .trim()
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));

describe('tale-vision', () => {
  pyTest(
    'missing env → exit 2 with actionable message, no output',
    async () => {
      const png = join(workDir, 'a.png');
      writeFileSync(png, TINY_PNG);
      const { status, stdout, stderr } = await runCli([png], {});
      expect(status).toBe(2);
      expect(stdout.trim()).toBe('');
      expect(stderr).toContain('not configured');
      expect(stderr).toContain('TALE_VISION_MODEL');
    },
  );

  pyTest('happy path: NDJSON line with gateway contract headers', async () => {
    const { server, requests, url } = startStub();
    try {
      const png = join(workDir, 'a.png');
      writeFileSync(png, TINY_PNG);
      const { status, stdout } = await runCli([png], gatewayEnv(url));
      expect(status).toBe(0);
      const lines = ndjson(stdout);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({
        path: png,
        ok: true,
        text: 'STUB ANALYSIS #1',
        cached: false,
      });
      expect(requests).toHaveLength(1);
      expect(requests[0]?.authorization).toBe('Bearer sk-bf-test');
      expect(requests[0]?.anthropicVersion).toBe('2023-06-01');
      expect(requests[0]?.model).toBe('stub-vision');
      expect(requests[0]?.mediaType).toBe('image/png');
    } finally {
      void server.stop(true);
    }
  });

  pyTest(
    'continue-on-error: unreadable input fails its line only, exit 1',
    async () => {
      const { server, url } = startStub();
      try {
        const png = join(workDir, 'a.png');
        writeFileSync(png, TINY_PNG);
        const missing = join(workDir, 'nope.png');
        const { status, stdout } = await runCli(
          [png, missing],
          gatewayEnv(url),
        );
        expect(status).toBe(1);
        const lines = ndjson(stdout);
        expect(lines).toHaveLength(2);
        const good = lines.find((l) => l.path === png);
        const bad = lines.find((l) => l.path === missing);
        expect(good).toMatchObject({ ok: true, text: 'STUB ANALYSIS #1' });
        expect(bad?.ok).toBe(false);
        expect(String(bad?.error)).toContain('could not read input');
      } finally {
        void server.stop(true);
      }
    },
  );

  pyTest(
    'cache: second run answers from cache without a gateway call',
    async () => {
      const { server, requests, url } = startStub();
      try {
        const png = join(workDir, 'a.png');
        writeFileSync(png, TINY_PNG);
        const first = await runCli([png], gatewayEnv(url));
        expect(first.status).toBe(0);
        expect(ndjson(first.stdout)[0]).toMatchObject({ cached: false });

        const second = await runCli([png], gatewayEnv(url));
        expect(second.status).toBe(0);
        expect(ndjson(second.stdout)[0]).toMatchObject({
          ok: true,
          text: 'STUB ANALYSIS #1',
          cached: true,
        });
        expect(requests).toHaveLength(1);
      } finally {
        void server.stop(true);
      }
    },
  );

  pyTest('retry: 429 then 200 succeeds with two gateway calls', async () => {
    const { server, requests, url } = startStub({ failFirst: true });
    try {
      const png = join(workDir, 'a.png');
      writeFileSync(png, TINY_PNG);
      const { status, stdout } = await runCli([png], gatewayEnv(url));
      expect(status).toBe(0);
      expect(ndjson(stdout)[0]).toMatchObject({
        ok: true,
        text: 'STUB ANALYSIS #2',
      });
      expect(requests).toHaveLength(2);
    } finally {
      void server.stop(true);
    }
  });

  pyTest("stdin: '-' analyzes bytes from stdin", async () => {
    const { server, requests, url } = startStub();
    try {
      const { status, stdout } = await runCli(['-'], gatewayEnv(url), TINY_PNG);
      expect(status).toBe(0);
      expect(ndjson(stdout)[0]).toMatchObject({
        path: '-',
        ok: true,
        text: 'STUB ANALYSIS #1',
      });
      expect(requests).toHaveLength(1);
    } finally {
      void server.stop(true);
    }
  });

  pilTest(
    'downscale: oversized PNG is shrunk before upload',
    async () => {
      const { server, requests, url } = startStub();
      try {
        const big = join(workDir, 'big.png');
        const gen = spawnSync(
          'python3',
          [
            '-c',
            `import os; from PIL import Image; Image.frombytes('RGB', (3000, 1500), os.urandom(3000*1500*3)).save(${JSON.stringify(big)})`,
          ],
          { encoding: 'utf8' },
        );
        expect(gen.status).toBe(0);

        const { status, stdout } = await runCli(
          [big, '--max-edge', '2000'],
          gatewayEnv(url),
        );
        expect(status).toBe(0);
        expect(ndjson(stdout)[0]).toMatchObject({ ok: true });
        expect(requests).toHaveLength(1);
        const sent = requests[0]?.imageBytes ?? 0;
        expect(sent).toBeGreaterThan(0);
        // 3000×1500 noise → 2000×1000: the re-encoded payload must be far
        // smaller than the original file (dimension proof lives in the
        // container test, which decodes the payload with the venv's Pillow).
        const original = Bun.file(big).size;
        expect(sent).toBeLessThan(original);
      } finally {
        void server.stop(true);
      }
    },
    20000,
  );
});
