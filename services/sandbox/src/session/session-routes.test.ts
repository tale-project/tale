// Integration test for the /v1/sessions route layer WITHOUT Docker. A fake
// runnerd (a real Bun.serve emitting NDJSON exec events) stands in for the
// in-container daemon, and a fake SessionBackend points the registry at it.
// This proves the create→exec→destroy flow + the NDJSON→SSE translation that
// milestone A's container e2e then re-confirms end-to-end.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import type {
  BackendSession,
  SessionBackend,
  SessionSpec,
} from '../backend/types.ts';
import type { SpawnerConfig } from '../types.ts';
import { SessionRoutes } from './session-routes.ts';
import { TEST_SESSION_CONFIG } from './session-test-config.ts';

const cfg: SpawnerConfig = {
  backend: 'docker',
  port: 8003,
  sandboxToken: null, // unsigned dev mode — runnerd token is '' on the wire
  runtimeImage: 'tale-sandbox-runtime:test',
  runtime: 'runc',
  k8s: {
    namespace: 'tale-sandbox',
    runtimeClassName: 'gvisor',
    spawnerImage: 'tale-sandbox:test',
    cacheMode: 'none',
    workspaceSizeLimit: '4Gi',
  },
  defaultTimeoutMs: 30_000,
  maxTimeoutMs: 300_000,
  maxConcurrent: 4,
  hostSessionRoot: '/tmp/tale-sandbox/sessions',
  cacheVolumePrefix: { pip: 'pip', npm: 'npm', bun: 'bun' },
  egressNetwork: 'tale-sandbox-net',
  egressProxy: 'http://sandbox-egress:3128',
  stdoutMaxBytes: 5_242_880,
  stderrMaxBytes: 5_242_880,
  outputFileMaxBytes: 52_428_800,
  outputTotalMaxBytes: 104_857_600,
  maxRequestBodyBytes: 262_144,
  session: TEST_SESSION_CONFIG,
};

// --- fake runnerd: replays a scripted NDJSON exec stream -------------------

let fakeServer: ReturnType<typeof Bun.serve>;
let fakeBaseUrl = '';
const created = new Set<string>();
const destroyed = new Set<string>();

function ndjson(lines: object[]): string {
  return lines.map((l) => JSON.stringify(l)).join('\n') + '\n';
}

beforeAll(() => {
  fakeServer = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === '/healthz') {
        return Response.json({
          ok: true,
          bootedAtMs: 0,
          lastActivityAtMs: 0,
          liveExecs: 0,
        });
      }
      if (url.pathname === '/execs' && req.method === 'POST') {
        // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
        const body = (await req.json()) as {
          command?: string[];
          shell?: string;
        };
        // Echo-style script: a start, one stdout chunk, then exit 0.
        const text: string =
          body.command?.slice(1).join(' ') ?? body.shell ?? '';
        return new Response(
          ndjson([
            { t: 'start', execId: 'e1', startedAtMs: 1 },
            { t: 'stdout', b64: Buffer.from(`${text}\n`).toString('base64') },
            {
              t: 'exit',
              exitCode: 0,
              durationMs: 5,
              truncated: { stdout: false, stderr: false },
              timedOut: false,
              cancelled: false,
            },
          ]),
          { headers: { 'content-type': 'application/x-ndjson' } },
        );
      }
      if (url.pathname === '/env' && req.method === 'POST') {
        return Response.json({ ok: true, denied: ['HOME'] });
      }
      if (url.pathname === '/files/stage' && req.method === 'POST') {
        return Response.json({
          staged: [{ path: 'repo/README.md', bytes: 12 }],
          skipped: [],
        });
      }
      if (url.pathname === '/fs/list') {
        return Response.json({
          entries: [{ name: 'README.md', type: 'file', size: 12, mtimeMs: 1 }],
        });
      }
      if (url.pathname === '/fs/read') {
        return new Response('file-bytes', {
          headers: { 'content-type': 'application/octet-stream' },
        });
      }
      if (url.pathname.endsWith('/attach')) {
        return new Response(
          ndjson([
            { t: 'stdout', b64: Buffer.from('replayed').toString('base64') },
            {
              t: 'exit',
              exitCode: 0,
              durationMs: 1,
              truncated: { stdout: false, stderr: false },
              timedOut: false,
              cancelled: false,
            },
          ]),
          { headers: { 'content-type': 'application/x-ndjson' } },
        );
      }
      return new Response('not found', { status: 404 });
    },
  });
  fakeBaseUrl = `http://127.0.0.1:${fakeServer.port}`;
});

