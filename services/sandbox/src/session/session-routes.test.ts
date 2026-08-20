// Integration test for the /v1/sessions route layer WITHOUT Docker. A fake
// runnerd (a real Bun.serve emitting NDJSON exec events) stands in for the
// in-container daemon, and a fake SessionBackend points the registry at it.
// This proves the create→exec→destroy flow + the NDJSON→SSE translation that
// milestone A's container e2e then re-confirms end-to-end.

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';

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
  runtimeTier: 'runc',
  dockerInContainer: false,
  dockerBuildCache: false,
  buildkitdImage: 'tale-sandbox-buildkitd:test',
  buildkitdMirrorImage: 'registry:2',
  browserView: false,
  transparentEgress: false,
  k8s: {
    namespace: 'tale-sandbox',
    runtimeClassName: null,
    spawnerImage: 'tale-sandbox:test',
    cacheMode: 'none',
    workspaceSizeLimit: '4Gi',
  },
  defaultTimeoutMs: 30_000,
  maxTimeoutMs: 300_000,
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
const stopped = new Set<string>();
const stdinWrites: Array<{ execId: string; b64?: string; eof?: boolean }> = [];
// Captures each POST /execs body the spawner sends to runnerd, so tests can
// assert the per-exec stdoutMaxBytes/stderrMaxBytes the spawner chose.
const execRequests: Array<{
  execId?: string;
  command?: string[];
  shell?: string;
  stdoutMaxBytes?: number;
  stderrMaxBytes?: number;
}> = [];
// Mutable so the sweepExpired tests can drive runnerd's reported
// activity/liveExecs/activeScreencasts.
const fakeHealth = {
  lastActivityAtMs: 0,
  liveExecs: 0,
  activeScreencasts: 0,
};

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
          lastActivityAtMs: fakeHealth.lastActivityAtMs,
          liveExecs: fakeHealth.liveExecs,
          activeScreencasts: fakeHealth.activeScreencasts,
        });
      }
      if (url.pathname === '/execs' && req.method === 'POST') {
        // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
        const body = (await req.json()) as {
          execId?: string;
          command?: string[];
          shell?: string;
          stdoutMaxBytes?: number;
          stderrMaxBytes?: number;
        };
        execRequests.push(body);
        // Echo-style script: a start, one stdout chunk, then exit 0.
        const text: string =
          body.command?.slice(1).join(' ') ?? body.shell ?? '';
        // Sentinel: simulate a process that raced the deadline but still exited
        // cleanly (exitCode 0 + timedOut) — the H8 wire-coherence case.
        const cleanTimeout = text.includes('__timeout_clean__');
        // Sentinel: simulate a pre-spawn `fail` line (the process never ran,
        // so runnerd reports no measurement).
        if (text.includes('__fail__')) {
          return new Response(
            ndjson([
              { t: 'fail', code: 'INVALID_CWD', message: 'cwd rejected' },
            ]),
            { headers: { 'content-type': 'application/x-ndjson' } },
          );
        }
        return new Response(
          ndjson([
            { t: 'start', execId: 'e1', startedAtMs: 1 },
            { t: 'stdout', b64: Buffer.from(`${text}\n`).toString('base64') },
            {
              t: 'exit',
              exitCode: 0,
              durationMs: 5,
              truncated: { stdout: false, stderr: false },
              timedOut: cleanTimeout,
              cancelled: false,
            },
          ]),
          { headers: { 'content-type': 'application/x-ndjson' } },
        );
      }
      if (url.pathname.endsWith('/cancel') && req.method === 'POST') {
        return Response.json({ killed: true });
      }
      // GET /execs/:id — per-exec status (no path suffix). The execId prefix
      // drives the state so a test can request running/exited/gone explicitly.
      const statusMatch = /^\/execs\/([^/]+)$/.exec(url.pathname);
      if (statusMatch && req.method === 'GET') {
        const id = decodeURIComponent(statusMatch[1] ?? '');
        if (id.startsWith('gone')) return new Response('gone', { status: 404 });
        if (id.startsWith('done') || id.startsWith('exited')) {
          return Response.json({ execId: id, state: 'exited', exitCode: 0 });
        }
        return Response.json({ execId: id, state: 'running', startedAtMs: 1 });
      }
      if (url.pathname === '/env' && req.method === 'POST') {
        return Response.json({ ok: true, denied: ['HOME'] });
      }
      if (url.pathname.endsWith('/stdin') && req.method === 'POST') {
        // Echo runnerd's structured response shape; "closed-" execs simulate
        // a write against an already-EOF'd / close-mode stdin.
        const execId = url.pathname.split('/')[2] ?? '';
        if (execId.startsWith('closed')) {
          return Response.json({ ok: false, reason: 'STDIN_CLOSED' });
        }
        // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
        const body = (await req.json()) as { b64?: string; eof?: boolean };
        stdinWrites.push({ execId, ...body });
        return Response.json({ ok: true });
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

// Sessions whose backend object has "disappeared" out-of-band (zombie tests):
// sessionExists answers false for these. `backendCheckThrows` simulates a
// backend that can't answer (daemon hiccup) — the routes must treat that as
// "unknown", never as "gone".
const backendGone = new Set<string>();
let backendCheckThrows = false;
// Sessions whose backend destroy fails (a wedged dockerd) — destroySession
// throws for these so the route's honesty path (no laundered success) is tested.
const backendDestroyThrows = new Set<string>();

const fakeBackend: SessionBackend = {
  kind: 'docker',
  async createSession(spec: SessionSpec) {
    created.add(spec.sessionId);
  },
  async resolveEndpoint(sessionId: string) {
    // `dead-`-prefixed sessions get an unreachable runnerd — the zombie tests
    // need the runnerd hop to fail at the transport level.
    return sessionId.startsWith('dead-') ? 'http://127.0.0.1:9' : fakeBaseUrl;
  },
  async destroySession(sessionId: string) {
    if (backendDestroyThrows.has(sessionId)) {
      throw new Error('backend destroy failed (wedged dockerd)');
    }
    const had = created.has(sessionId);
    destroyed.add(sessionId);
    return had;
  },
  async stopSession(sessionId: string) {
    // Stop releases compute but PRESERVES the workspace — never marks destroyed.
    const had = created.has(sessionId);
    stopped.add(sessionId);
    return had;
  },
  async listSessions(): Promise<BackendSession[]> {
    return [];
  },
  async sessionExists(sessionId: string) {
    if (backendCheckThrows) throw new Error('docker daemon hiccup');
    return !backendGone.has(sessionId);
  },
  async reconcileBuildCache() {},
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

// Reset all module-level fakes before each test so they're order-independent
// and can't leak state into one another (e.g. a session in `created` lingering
// into another test's assertions). fakeServer/fakeBaseUrl stay (beforeAll-owned).
beforeEach(() => {
  created.clear();
  destroyed.clear();
  stopped.clear();
  stdinWrites.length = 0;
  execRequests.length = 0;
  backendGone.clear();
  backendCheckThrows = false;
  backendDestroyThrows.clear();
  fakeHealth.lastActivityAtMs = 0;
  fakeHealth.liveExecs = 0;
  fakeHealth.activeScreencasts = 0;
});

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
    expect((await routes.handleGet('sess1')).status).toBe(200);

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
        cwd: '/agent/workspace',
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
    expect((await routes.handleGet('sess1')).status).toBe(404);
  });

  test('result forwards runnerd exit durationMs VERBATIM (the runner-measured wall-clock)', async () => {
    const routes = new SessionRoutes(cfg, fakeBackend);
    await routes.handleCreate(
      JSON.stringify({ sessionId: 'sess_dur', organizationId: 'org_d' }),
    );
    const execRes = routes.handleExec(
      new Request('http://x/v1/sessions/sess_dur/exec', { method: 'POST' }),
      'sess_dur',
      JSON.stringify({ execId: 'e1', command: ['echo', 'hi'] }),
    );
    const { events } = await readSse(execRes);
    const payload = events.find((e) => e.event === 'result')?.data ?? {};
    // The fake runnerd's exit line carries durationMs: 5 — the spawner must
    // forward it untouched, never re-measure around its own stream handling.
    expect(payload.durationMs).toBe(5);
  });

  test('a pre-spawn fail synthesizes durationMs 0 (never ran ⇒ not measured)', async () => {
    const routes = new SessionRoutes(cfg, fakeBackend);
    await routes.handleCreate(
      JSON.stringify({ sessionId: 'sess_fail', organizationId: 'org_f' }),
    );
    const execRes = routes.handleExec(
      new Request('http://x/v1/sessions/sess_fail/exec', { method: 'POST' }),
      'sess_fail',
      JSON.stringify({ execId: 'e1', command: ['echo', '__fail__'] }),
    );
    const { events } = await readSse(execRes);
    const payload = events.find((e) => e.event === 'result')?.data ?? {};
    expect(payload.status).toBe('failed');
    expect(payload.exitCode).toBeNull();
    expect(payload.errorCode).toBe('INVALID_CWD');
    // 0 is the "not measured" sentinel (wire.ts contract) — the process never
    // spawned, so no runner wall-clock exists to forward.
    expect(payload.durationMs).toBe(0);
  });

  test('a clean exit (0) that raced the deadline reports completed WITHOUT a TIMEOUT marker', async () => {
    const routes = new SessionRoutes(cfg, fakeBackend);
    await routes.handleCreate(
      JSON.stringify({ sessionId: 'sess_to', organizationId: 'org_to' }),
    );
    const execRes = routes.handleExec(
      new Request('http://x/v1/sessions/sess_to/exec', { method: 'POST' }),
      'sess_to',
      JSON.stringify({ execId: 'e1', command: ['echo', '__timeout_clean__'] }),
    );
    const { events } = await readSse(execRes);
    const payload = events.find((e) => e.event === 'result')?.data ?? {};
    // exitCode 0 → genuinely completed; the TIMEOUT errorCode must NOT be paired
    // with it (the contradictory `completed` + `TIMEOUT` result, finding H8).
    expect(payload.status).toBe('completed');
    expect(payload.exitCode).toBe(0);
    expect(payload.errorCode).toBeUndefined();
  });

  test('collectOutput:false ⇒ runnerd gets an unlimited cap (0) and the result carries no collected output', async () => {
    const routes = new SessionRoutes(cfg, fakeBackend);
    await routes.handleCreate(
      JSON.stringify({ sessionId: 'sess_stream', organizationId: 'org_s' }),
    );
    const execRes = routes.handleExec(
      new Request('http://x/v1/sessions/sess_stream/exec', { method: 'POST' }),
      'sess_stream',
      JSON.stringify({
        execId: 'e_stream',
        command: ['echo', 'hi'],
        collectOutput: false,
      }),
    );
    const { events } = await readSse(execRes);
    // Live stream still delivers the chunk...
    expect(events.find((e) => e.event === 'stdout')?.data.text).toBe('hi\n');
    // ...but the terminal result buffers are empty (no spawner accumulation).
    const payload = events.find((e) => e.event === 'result')?.data ?? {};
    expect(payload.status).toBe('completed');
    expect(payload.stdoutBase64).toBe('');
    expect(payload.stderrBase64).toBe('');
    // The spawner told runnerd the cap is unlimited so the live stream is never
    // truncated mid-run (the blackout fix).
    const sent = execRequests.find((r) => r.execId === 'e_stream');
    expect(sent?.stdoutMaxBytes).toBe(0);
    expect(sent?.stderrMaxBytes).toBe(0);
  });

  test('collectOutput default (one-shot) keeps the 5MB cap and collects output', async () => {
    const routes = new SessionRoutes(cfg, fakeBackend);
    await routes.handleCreate(
      JSON.stringify({ sessionId: 'sess_oneshot', organizationId: 'org_o' }),
    );
    const execRes = routes.handleExec(
      new Request('http://x/v1/sessions/sess_oneshot/exec', { method: 'POST' }),
      'sess_oneshot',
      JSON.stringify({ execId: 'e_oneshot', command: ['echo', 'hi'] }),
    );
    const { events } = await readSse(execRes);
    const payload = events.find((e) => e.event === 'result')?.data ?? {};
    expect(Buffer.from(String(payload.stdoutBase64), 'base64').toString()).toBe(
      'hi\n',
    );
    const sent = execRequests.find((r) => r.execId === 'e_oneshot');
    expect(sent?.stdoutMaxBytes).toBe(cfg.stdoutMaxBytes);
    expect(sent?.stderrMaxBytes).toBe(cfg.stderrMaxBytes);
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

  test('sweepExpired idle-reaps via STOP (preserve), NOT destroy, and skips a live exec', async () => {
    const routes = new SessionRoutes(cfg, fakeBackend);
    await routes.handleCreate(
      JSON.stringify({ sessionId: 'idle1', organizationId: 'org_sweep' }),
    );

    // runnerd reports a LIVE exec (cold-cache backstop) + stale activity → must
    // NOT be reaped (a quiet long tool mustn't be idle-killed mid-task).
    fakeHealth.liveExecs = 1;
    fakeHealth.lastActivityAtMs = 0; // epoch → far past the idle window
    expect(await routes.sweepExpired()).toBe(0);
    expect((await routes.handleGet('idle1')).status).toBe(200);

    // No live exec + stale activity → idle-reaped via STOP: compute released,
    // workspace PRESERVED (resumable). Never destroyed.
    fakeHealth.liveExecs = 0;
    expect(await routes.sweepExpired()).toBe(1);
    expect(stopped.has('idle1')).toBe(true);
    expect(destroyed.has('idle1')).toBe(false);
    expect((await routes.handleGet('idle1')).status).toBe(404);
    fakeHealth.lastActivityAtMs = 0;
  });

  test('sweepExpired TTL-reaps via STOP (preserve), NOT destroy', async () => {
    // A session past its hard lifetime is stopped, not destroyed — data is
    // removed only by an explicit Destroy (decision: persist until Destroy).
    const shortTtl = { ...cfg, session: { ...cfg.session, maxLifetimeMs: 1 } };
    const routes = new SessionRoutes(shortTtl, fakeBackend);
    await routes.handleCreate(
      JSON.stringify({ sessionId: 'ttl1', organizationId: 'org_ttl' }),
    );
    fakeHealth.liveExecs = 0;
    // Sweep with a clock well past expiresAtMs (createdAt + 1ms): the TTL branch
    // fires first (short-circuiting the idle check) regardless of sub-ms timing.
    expect(await routes.sweepExpired(Date.now() + 10_000)).toBe(1);
    expect(stopped.has('ttl1')).toBe(true);
    expect(destroyed.has('ttl1')).toBe(false);
    expect((await routes.handleGet('ttl1')).status).toBe(404);
  });

  test('sweepExpired skips a PINNED session (always-on)', async () => {
    const routes = new SessionRoutes(cfg, fakeBackend);
    await routes.handleCreate(
      JSON.stringify({ sessionId: 'pin1', organizationId: 'org_pin' }),
    );
    expect(
      routes.handleSetPinned('pin1', JSON.stringify({ pinned: true })).status,
    ).toBe(200);

    // Stale + no live exec → would normally idle-reap, but pinned exempts it.
    fakeHealth.liveExecs = 0;
    fakeHealth.lastActivityAtMs = 0;
    expect(await routes.sweepExpired()).toBe(0);
    expect((await routes.handleGet('pin1')).status).toBe(200);

    // Unpin → reaped on the next sweep.
    routes.handleSetPinned('pin1', JSON.stringify({ pinned: false }));
    expect(await routes.sweepExpired()).toBe(1);
    expect((await routes.handleGet('pin1')).status).toBe(404);
    fakeHealth.lastActivityAtMs = 0;
  });

  test('sweepExpired skips a session with a live browser viewer (activeScreencasts > 0)', async () => {
    const routes = new SessionRoutes(cfg, fakeBackend);
    await routes.handleCreate(
      JSON.stringify({ sessionId: 'watched1', organizationId: 'org_watch' }),
    );

    // No live exec + stale activity → would normally idle-reap, but a live raw
    // VNC tunnel (someone is actively watching) keeps it alive, mirroring the
    // liveExecs skip.
    fakeHealth.liveExecs = 0;
    fakeHealth.activeScreencasts = 1;
    fakeHealth.lastActivityAtMs = 0; // epoch → far past the idle window
    expect(await routes.sweepExpired()).toBe(0);
    expect((await routes.handleGet('watched1')).status).toBe(200);

    // Viewer disconnects → reaped on the next sweep.
    fakeHealth.activeScreencasts = 0;
    expect(await routes.sweepExpired()).toBe(1);
    expect(stopped.has('watched1')).toBe(true);
    expect(destroyed.has('watched1')).toBe(false);
    expect((await routes.handleGet('watched1')).status).toBe(404);
    fakeHealth.lastActivityAtMs = 0;
  });

  // Zombie sessions: the backend object disappeared OUT-OF-BAND (manual
  // docker rm, OOM teardown, K8s Pod eviction) while the registry cache still
  // routes to it. Without eviction the platform sees transport errors instead
  // of the definitive 404 its phantom self-heal keys on.
  // REGRESSION (destroy-under-execution guard): the end-of-turn janitor
  // destroy must never take down a session a sibling turn is still executing
  // in — `?if_idle=1` makes the spawner the arbiter of busy.
  describe('conditional destroy (ifIdle)', () => {
    test('busy (runnerd reports a live exec): spared with busy=true; idle: destroyed', async () => {
      const routes = new SessionRoutes(cfg, fakeBackend);
      await routes.handleCreate(
        JSON.stringify({ sessionId: 'cond1', organizationId: 'org_cond' }),
      );

      // Live exec reported by runnerd (registry map is empty — this exercises
      // the cold-cache backstop, same as sweepExpired's) → spared.
      fakeHealth.liveExecs = 1;
      const busyRes = await routes.handleDestroy('cond1', { ifIdle: true });
      expect(busyRes.status).toBe(200);
      expect(await busyRes.json()).toEqual({ destroyed: false, busy: true });
      expect(destroyed.has('cond1')).toBe(false);
      expect((await routes.handleGet('cond1')).status).toBe(200);

      // Exec finished → the same conditional destroy proceeds.
      fakeHealth.liveExecs = 0;
      const idleRes = await routes.handleDestroy('cond1', { ifIdle: true });
      expect(await idleRes.json()).toEqual({ destroyed: true, busy: false });
      expect(destroyed.has('cond1')).toBe(true);
      expect((await routes.handleGet('cond1')).status).toBe(404);
    });

    test('unconditional destroy ignores busy (explicit Stop/cascade keeps its semantics)', async () => {
      const routes = new SessionRoutes(cfg, fakeBackend);
      await routes.handleCreate(
        JSON.stringify({ sessionId: 'cond2', organizationId: 'org_cond' }),
      );
      fakeHealth.liveExecs = 1;
      const res = await routes.handleDestroy('cond2');
      expect(await res.json()).toEqual({ destroyed: true, busy: false });
      expect(destroyed.has('cond2')).toBe(true);
    });

    test('unreachable runnerd + backend object alive = unknown → busy (left to the reaper)', async () => {
      const routes = new SessionRoutes(cfg, fakeBackend);
      await routes.handleCreate(
        JSON.stringify({ sessionId: 'dead-cond3', organizationId: 'org_cond' }),
      );
      const res = await routes.handleDestroy('dead-cond3', { ifIdle: true });
      expect(await res.json()).toEqual({ destroyed: false, busy: true });
      expect(destroyed.has('dead-cond3')).toBe(false);
    });

    test('unreachable runnerd + backend object definitively gone → destroy proceeds (row/workspace cleanup)', async () => {
      const routes = new SessionRoutes(cfg, fakeBackend);
      await routes.handleCreate(
        JSON.stringify({ sessionId: 'dead-cond4', organizationId: 'org_cond' }),
      );
      backendGone.add('dead-cond4');
      const res = await routes.handleDestroy('dead-cond4', { ifIdle: true });
      expect(await res.json()).toEqual({ destroyed: true, busy: false });
      expect(destroyed.has('dead-cond4')).toBe(true);
    });

    test('backend destroy failure is surfaced, not laundered into success', async () => {
      const routes = new SessionRoutes(cfg, fakeBackend);
      await routes.handleCreate(
        JSON.stringify({ sessionId: 'wedge1', organizationId: 'org_wedge' }),
      );
      backendDestroyThrows.add('wedge1');

      const res = await routes.handleDestroy('wedge1');
      // No 200 destroyed:true — the platform must not flip its row while the
      // container/workspace may survive (the "success toast, workspace lives" bug).
      expect(res.status).toBe(502);
      expect(await res.json()).toMatchObject({ destroyed: false });
      // The registry entry is restored so the session isn't lost to the caller.
      expect((await routes.handleGet('wedge1')).status).toBe(200);

      // A retry once the daemon recovers succeeds cleanly.
      backendDestroyThrows.delete('wedge1');
      const retry = await routes.handleDestroy('wedge1');
      expect(retry.status).toBe(200);
      expect(await retry.json()).toEqual({ destroyed: true, busy: false });
    });
  });

  describe('zombie-session eviction', () => {
    test('aliveness probe (handleGet) 404s + evicts when the backend object is gone', async () => {
      const routes = new SessionRoutes(cfg, fakeBackend);
      await routes.handleCreate(
        JSON.stringify({ sessionId: 'dead-z1', organizationId: 'org_z' }),
      );
      expect((await routes.handleGet('dead-z1')).status).toBe(200);

      backendGone.add('dead-z1');
      const res = await routes.handleGet('dead-z1');
      expect(res.status).toBe(404);
      // The stale registry entry is evicted (404 for good), but the workspace
      // is PRESERVED — a gone container is a resumable stopped state, not a
      // teardown. Data is removed only by an explicit Destroy.
      expect(destroyed.has('dead-z1')).toBe(false);
      expect((await routes.handleGet('dead-z1')).status).toBe(404);
    });

    test('a throwing backend check is "unknown", never "gone" — session survives', async () => {
      const routes = new SessionRoutes(cfg, fakeBackend);
      await routes.handleCreate(
        JSON.stringify({ sessionId: 'blip1', organizationId: 'org_z' }),
      );
      backendCheckThrows = true;
      try {
        expect((await routes.handleGet('blip1')).status).toBe(200);
        expect(destroyed.has('blip1')).toBe(false);
      } finally {
        backendCheckThrows = false;
      }
    });

    test('env patch against a zombie → 404 + eviction; against a live-but-blipping runnerd → 502, kept', async () => {
      const routes = new SessionRoutes(cfg, fakeBackend);
      // Zombie: runnerd unreachable AND backend confirms gone.
      await routes.handleCreate(
        JSON.stringify({ sessionId: 'dead-z2', organizationId: 'org_z' }),
      );
      backendGone.add('dead-z2');
      const gone = await routes.handleEnvPatch(
        'dead-z2',
        JSON.stringify({ set: { A: 'b' } }),
      );
      expect(gone.status).toBe(404);
      // Evicted from the registry, workspace preserved (not destroyed).
      expect(destroyed.has('dead-z2')).toBe(false);

      // Transient: runnerd unreachable but the backend object is alive.
      await routes.handleCreate(
        JSON.stringify({ sessionId: 'dead-z3', organizationId: 'org_z' }),
      );
      const blip = await routes.handleEnvPatch(
        'dead-z3',
        JSON.stringify({ set: { A: 'b' } }),
      );
      expect(blip.status).toBe(502);
      expect(destroyed.has('dead-z3')).toBe(false);
      expect((await routes.handleGet('dead-z3')).status).toBe(200);
    });

    test('exec transport failure on a zombie evicts it so the reconnect 404s', async () => {
      const routes = new SessionRoutes(cfg, fakeBackend);
      await routes.handleCreate(
        JSON.stringify({ sessionId: 'dead-z4', organizationId: 'org_z' }),
      );
      backendGone.add('dead-z4');
      const execRes = routes.handleExec(
        new Request('http://x', { method: 'POST' }),
        'dead-z4',
        JSON.stringify({ execId: 'e1', command: ['echo', 'hi'] }),
      );
      const { events } = await readSse(execRes);
      expect(events.some((e) => e.event === 'error')).toBe(true);
      // The drain's re-attach now hits a registry miss — the phantom signal.
      expect(
        routes.handleExecAttach(
          new Request('http://x', { method: 'GET' }),
          'dead-z4',
          'e1',
        ).status,
      ).toBe(404);
    });

    test('sweepExpired evicts a zombie instead of skipping it until TTL', async () => {
      const routes = new SessionRoutes(cfg, fakeBackend);
      await routes.handleCreate(
        JSON.stringify({ sessionId: 'dead-z5', organizationId: 'org_z' }),
      );
      // runnerd unreachable + backend object alive → transient, kept.
      expect(await routes.sweepExpired()).toBe(0);
      expect((await routes.handleGet('dead-z5')).status).toBe(200);
      // Backend object gone → evicted this sweep (registry entry dropped). The
      // workspace is preserved (no destroy) — a gone backend is resumable.
      backendGone.add('dead-z5');
      expect(await routes.sweepExpired()).toBe(1);
      expect(destroyed.has('dead-z5')).toBe(false);
      expect((await routes.handleGet('dead-z5')).status).toBe(404);
    });
  });

  describe('exec stdin (held-open stream-json channel)', () => {
    test('forwards a write + eof to runnerd and returns its response', async () => {
      const routes = new SessionRoutes(cfg, fakeBackend);
      await routes.handleCreate(
        JSON.stringify({ sessionId: 'sess-stdin', organizationId: 'org_s' }),
      );
      const b64 = Buffer.from('{"type":"user"}\n').toString('base64');
      const res = await routes.handleExecStdin(
        'sess-stdin',
        'e-hold',
        JSON.stringify({ b64, eof: true }),
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
      expect(stdinWrites.at(-1)).toEqual({ execId: 'e-hold', b64, eof: true });
    });

    test('runnerd structured refusal passes through as 200 {ok:false}', async () => {
      const routes = new SessionRoutes(cfg, fakeBackend);
      await routes.handleCreate(
        JSON.stringify({ sessionId: 'sess-stdin2', organizationId: 'org_s' }),
      );
      const res = await routes.handleExecStdin(
        'sess-stdin2',
        'closed-e1',
        JSON.stringify({ eof: true }),
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: false, reason: 'STDIN_CLOSED' });
    });

    test('unknown session 404s; malformed body 400s', async () => {
      const routes = new SessionRoutes(cfg, fakeBackend);
      expect((await routes.handleExecStdin('nope', 'e1', '{}')).status).toBe(
        404,
      );
      await routes.handleCreate(
        JSON.stringify({ sessionId: 'sess-stdin3', organizationId: 'org_s' }),
      );
      expect(
        (await routes.handleExecStdin('sess-stdin3', 'e1', '{not json')).status,
      ).toBe(400);
    });

    test('zombie backend → 404 + eviction; transient runnerd blip → 502, kept', async () => {
      const routes = new SessionRoutes(cfg, fakeBackend);
      await routes.handleCreate(
        JSON.stringify({ sessionId: 'dead-s1', organizationId: 'org_s' }),
      );
      backendGone.add('dead-s1');
      const gone = await routes.handleExecStdin('dead-s1', 'e1', '{}');
      expect(gone.status).toBe(404);
      // Evicted from the registry, workspace preserved (not destroyed).
      expect(destroyed.has('dead-s1')).toBe(false);

      await routes.handleCreate(
        JSON.stringify({ sessionId: 'dead-s2', organizationId: 'org_s' }),
      );
      const blip = await routes.handleExecStdin('dead-s2', 'e1', '{}');
      expect(blip.status).toBe(502);
      expect(destroyed.has('dead-s2')).toBe(false);
    });
  });

  describe('exec cancel / status / boot adoption', () => {
    test('handleExecCancel: kills via runnerd → 200 {killed}; unknown session → 404', async () => {
      const routes = new SessionRoutes(cfg, fakeBackend);
      await routes.handleCreate(
        JSON.stringify({ sessionId: 'sess-cancel', organizationId: 'org_c' }),
      );
      const ok = await routes.handleExecCancel('sess-cancel', 'e1');
      expect(ok.status).toBe(200);
      expect(await ok.json()).toMatchObject({ killed: true });

      // Unknown session → 404, no runnerd hop.
      expect((await routes.handleExecCancel('nope', 'e1')).status).toBe(404);
      // (The transport-error → evict → 404 branch is exercised by the env/stdin/
      // sweep zombie tests; runnerdCancelExec swallows a non-OK response as
      // killed:false rather than throwing, so it can't drive eviction here.)
    });

    test('handleExecStatus: running/exited → 200, gone → 404, unknown → 404, transient blip → 502', async () => {
      const routes = new SessionRoutes(cfg, fakeBackend);
      await routes.handleCreate(
        JSON.stringify({ sessionId: 'sess-status', organizationId: 'org_st' }),
      );
      const run = await routes.handleExecStatus('sess-status', 'run1');
      expect(run.status).toBe(200);
      expect(await run.json()).toMatchObject({ state: 'running' });

      const done = await routes.handleExecStatus('sess-status', 'done1');
      expect(done.status).toBe(200);
      expect(await done.json()).toMatchObject({ state: 'exited', exitCode: 0 });

      // runnerd 404 → state 'gone' → the route answers 404.
      const goneExec = await routes.handleExecStatus('sess-status', 'gone1');
      expect(goneExec.status).toBe(404);
      expect(await goneExec.json()).toMatchObject({ state: 'gone' });

      // Unknown session → 404 {state:'gone'}, no runnerd hop.
      const unknown = await routes.handleExecStatus('nope', 'e1');
      expect(unknown.status).toBe(404);
      expect(await unknown.json()).toMatchObject({ state: 'gone' });

      // Transient runnerd blip on a LIVE backend → 502 so the platform's
      // restorative watchdog treats it as "unknown" and never finalizes a turn
      // on a daemon hiccup.
      await routes.handleCreate(
        JSON.stringify({ sessionId: 'dead-status', organizationId: 'org_st' }),
      );
      const blip = await routes.handleExecStatus('dead-status', 'e1');
      expect(blip.status).toBe(502);
      expect(destroyed.has('dead-status')).toBe(false);
    });

    test('adoptExisting: rebuilds the registry from backend objects, idempotently', async () => {
      const createdAtMs = 1_000;
      const adoptBackend: SessionBackend = {
        ...fakeBackend,
        async listSessions(): Promise<BackendSession[]> {
          return [
            {
              sessionId: 'adopt1',
              organizationId: 'org_adopt',
              profile: 'agent',
              createdAtMs,
              ttlMs: 60_000,
              idleTimeoutMs: 30_000,
              state: 'ready',
            },
          ];
        },
      };
      const routes = new SessionRoutes(cfg, adoptBackend);
      // Cold registry before adoption.
      expect((await routes.handleGet('adopt1')).status).toBe(404);

      await routes.adoptExisting();
      const got = await routes.handleGet('adopt1');
      expect(got.status).toBe(200);
      // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
      const info = (await got.json()) as {
        session: { createdAtMs: number; expiresAtMs: number; state: string };
      };
      // expiresAtMs is reconstructed from the backend object (createdAt + ttl).
      expect(info.session.createdAtMs).toBe(createdAtMs);
      expect(info.session.expiresAtMs).toBe(createdAtMs + 60_000);
      expect(info.session.state).toBe('ready');

      // Idempotent: a second adoption doesn't duplicate or disturb the entry.
      await routes.adoptExisting();
      expect((await routes.handleGet('adopt1')).status).toBe(200);
    });

    test('adoptExisting: reconciles the shared build cache for the running orgs', async () => {
      const reconciled: string[][] = [];
      const reconcileBackend: SessionBackend = {
        ...fakeBackend,
        async listSessions(): Promise<BackendSession[]> {
          return [
            mkBackendSession('s1', 'org_a'),
            mkBackendSession('s2', 'org_b'),
          ];
        },
        async reconcileBuildCache(orgIds: readonly string[]) {
          reconciled.push([...orgIds]);
        },
      };
      await new SessionRoutes(cfg, reconcileBackend).adoptExisting();
      // Called once, with every running session's org (drift healing is keyed
      // per org; the backend dedups to the single v1 daemon).
      expect(reconciled).toEqual([['org_a', 'org_b']]);
    });

    test('adoptExisting: no sessions ⇒ no build-cache reconcile', async () => {
      let calls = 0;
      const emptyBackend: SessionBackend = {
        ...fakeBackend,
        async listSessions(): Promise<BackendSession[]> {
          return [];
        },
        async reconcileBuildCache() {
          calls += 1;
        },
      };
      await new SessionRoutes(cfg, emptyBackend).adoptExisting();
      expect(calls).toBe(0);
    });
  });
});

function mkBackendSession(
  sessionId: string,
  organizationId: string,
): BackendSession {
  return {
    sessionId,
    organizationId,
    profile: 'agent',
    createdAtMs: 1_000,
    ttlMs: 60_000,
    idleTimeoutMs: 30_000,
    state: 'ready',
  };
}