afterAll(() => fakeServer.stop(true));

const fakeBackend: SessionBackend = {
  kind: 'docker',
  async createSession(spec: SessionSpec) {
    created.add(spec.sessionId);
  },
  async resolveEndpoint() {
    return fakeBaseUrl;
  },
  async destroySession(sessionId: string) {
    const had = created.has(sessionId);
    destroyed.add(sessionId);
    return had;
  },
  async listSessions(): Promise<BackendSession[]> {
    return [];
  },
};

interface SseEvent {
  event: string;
  // JSON.parse result — read loosely in assertions below.
  data: Record<string, unknown>;
}

// SSE parser for the test (mirrors the platform-side parser shape).
async function readSse(res: Response): Promise<{ events: SseEvent[] }> {
  const text = await res.text();
  const events: SseEvent[] = [];
  for (const block of text.split('\n\n')) {
    const lines = block.split('\n');
    const evLine = lines.find((l) => l.startsWith('event: '));
    const dataLine = lines.find((l) => l.startsWith('data: '));
    if (evLine && dataLine) {
      // JSON.parse returns `any`; assigning into the Record-typed field needs
      // no assertion (and reading fields below stays `unknown`-safe).
      events.push({
        event: evLine.slice(7),
        data: JSON.parse(dataLine.slice(6)),
      });
    }
  }
  return { events };
}

describe('SessionRoutes (fake runnerd)', () => {
  test('create → exec echo → destroy', async () => {
    const routes = new SessionRoutes(cfg, fakeBackend);

    // create
    const createRes = await routes.handleCreate(
      JSON.stringify({
        sessionId: 'sess1',
        organizationId: 'org_1',
        profile: 'agent',
      }),
    );
    expect(createRes.status).toBe(201);
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
    const createBody = (await createRes.json()) as {
      session: { state: string };
    };
    expect(createBody.session.state).toBe('ready');
    expect(created.has('sess1')).toBe(true);

    // get
    expect(routes.handleGet('sess1').status).toBe(200);

    // exec echo
    const execReq = new Request('http://x/v1/sessions/sess1/exec', {
      method: 'POST',
    });
    const execRes = routes.handleExec(
      execReq,
      'sess1',
      JSON.stringify({
        execId: 'e1',
        command: ['echo', 'hi'],
        cwd: '/workspace/repo',
      }),
    );
    expect(execRes.headers.get('content-type')).toContain('text/event-stream');
    const { events } = await readSse(execRes);
    const phase = events.find((e) => e.event === 'phase');
    expect(phase?.data).toMatchObject({ phase: 'running' });
    const stdout = events.find((e) => e.event === 'stdout');
    expect(stdout?.data.text).toBe('hi\n');
    const payload = events.find((e) => e.event === 'result')?.data ?? {};
    expect(payload.status).toBe('completed');
    expect(payload.exitCode).toBe(0);
    expect(Buffer.from(String(payload.stdoutBase64), 'base64').toString()).toBe(
      'hi\n',
    );

    // destroy
    const destroyRes = await routes.handleDestroy('sess1');
    expect(destroyRes.status).toBe(200);
    expect(await destroyRes.json()).toMatchObject({ destroyed: true });
    expect(destroyed.has('sess1')).toBe(true);
    // gone from registry
    expect(routes.handleGet('sess1').status).toBe(404);
  });

  test('per-org session cap returns 429', async () => {
    const routes = new SessionRoutes(cfg, fakeBackend);
    await routes.handleCreate(
      JSON.stringify({ sessionId: 'a', organizationId: 'org_cap' }),
    );
    await routes.handleCreate(
      JSON.stringify({ sessionId: 'b', organizationId: 'org_cap' }),
    );
    // maxSessionsPerOrg = 2 in TEST_SESSION_CONFIG → third is rejected.
    const third = await routes.handleCreate(
      JSON.stringify({ sessionId: 'c', organizationId: 'org_cap' }),
    );
    expect(third.status).toBe(429);
    expect(await third.json()).toMatchObject({ error: 'session_quota' });
  });

  test('exec against unknown session → 404', async () => {
    const routes = new SessionRoutes(cfg, fakeBackend);
    const res = routes.handleExec(
      new Request('http://x', { method: 'POST' }),
      'nope',
      JSON.stringify({ execId: 'e1', command: ['echo'] }),
    );
    expect(res.status).toBe(404);
  });

  test('duplicate sessionId → 409', async () => {
    const routes = new SessionRoutes(cfg, fakeBackend);
    await routes.handleCreate(
      JSON.stringify({ sessionId: 'dup', organizationId: 'org_d' }),
    );
    const again = await routes.handleCreate(
      JSON.stringify({ sessionId: 'dup', organizationId: 'org_d' }),
    );
    expect(again.status).toBe(409);
  });

  test('env / files / content / attach round-trip through runnerd', async () => {
    const routes = new SessionRoutes(cfg, fakeBackend);
    await routes.handleCreate(
      JSON.stringify({ sessionId: 's2', organizationId: 'org_2' }),
    );

    // env PATCH surfaces runnerd's deny-list.
    const envRes = await routes.handleEnvPatch(
      's2',
      JSON.stringify({ set: { GITHUB_TOKEN: 'x', HOME: '/evil' } }),
    );
    expect(await envRes.json()).toMatchObject({ ok: true, denied: ['HOME'] });

    // files stage.
    const stageRes = await routes.handleFilesStage(
      's2',
      JSON.stringify({ files: [{ path: 'repo/README.md', url: 'http://x' }] }),
    );
    expect(await stageRes.json()).toMatchObject({
      staged: [{ path: 'repo/README.md', bytes: 12 }],
    });

    // files list.
    const listRes = await routes.handleFilesList('s2', 'repo');
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
    const listed = (await listRes.json()) as {
      entries: Array<{ name: string }>;
    };
    expect(listed.entries[0]).toMatchObject({ name: 'README.md' });

    // file content (raw bytes).
    const contentRes = await routes.handleFileContent('s2', 'repo/README.md');
    expect(contentRes.headers.get('content-type')).toBe(
      'application/octet-stream',
    );
    expect(await contentRes.text()).toBe('file-bytes');

    // attach re-stream.
    const attachRes = routes.handleExecAttach(
      new Request('http://x', { method: 'GET' }),
      's2',
      'e1',
    );
    const { events } = await readSse(attachRes);
    expect(events.find((e) => e.event === 'stdout')?.data.text).toBe(
      'replayed',
    );
    expect(events.find((e) => e.event === 'result')?.data.status).toBe(
      'completed',
    );
  });

  test('env/files/attach against unknown session → 404', async () => {
    const routes = new SessionRoutes(cfg, fakeBackend);
    expect((await routes.handleEnvPatch('nope', '{}')).status).toBe(404);
    expect((await routes.handleFilesStage('nope', '{}')).status).toBe(404);
    expect((await routes.handleFilesList('nope', '.')).status).toBe(404);
    expect(
      routes.handleExecAttach(
        new Request('http://x', { method: 'GET' }),
        'nope',
        'e1',
      ).status,
    ).toBe(404);
  });
});
