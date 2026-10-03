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
  setSystemTime,
  test,
} from 'bun:test';

import { ActivityGate } from '../../../sandbox-runtime/daemon/src/activity-gate.ts';
import type {
  BackendSession,
  SessionBackend,
  SessionSpec,
} from '../backend/types.ts';
import type { SpawnerConfig } from '../types.ts';
import { deriveRunnerdToken } from './session-naming.ts';
import { SessionRoutes, settlesWithin } from './session-routes.ts';
import { TEST_SESSION_CONFIG } from './session-test-config.ts';

const cfg: SpawnerConfig = {
  instance: '',
  hub: null,
  deviceConfigPath: null,
  backend: 'docker',
  port: 8003,
  // The per-session runnerd token is derived from this; the fake runnerd below
  // does not check the header, so any value works.
  sandboxToken: 'test-token',
  runtimeImage: 'tale-sandbox-runtime:test',
  runtimeTier: 'runc',
  dockerInContainer: false,
  dockerBuildCache: false,
  buildkitdImage: 'tale-sandbox-buildkitd:test',
  buildkitdMirrorImage: 'registry:2',
  transparentEgress: false,
  k8s: {
    namespace: 'tale-sandbox',
    runtimeClassName: null,
    workspaceSizeLimit: '4Gi',
  },
  maxTimeoutMs: 300_000,
  hostSessionRoot: '/tmp/tale-sandbox/sessions',
  cacheVolumePrefix: { pip: 'pip', npm: 'npm', bun: 'bun' },
  egressNetwork: 'tale-sandbox-net',
  egressProxy: 'http://sandbox-egress:3128',
  stdoutMaxBytes: 5_242_880,
  stderrMaxBytes: 5_242_880,
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
// Each POST /execs/:id/cancel runnerd received, path and query.
const cancelRequests: string[] = [];
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
// activity/liveExecs.
const fakeHealth = {
  lastActivityAtMs: 0,
  liveExecs: 0,
};
const fakeActivities = new Map<string, ActivityGate>();
let legacyDaemon = false;
// Daemons (by session token) that answer nothing usable any more — a
// container whose runnerd died — and how often each daemon's /healthz was
// probed, for the probe back-off assertions.
const deadDaemons = new Set<string>();
const healthProbes = new Map<string, number>();
// Per-daemon activity clocks (by session token), over fakeHealth's shared one.
const daemonLastActivity = new Map<string, number>();

function ndjson(lines: object[]): string {
  return lines.map((l) => JSON.stringify(l)).join('\n') + '\n';
}

beforeAll(() => {
  fakeServer = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const token = req.headers.get('x-tale-runnerd-token') ?? '';
      let activity = fakeActivities.get(token);
      if (activity === undefined) {
        activity = new ActivityGate(() => fakeHealth.liveExecs);
        fakeActivities.set(token, activity);
      }
      if (deadDaemons.has(token)) {
        return new Response('runnerd is gone', { status: 503 });
      }
      if (url.pathname === '/healthz') {
        healthProbes.set(token, (healthProbes.get(token) ?? 0) + 1);
        return Response.json({
          ok: true,
          bootedAtMs: 0,
          lastActivityAtMs:
            daemonLastActivity.get(token) ?? fakeHealth.lastActivityAtMs,
          liveExecs: fakeHealth.liveExecs,
          ...(legacyDaemon ? {} : { activity: activity.snapshot() }),
        });
      }
      if (!legacyDaemon && url.pathname === '/acquire') {
        const generation = activity.acquire();
        return Response.json(
          { generation },
          { status: generation === null ? 503 : 200 },
        );
      }
      if (
        !legacyDaemon &&
        url.pathname === '/release' &&
        req.method === 'GET'
      ) {
        return Response.json({ generation: activity.snapshot().generation });
      }
      if (
        !legacyDaemon &&
        ['/release', '/reclaim', '/pin'].includes(url.pathname)
      ) {
        const parsed: unknown = await req.json();
        const body =
          parsed !== null && typeof parsed === 'object'
            ? Object.fromEntries(Object.entries(parsed))
            : {};
        if (url.pathname === '/release')
          return Response.json({
            released: activity.release(String(body.generation)),
          });
        if (url.pathname === '/reclaim')
          return Response.json({
            claimed: activity.claim(
              String(body.claimId),
              String(body.generation),
            ),
          });
        const applied = activity.setPinned(body.pinned === true);
        return Response.json({ ok: applied }, { status: applied ? 200 : 503 });
      }
      if (activity.snapshot().reclaiming)
        return new Response('reclaiming', { status: 503 });
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
        cancelRequests.push(url.pathname + url.search);
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
        if (url.pathname.includes('/hang-')) {
          // A live exec whose output is quiet: the attach stays open.
          return new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(
                  new TextEncoder().encode(
                    ndjson([
                      {
                        t: 'stdout',
                        b64: Buffer.from('live').toString('base64'),
                      },
                    ]),
                  ),
                );
              },
            }),
            { headers: { 'content-type': 'application/x-ndjson' } },
          );
        }
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
// Sessions whose create is a RESUME (the workspace pre-existed backend-side).
const resumedSessions = new Set<string>();
// The backend's durable pin record (what a restart would re-adopt).
const backendPins = new Map<string, boolean>();

const fakeBackend: SessionBackend = {
  kind: 'docker',
  async createSession(spec: SessionSpec) {
    created.add(spec.sessionId);
    stopped.delete(spec.sessionId);
    return { resumed: resumedSessions.has(spec.sessionId) };
  },
  async resolveEndpoint(sessionId: string) {
    // `unaddressable-`-prefixed sessions exist backend-side but their endpoint
    // can't be read (the K8s Pod-IP blip) — the create-rollback tests.
    if (sessionId.startsWith('unaddressable-')) {
      throw new Error(`session ${sessionId} has no pod IP`);
    }
    // `dead-`-prefixed sessions get an unreachable runnerd — the zombie tests
    // need the runnerd hop to fail at the transport level.
    return sessionId.startsWith('dead-') ? 'http://127.0.0.1:9' : fakeBaseUrl;
  },
  // Every backend states how far a destroyed workspace's deletion came; this
  // one deletes at once.
  async workspaceDeletion() {
    return 'done' as const;
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
    return !backendGone.has(sessionId) && !stopped.has(sessionId);
  },
  async setPinned(sessionId: string, pinned: boolean) {
    backendPins.set(sessionId, pinned);
  },
  async reconcileBuildCache() {},
  async listWorkspaces() {
    return [];
  },
  async listOrganizationResources() {
    return [];
  },
  async teardownOrganization() {
    return { containers: 0, volumes: 0, networks: 0 };
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
  resumedSessions.clear();
  backendPins.clear();
  fakeHealth.lastActivityAtMs = 0;
  fakeHealth.liveExecs = 0;
  fakeActivities.clear();
  legacyDaemon = false;
  deadDaemons.clear();
  healthProbes.clear();
  daemonLastActivity.clear();
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
    const execRes = await routes.handleExec(
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
    const execRes = await routes.handleExec(
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
    const execRes = await routes.handleExec(
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
    const execRes = await routes.handleExec(
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
    const execRes = await routes.handleExec(
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
    const execRes = await routes.handleExec(
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

  test('one organization can use the deployment capacity without a second cap', async () => {
    const routes = new SessionRoutes(cfg, fakeBackend);
    await routes.handleCreate(
      JSON.stringify({ sessionId: 'a', organizationId: 'org_cap' }),
    );
    await routes.handleCreate(
      JSON.stringify({ sessionId: 'b', organizationId: 'org_cap' }),
    );
    const third = await routes.handleCreate(
      JSON.stringify({ sessionId: 'c', organizationId: 'org_cap' }),
    );
    expect(third.status).toBe(201);
  });

  // REGRESSION (quota vs creates in flight): the registry is populated only
  // AFTER backend.createSession resolves (up to createHealthTimeoutMs later
  // through a slow image pull), and the caps used to read the registry alone —
  // so a burst of distinct ids during one slow create all passed the host
  // caps and oversubscribed the host by the number of creates in flight.
  describe('quotas count creates in flight', () => {
    /** A backend whose createSession of `blockedId` blocks until the test
     * releases it (every other id creates at once). */
    const blockingBackend = (
      blockedId: string,
    ): SessionBackend & { release: () => void } => {
      let release = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      return {
        ...fakeBackend,
        release: () => release(),
        async createSession(spec: SessionSpec) {
          if (spec.sessionId === blockedId) await gate;
          return fakeBackend.createSession(spec);
        },
      };
    };

    test('one org can create concurrently while deployment capacity remains', async () => {
      const backend = blockingBackend('inflight-b');
      const routes = new SessionRoutes(cfg, backend);
      // Occupy one real slot, then one in-flight slot in the same organization.
      await routes.handleCreate(
        JSON.stringify({ sessionId: 'inflight-a', organizationId: 'org_if' }),
      );
      const pending = routes.handleCreate(
        JSON.stringify({ sessionId: 'inflight-b', organizationId: 'org_if' }),
      );
      expect(routes.sessionCount()).toBe(1); // b is NOT registered yet
      const third = await routes.handleCreate(
        JSON.stringify({ sessionId: 'inflight-c', organizationId: 'org_if' }),
      );
      expect(third.status).toBe(201);
      // Another org can also use the remaining deployment capacity.
      expect(
        (
          await routes.handleCreate(
            JSON.stringify({ sessionId: 'other-org', organizationId: 'org_x' }),
          )
        ).status,
      ).toBe(201);
      backend.release();
      expect((await pending).status).toBe(201);
      expect(routes.sessionCount()).toBe(4);
    });

    test('host cap: creates in flight occupy spawner capacity', async () => {
      const backend = blockingBackend('host-a');
      const routes = new SessionRoutes(
        { ...cfg, session: { ...cfg.session, maxSessions: 1 } },
        backend,
      );
      const pending = routes.handleCreate(
        JSON.stringify({ sessionId: 'host-a', organizationId: 'org_h1' }),
      );
      const second = await routes.handleCreate(
        JSON.stringify({ sessionId: 'host-b', organizationId: 'org_h2' }),
      );
      expect(second.status).toBe(429);
      expect(await second.json()).toMatchObject({
        message: 'spawner session cap reached',
      });
      backend.release();
      expect((await pending).status).toBe(201);
    });

    test('a retry of an id still being created is 409, not 429, at the host cap', async () => {
      const backend = blockingBackend('retry-a');
      const routes = new SessionRoutes(
        { ...cfg, session: { ...cfg.session, maxSessions: 1 } },
        backend,
      );
      const pending = routes.handleCreate(
        JSON.stringify({ sessionId: 'retry-a', organizationId: 'org_r' }),
      );
      // The host is full (by this very create); the duplicate is still judged
      // as a duplicate first.
      const retry = await routes.handleCreate(
        JSON.stringify({ sessionId: 'retry-a', organizationId: 'org_r' }),
      );
      expect(retry.status).toBe(409);
      expect(await retry.json()).toMatchObject({ error: 'duplicate' });
      backend.release();
      expect((await pending).status).toBe(201);
    });

    test('a destroy whose deletion state cannot be read answers pending, never done', async () => {
      const unreadable: SessionBackend = {
        ...fakeBackend,
        async workspaceDeletion() {
          throw new Error('EACCES: permission denied, scandir');
        },
      };
      const routes = new SessionRoutes(cfg, unreadable);
      const res = await routes.handleDestroy('unknown-trash', {
        awaitDeletion: true,
      });
      expect(await res.json()).toEqual({
        destroyed: false,
        busy: false,
        deletion: 'pending',
      });
    });

    test('a failed in-flight create releases its quota share', async () => {
      const failing: SessionBackend = {
        ...fakeBackend,
        async createSession() {
          throw new Error('pull failed');
        },
      };
      const routes = new SessionRoutes(
        { ...cfg, session: { ...cfg.session, maxSessions: 1 } },
        failing,
      );
      expect(
        (
          await routes.handleCreate(
            JSON.stringify({ sessionId: 'fail-a', organizationId: 'org_f' }),
          )
        ).status,
      ).toBe(502);
      // The slot is free again: the next create is judged on merit, not 429.
      const next = await new SessionRoutes(
        { ...cfg, session: { ...cfg.session, maxSessions: 1 } },
        fakeBackend,
      ).handleCreate(
        JSON.stringify({ sessionId: 'fail-b', organizationId: 'org_f' }),
      );
      expect(next.status).toBe(201);
      expect(routes.sessionCount()).toBe(0);
    });
  });

  test('exec against unknown session → 404', async () => {
    const routes = new SessionRoutes(cfg, fakeBackend);
    const res = await routes.handleExec(
      new Request('http://x', { method: 'POST' }),
      'nope',
      JSON.stringify({ execId: 'e1', command: ['echo'] }),
    );
    expect(res.status).toBe(404);
  });

  // The post-create rollback (backend object made, endpoint unreadable) must
  // never delete data it did not provision: a RESUME re-attached a preserved
  // workspace, so it rolls back with STOP; only a fresh create destroys.
  describe('create rollback when the endpoint cannot be resolved', () => {
    test('a FRESH create destroys the half-made session (nothing to preserve)', async () => {
      const routes = new SessionRoutes(cfg, fakeBackend);
      const res = await routes.handleCreate(
        JSON.stringify({
          sessionId: 'unaddressable-fresh',
          organizationId: 'org_rb',
        }),
      );
      expect(res.status).toBe(502);
      expect(await res.json()).toMatchObject({ error: 'create_failed' });
      expect(destroyed.has('unaddressable-fresh')).toBe(true);
      expect(stopped.has('unaddressable-fresh')).toBe(false);
      // Nothing registered: the sweep would never have walked it.
      expect((await routes.handleGet('unaddressable-fresh')).status).toBe(404);
    });

    test('a RESUME stops — the preserved workspace survives for the retry', async () => {
      resumedSessions.add('unaddressable-resume');
      const routes = new SessionRoutes(cfg, fakeBackend);
      const res = await routes.handleCreate(
        JSON.stringify({
          sessionId: 'unaddressable-resume',
          organizationId: 'org_rb',
        }),
      );
      expect(res.status).toBe(502);
      expect(await res.json()).toMatchObject({ error: 'create_failed' });
      // Compute released, data kept: the data-deleting verb was never reached.
      expect(stopped.has('unaddressable-resume')).toBe(true);
      expect(destroyed.has('unaddressable-resume')).toBe(false);
      expect((await routes.handleGet('unaddressable-resume')).status).toBe(404);
    });
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
    const attachRes = await routes.handleExecAttach(
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
      (
        await routes.handleExecAttach(
          new Request('http://x', { method: 'GET' }),
          'nope',
          'e1',
        )
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
    // removed only by a destroy (the explicit one, or the platform's
    // workspace cleanup), never by the reaper.
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

  test('sweepExpired runs build-cache cleanup even with no registered sessions', async () => {
    const calls: Array<readonly string[]> = [];
    const routes = new SessionRoutes(cfg, {
      ...fakeBackend,
      async reconcileBuildCache(orgIds) {
        calls.push(orgIds);
      },
    });

    expect(await routes.sweepExpired()).toBe(0);
    await routes.buildCacheSettled();
    expect(calls).toEqual([[]]);
  });

  test.each([false, true])(
    'build-cache maintenance follows idle stopping and does not fail the sweep (maintenance fails=%s)',
    async (fails) => {
      let maintained = false;
      const routes = new SessionRoutes(cfg, {
        ...fakeBackend,
        async reconcileBuildCache(orgIds) {
          expect(orgIds).toEqual([]);
          expect(stopped.has('idle-maintenance')).toBe(true);
          maintained = true;
          if (fails) throw new Error('builder maintenance unavailable');
        },
      });
      await routes.handleCreate(
        JSON.stringify({
          sessionId: 'idle-maintenance',
          organizationId: 'org_maintenance',
        }),
      );
      fakeHealth.liveExecs = 0;
      fakeHealth.lastActivityAtMs = 0;

      expect(await routes.sweepExpired()).toBe(1);
      await routes.buildCacheSettled();
      expect(maintained).toBe(true);
    },
  );

  test('sweepExpired skips a PINNED session (always-on)', async () => {
    const routes = new SessionRoutes(cfg, fakeBackend);
    await routes.handleCreate(
      JSON.stringify({ sessionId: 'pin1', organizationId: 'org_pin' }),
    );
    expect(
      (await routes.handleSetPinned('pin1', JSON.stringify({ pinned: true })))
        .status,
    ).toBe(200);
    // The pin is recorded on the backend's durable state, not only in memory.
    expect(backendPins.get('pin1')).toBe(true);

    // Stale + no live exec → would normally idle-reap, but pinned exempts it.
    fakeHealth.liveExecs = 0;
    fakeHealth.lastActivityAtMs = 0;
    expect(await routes.sweepExpired()).toBe(0);
    expect((await routes.handleGet('pin1')).status).toBe(200);

    // Unpin → recorded, and reaped on the next sweep.
    await routes.handleSetPinned('pin1', JSON.stringify({ pinned: false }));
    expect(backendPins.get('pin1')).toBe(false);
    expect(await routes.sweepExpired()).toBe(1);
    expect((await routes.handleGet('pin1')).status).toBe(404);
    fakeHealth.lastActivityAtMs = 0;
  });

  test('a pin survives a spawner restart: adoptExisting carries `pinned` and the sweep spares it', async () => {
    // Two sessions re-adopted from the backend after a restart, both created
    // long before maxLifetime (TTL long past) with stale activity. Before the
    // fix the rebuilt entries carried no `pinned`, so the always-on one was
    // TTL-stopped on the very first sweep like its unpinned sibling.
    const ancient = Date.now() - 2 * cfg.session.maxLifetimeMs;
    const restartBackend: SessionBackend = {
      ...fakeBackend,
      async listSessions(): Promise<BackendSession[]> {
        // Mirrors a real backend: a stopped object is listed as not running,
        // so a registry-miss re-resolve after the sweep stays a genuine 404.
        const stateOf = (id: string) =>
          stopped.has(id) ? ('degraded' as const) : ('ready' as const);
        return [
          {
            ...mkBackendSession('adopt-pinned', 'org_restart'),
            createdAtMs: ancient,
            pinned: true,
            state: stateOf('adopt-pinned'),
          },
          {
            ...mkBackendSession('adopt-plain', 'org_restart'),
            createdAtMs: ancient,
            state: stateOf('adopt-plain'),
          },
        ];
      },
    };
    const routes = new SessionRoutes(cfg, restartBackend);
    await routes.adoptExisting();
    fakeHealth.liveExecs = 0;
    fakeHealth.lastActivityAtMs = 0;

    // The wire view reports what was adopted.
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
    const info = (await (await routes.handleGet('adopt-pinned')).json()) as {
      session: { pinned: boolean };
    };
    expect(info.session.pinned).toBe(true);

    expect(await routes.sweepExpired()).toBe(1);
    expect(stopped.has('adopt-plain')).toBe(true);
    expect(stopped.has('adopt-pinned')).toBe(false);
    expect((await routes.handleGet('adopt-pinned')).status).toBe(200);
    expect((await routes.handleGet('adopt-plain')).status).toBe(404);
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
      expect(await idleRes.json()).toEqual({
        destroyed: true,
        busy: false,
        deletion: 'done',
      });
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
      expect(await res.json()).toEqual({
        destroyed: true,
        busy: false,
        deletion: 'done',
      });
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
      expect(await res.json()).toEqual({
        destroyed: true,
        busy: false,
        deletion: 'done',
      });
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
      expect(await retry.json()).toEqual({
        destroyed: true,
        busy: false,
        deletion: 'done',
      });
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
      // teardown. Data is removed only by a destroy.
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
      const execRes = await routes.handleExec(
        new Request('http://x', { method: 'POST' }),
        'dead-z4',
        JSON.stringify({ execId: 'e1', command: ['echo', 'hi'] }),
      );
      const { events } = await readSse(execRes);
      expect(events.some((e) => e.event === 'error')).toBe(true);
      // The drain's re-attach now hits a registry miss — the phantom signal.
      expect(
        (
          await routes.handleExecAttach(
            new Request('http://x', { method: 'GET' }),
            'dead-z4',
            'e1',
          )
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

    test('handleExecCancel: a rotation’s cancel reaches runnerd as leftovers=keep, a Stop without it', async () => {
      const routes = new SessionRoutes(cfg, fakeBackend);
      await routes.handleCreate(
        JSON.stringify({ sessionId: 'sess-rotate', organizationId: 'org_c' }),
      );
      cancelRequests.length = 0;
      const rotated = await routes.handleExecCancel('sess-rotate', 'turn-1', {
        keepLeftovers: true,
      });
      expect(await rotated.json()).toMatchObject({ killed: true });
      await routes.handleExecCancel('sess-rotate', 'turn-2');
      await routes.handleExecCancel('sess-rotate', 'turn-3', {
        keepLeftovers: false,
      });
      expect(cancelRequests).toEqual([
        '/execs/turn-1/cancel?leftovers=keep',
        '/execs/turn-2/cancel',
        '/execs/turn-3/cancel',
      ]);
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
      // Cold registry before adoption (a GET would re-resolve it — see the
      // registry-miss tests below — so the cache itself is what's asserted).
      expect(routes.sessionCount()).toBe(0);

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
      const routes = new SessionRoutes(cfg, reconcileBackend);
      await routes.adoptExisting();
      await routes.buildCacheSettled();
      // Called once, with every running agent session's org (drift healing
      // is keyed per org).
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

    // REGRESSION (registry-miss re-resolve): the registry is a per-replica
    // cache. A session created by a peer replica — or missed at boot — exists
    // backend-side but not here; answering 404 from the cache alone is the
    // platform's phantom-session signal, which recreates a session that is
    // alive elsewhere. Every handler must fall back to the backend on a miss.
    describe('registry miss → backend re-resolve', () => {
      const peerBackend = (
        ...listed: BackendSession[]
      ): SessionBackend & { lists: number } => {
        const b = {
          ...fakeBackend,
          lists: 0,
          async listSessions(): Promise<BackendSession[]> {
            b.lists += 1;
            return listed;
          },
        };
        return b;
      };

      test('GET / exec / exec-status / env / files on a session the registry never saw succeed', async () => {
        const backend = peerBackend(mkBackendSession('peer1', 'org_peer'));
        const routes = new SessionRoutes(cfg, backend);

        // Aliveness probe: 200, not the phantom 404.
        const got = await routes.handleGet('peer1');
        expect(got.status).toBe(200);
        // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
        const info = (await got.json()) as { session: { state: string } };
        expect(info.session.state).toBe('ready');

        // Exec routes to the adopted endpoint.
        const execRes = await routes.handleExec(
          new Request('http://x/v1/sessions/peer1/exec', { method: 'POST' }),
          'peer1',
          JSON.stringify({ execId: 'e1', command: ['echo', 'hi'] }),
        );
        const { events } = await readSse(execRes);
        expect(events.find((e) => e.event === 'result')?.data.status).toBe(
          'completed',
        );
        // The watchdog's exec-status probe: 200 running, not 404 'gone'.
        const status = await routes.handleExecStatus('peer1', 'run1');
        expect(status.status).toBe(200);
        expect((await routes.handleEnvPatch('peer1', '{}')).status).toBe(200);
        expect((await routes.handleFilesList('peer1', '.')).status).toBe(200);
        // Adopted once; later hits are served from the cache.
        expect(backend.lists).toBe(1);
      });

      test('a stopped (non-running) backend object stays a genuine 404 — resumable, not routable', async () => {
        const routes = new SessionRoutes(
          cfg,
          peerBackend({
            ...mkBackendSession('stopped1', 'org_peer'),
            state: 'degraded',
          }),
        );
        expect((await routes.handleGet('stopped1')).status).toBe(404);
        expect((await routes.handleExecStatus('stopped1', 'e1')).status).toBe(
          404,
        );
      });

      test('a failed backend list answers not-found without registering anything', async () => {
        const failing: SessionBackend = {
          ...fakeBackend,
          async listSessions(): Promise<BackendSession[]> {
            throw new Error('docker ps failed');
          },
        };
        const routes = new SessionRoutes(cfg, failing);
        expect((await routes.handleGet('nope')).status).toBe(404);
        expect(routes.sessionCount()).toBe(0);
      });

      test('an unresolvable endpoint is logged and left for a later retry, not registered', async () => {
        const routes = new SessionRoutes(
          cfg,
          peerBackend(mkBackendSession('unaddressable-peer', 'org_peer')),
        );
        expect((await routes.handleGet('unaddressable-peer')).status).toBe(404);
        expect(routes.sessionCount()).toBe(0);
      });

      // REGRESSION: the route-path adopt used to ignore the drain — while the
      // sweep tick (server.ts) skips adoptExisting for exactly this reason. A
      // draining spawner that adopted a replacement-created session inflated
      // its drain-status (the deploy kept lingering) and at max-linger stopped
      // a live session another replica owns.
      test('a registry miss while draining is a 404 without adopting — or even listing', async () => {
        const backend = peerBackend(mkBackendSession('repl1', 'org_peer'));
        let draining = true;
        const routes = new SessionRoutes(cfg, backend, () => draining);
        expect((await routes.handleGet('repl1')).status).toBe(404);
        expect((await routes.handleExecStatus('repl1', 'e1')).status).toBe(404);
        expect(routes.sessionCount()).toBe(0);
        expect(routes.sessionIds()).toEqual([]);
        expect(backend.lists).toBe(0);
        // The same instance, no longer draining: the miss re-resolves as usual.
        draining = false;
        expect((await routes.handleGet('repl1')).status).toBe(200);
        expect(routes.sessionCount()).toBe(1);
        expect(backend.lists).toBe(1);
      });

      test('concurrent misses share one list, later arrivals one follow-up', async () => {
        let release = () => {};
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        const listed = [
          mkBackendSession('shared1', 'org_peer'),
          mkBackendSession('shared2', 'org_peer'),
        ];
        const backend = {
          ...fakeBackend,
          lists: 0,
          async listSessions(): Promise<BackendSession[]> {
            backend.lists += 1;
            await gate;
            return listed;
          },
        };
        const routes = new SessionRoutes(cfg, backend);
        // Two ids, three probes: the first starts a list, the two that arrive
        // while it is in flight share ONE follow-up (a snapshot taken after
        // their misses) — two lists, not three, and not one stale one.
        const pending = Promise.all([
          routes.handleGet('shared1'),
          routes.handleExecStatus('shared1', 'e1'),
          routes.handleGet('shared2'),
        ]);
        expect(backend.lists).toBe(1);
        release();
        const [a, b, c] = await pending;
        expect([a.status, b.status, c.status]).toEqual([200, 200, 200]);
        expect(routes.sessionCount()).toBe(2);
        expect(backend.lists).toBe(2);
        // The shared list is not a cache: a later miss lists again.
        expect((await routes.handleGet('shared3')).status).toBe(404);
        expect(backend.lists).toBe(3);
      });

      // REGRESSION (multi-replica): replica B is listing for an unrelated miss
      // when a peer creates S and the platform's next exec-status for S lands
      // on B. Joining the list ALREADY IN FLIGHT hands B a snapshot taken
      // before S existed → 404 → the platform maps it to 'gone' and finalizes
      // the turn as a phantom, although S is alive. Only a list started after
      // the caller's miss may answer it.
      test('a miss during an in-flight list sees a session created after that list began', async () => {
        let release = () => {};
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        const listed: BackendSession[] = [mkBackendSession('old1', 'org_peer')];
        const backend = {
          ...fakeBackend,
          lists: 0,
          async listSessions(): Promise<BackendSession[]> {
            backend.lists += 1;
            // `docker ps` / pod list semantics: the snapshot is taken when the
            // list STARTS, not when it returns.
            const snapshot = [...listed];
            await gate;
            return snapshot;
          },
        };
        const routes = new SessionRoutes(cfg, backend);
        const unrelated = routes.handleGet('nope');
        expect(backend.lists).toBe(1);
        // The peer's create completes while that list is in flight …
        listed.push(mkBackendSession('fresh1', 'org_peer'));
        // … and the platform's very next probe for it lands here.
        const fresh = routes.handleGet('fresh1');
        release();
        expect((await unrelated).status).toBe(404);
        expect((await fresh).status).toBe(200);
        expect(backend.lists).toBe(2);
        expect(routes.sessionIds()).toEqual(['fresh1']);
      });
    });

    // REGRESSION (periodic adoption): a session the boot-time list missed used
    // to stay unregistered — unroutable and never TTL/idle-reaped — for the life
    // of the process. adoptExisting now runs on every sweep tick and picks up
    // whatever the backend lists that this replica does not yet know.
    test('adoptExisting: a session first listed on a later call is adopted then, and is reapable', async () => {
      const ancient = Date.now() - 2 * cfg.session.maxLifetimeMs;
      let listed: BackendSession[] = [];
      const reconciled: string[][] = [];
      const lateBackend: SessionBackend = {
        ...fakeBackend,
        async listSessions(): Promise<BackendSession[]> {
          return listed;
        },
        async reconcileBuildCache(orgIds: readonly string[]) {
          reconciled.push([...orgIds]);
        },
      };
      const routes = new SessionRoutes(cfg, lateBackend);
      await routes.adoptExisting(); // boot: the blip listed nothing
      expect(routes.sessionCount()).toBe(0);
      expect(reconciled).toEqual([]);

      listed = [
        { ...mkBackendSession('late1', 'org_late'), createdAtMs: ancient },
      ];
      await routes.adoptExisting(); // next sweep tick
      expect((await routes.handleGet('late1')).status).toBe(200);
      // The build-cache heal runs for the NEWLY adopted org only, once.
      expect(reconciled).toEqual([['org_late']]);
      await routes.adoptExisting();
      expect(reconciled).toEqual([['org_late']]);

      // Now under the reaper: TTL long past ⇒ stopped (workspace preserved).
      fakeHealth.liveExecs = 0;
      expect(await routes.sweepExpired()).toBe(1);
      expect(stopped.has('late1')).toBe(true);
      expect(destroyed.has('late1')).toBe(false);
    });

    test('adoptExisting: never adopts a non-running (stopped/exited) object', async () => {
      const routes = new SessionRoutes(cfg, {
        ...fakeBackend,
        async listSessions(): Promise<BackendSession[]> {
          return [
            { ...mkBackendSession('exited1', 'org_x'), state: 'degraded' },
          ];
        },
      });
      await routes.adoptExisting();
      expect(routes.sessionCount()).toBe(0);
    });
  });
});

describe('capacity pressure reclamation', () => {
  const capped = { ...cfg, session: { ...cfg.session, maxSessions: 1 } };
  const create = (routes: SessionRoutes, id: string) =>
    routes.handleCreate(
      JSON.stringify({ sessionId: id, organizationId: 'org_pressure' }),
    );
  const release = async (routes: SessionRoutes, id: string) => {
    const ticket: unknown = await (
      await routes.handleActivity(id, 'ticket')
    ).json();
    return routes.handleActivity(id, 'release', JSON.stringify(ticket));
  };

  test('reclaims released compute and preserves its workspace before admitting a replacement', async () => {
    const routes = new SessionRoutes(capped, fakeBackend);
    expect((await create(routes, 'warm')).status).toBe(201);
    expect(await (await release(routes, 'warm')).json()).toEqual({
      released: true,
    });
    expect((await create(routes, 'next')).status).toBe(201);
    expect(stopped.has('warm')).toBe(true);
    expect(destroyed.size).toBe(0);
    expect(routes.sessionCount()).toBe(1);
    expect((await routes.handleActivity('warm', 'acquire')).status).toBe(404);
    // The new container is not idle merely because its first exec has not started.
    expect((await create(routes, 'too-soon')).status).toBe(429);
  });

  test.each(['busy', 'pinned', 'unknown', 'legacy'] as const)(
    'never reclaims a %s runtime',
    async (kind) => {
      const routes = new SessionRoutes(capped, fakeBackend);
      const id = kind === 'unknown' ? 'dead-pressure' : 'protected';
      await create(routes, id);
      if (kind !== 'unknown') await release(routes, id);
      if (kind === 'busy') fakeHealth.liveExecs = 1;
      if (kind === 'pinned')
        await routes.handleSetPinned(id, JSON.stringify({ pinned: true }));
      if (kind === 'legacy') legacyDaemon = true;
      expect((await create(routes, 'refused')).status).toBe(429);
      expect(stopped.size).toBe(0);
      expect(destroyed.size).toBe(0);
    },
  );

  test('a ticket from before reacquire cannot release the newer allocation', async () => {
    const routes = new SessionRoutes(capped, fakeBackend);
    await create(routes, 'again');
    const ticket: unknown = await (
      await routes.handleActivity('again', 'ticket')
    ).json();
    expect((await routes.handleActivity('again', 'acquire')).status).toBe(200);
    expect(
      await (
        await routes.handleActivity('again', 'release', JSON.stringify(ticket))
      ).json(),
    ).toEqual({ released: false });
    expect((await create(routes, 'refused')).status).toBe(429);
    expect(stopped.size).toBe(0);
  });

  test('concurrent creates share one reclaim and reserve the freed slot once', async () => {
    const routes = new SessionRoutes(capped, fakeBackend);
    await create(routes, 'warm-race');
    await release(routes, 'warm-race');
    const responses = await Promise.all([
      create(routes, 'race-a'),
      create(routes, 'race-b'),
      create(routes, 'race-c'),
    ]);
    expect(
      responses.map((response) => response.status).sort((a, b) => a - b),
    ).toEqual([201, 429, 429]);
    expect(stopped.size).toBe(1);
    expect(routes.sessionCount()).toBe(1);
  });

  test('acquire waits for a pressure stop and returns not found after it completes', async () => {
    const started = Promise.withResolvers<void>();
    const finish = Promise.withResolvers<void>();
    const routes = new SessionRoutes(capped, {
      ...fakeBackend,
      async stopSession(id, expectedCreatedAtMs) {
        expect(expectedCreatedAtMs).toBeGreaterThan(0);
        started.resolve();
        await finish.promise;
        return fakeBackend.stopSession(id);
      },
    });
    await create(routes, 'warm-wait');
    await release(routes, 'warm-wait');
    const next = create(routes, 'wait-next');
    await started.promise;
    let acquired = false;
    const acquire = routes
      .handleActivity('warm-wait', 'acquire')
      .then((response) => {
        acquired = true;
        return response;
      });
    await Promise.resolve();
    expect(acquired).toBe(false);
    finish.resolve();
    expect((await next).status).toBe(201);
    expect((await acquire).status).toBe(404);
  });

  test('an ambiguous stop failure keeps capacity occupied and work frozen until retry succeeds', async () => {
    let failStop = true;
    const routes = new SessionRoutes(capped, {
      ...fakeBackend,
      async stopSession(id) {
        if (failStop) throw new Error('backend timeout');
        return fakeBackend.stopSession(id);
      },
    });
    await create(routes, 'warm-failure');
    await release(routes, 'warm-failure');
    expect((await create(routes, 'after-failure')).status).toBe(429);
    expect(routes.sessionCount()).toBe(1);
    expect(
      (await routes.handleActivity('warm-failure', 'acquire')).status,
    ).toBe(503);
    expect(
      (await routes.handleSetPinned('warm-failure', '{"pinned":true}')).status,
    ).toBe(503);
    failStop = false;
    expect(await routes.sweepExpired()).toBe(1);
    // The refused create, first in line, gets the room on its retry.
    expect((await create(routes, 'after-failure')).status).toBe(201);
    expect(destroyed.size).toBe(0);
  });

  test('older runtime images remain usable without inventing release eligibility', async () => {
    legacyDaemon = true;
    const routes = new SessionRoutes(capped, fakeBackend);
    await create(routes, 'old-image');
    expect(
      await (await routes.handleActivity('old-image', 'acquire')).json(),
    ).toEqual({ generation: 'legacy' });
    expect((await routes.handleActivity('old-image', 'ticket')).status).toBe(
      404,
    );
    expect((await create(routes, 'full')).status).toBe(429);
    // Failed unsupported claims must not disable the existing idle reaper.
    expect(await routes.sweepExpired()).toBe(1);
  });

  test('an acquire for an id still being created waits for that create instead of answering not-found', async () => {
    // A sibling turn of the same owner arrives while the first turn's
    // container is still coming up: the platform must not be told the
    // session is gone (it would answer with a duplicate create and fail).
    const imagePulled = Promise.withResolvers<void>();
    const routes = new SessionRoutes(cfg, {
      ...fakeBackend,
      async createSession(spec) {
        if (spec.sessionId === 'slow-create') await imagePulled.promise;
        return fakeBackend.createSession(spec);
      },
    });
    const pending = routes.handleCreate(
      JSON.stringify({ sessionId: 'slow-create', organizationId: 'org_a' }),
    );
    await Promise.resolve();
    let acquired: Response | undefined;
    const acquire = routes
      .handleActivity('slow-create', 'acquire')
      .then((response) => {
        acquired = response;
        return response;
      });
    await Promise.resolve();
    expect(acquired).toBeUndefined();
    imagePulled.resolve();
    expect((await pending).status).toBe(201);
    expect((await acquire).status).toBe(200);
  });

  test('a failed sweep stop never turns a concurrent acquire or create into a 500', async () => {
    let failStop = true;
    const routes = new SessionRoutes(capped, {
      ...fakeBackend,
      async stopSession(id, expectedCreatedAtMs) {
        if (failStop && expectedCreatedAtMs === undefined) {
          throw new Error('apiserver blip');
        }
        return fakeBackend.stopSession(id);
      },
    });
    await create(routes, 'ttl-stop');
    // Idle past its window, so the sweep's ordinary (unfenced) stop runs and
    // fails; an acquire and a create at capacity race it.
    const sweep = routes.sweepExpired(Date.now() + 3_600_000);
    const [acquire, refused] = await Promise.all([
      routes.handleActivity('ttl-stop', 'acquire'),
      create(routes, 'while-stopping'),
    ]);
    expect(await sweep).toBe(0);
    expect(acquire.status).toBe(200);
    expect(refused.status).toBe(429);
    failStop = false;
    expect(await routes.sweepExpired(Date.now() + 3_600_000)).toBe(1);
  });

  test('an acquire finishes a frozen stop whose backend removal failed, so the caller can recreate at once', async () => {
    let failStop = true;
    const routes = new SessionRoutes(capped, {
      ...fakeBackend,
      async stopSession(id) {
        if (failStop) throw new Error('docker rm timed out');
        return fakeBackend.stopSession(id);
      },
    });
    await create(routes, 'frozen');
    await release(routes, 'frozen');
    expect((await create(routes, 'pressure')).status).toBe(429);
    failStop = false;
    // Not a 503 until the next sweep: the stop is retried on the spot.
    expect((await routes.handleActivity('frozen', 'acquire')).status).toBe(404);
    expect(stopped.has('frozen')).toBe(true);
    expect(routes.sessionCount()).toBe(0);
    expect((await create(routes, 'pressure')).status).toBe(201);
  });

  test('a claimed container whose daemon died is still removed by its immutable id', async () => {
    let failStop = true;
    const routes = new SessionRoutes(capped, {
      ...fakeBackend,
      async stopSession(id, expectedCreatedAtMs) {
        if (failStop) throw new Error('docker rm timed out');
        expect(expectedCreatedAtMs).toBeGreaterThan(0);
        return fakeBackend.stopSession(id);
      },
    });
    await create(routes, 'dying');
    await release(routes, 'dying');
    expect((await create(routes, 'pressure')).status).toBe(429);
    // The daemon is gone (OOM-killed container): no probe can succeed, but
    // the acknowledged claim proves nothing can run in that incarnation.
    deadDaemons.add(deriveRunnerdToken(cfg.sandboxToken, 'dying'));
    failStop = false;
    expect(await routes.sweepExpired()).toBe(1);
    expect(stopped.has('dying')).toBe(true);
    expect(destroyed.size).toBe(0);
    expect((await create(routes, 'pressure')).status).toBe(201);
  });

  test('a daemon that does not answer the reclaim probe is not re-probed by every create at capacity', async () => {
    const routes = new SessionRoutes(capped, fakeBackend);
    await create(routes, 'wedged');
    const token = deriveRunnerdToken(cfg.sandboxToken, 'wedged');
    deadDaemons.add(token);
    expect((await create(routes, 'first')).status).toBe(429);
    expect((await create(routes, 'second')).status).toBe(429);
    // One failed probe per back-off window: the second create at capacity
    // did not pay for another (the dead daemon answers 503 to /healthz —
    // its probe count stays at zero while a live one would climb).
    expect(healthProbes.get(token) ?? 0).toBe(0);
    deadDaemons.delete(token);
    // Back-off elapsed: the candidate is probed again and reclaimed once it
    // is released.
    await release(routes, 'wedged');
    expect((await create(routes, 'third')).status).toBe(429);
    expect(healthProbes.get(token) ?? 0).toBe(0);
  });

  describe('creates refused at capacity do not probe every busy session', () => {
    const fleet = Array.from({ length: 12 }, (_, i) => `held-${i}`);
    const full = { ...cfg, session: { ...cfg.session, maxSessions: 12 } };
    const probes = () =>
      [...healthProbes.values()].reduce((sum, count) => sum + count, 0);
    const probed = (id: string) =>
      healthProbes.get(deriveRunnerdToken(cfg.sandboxToken, id)) ?? 0;
    const fill = async (routes: SessionRoutes) => {
      for (const id of fleet) {
        expect((await create(routes, id)).status).toBe(201);
      }
    };

    test('a walk probes a bounded few, released sessions first, and the refusals after it wait', async () => {
      const routes = new SessionRoutes(full, fakeBackend);
      await fill(routes);
      // Every session is held by a turn; none can be reclaimed.
      expect((await create(routes, 'refused-1')).status).toBe(429);
      expect(probes()).toBe(8);
      expect(fleet.slice(0, 8).every((id) => probed(id) === 1)).toBe(true);
      // Refused at once: the walk a moment ago found nothing.
      expect((await create(routes, 'refused-2')).status).toBe(429);
      expect(probes()).toBe(8);
      // A release ends the wait and puts its session first, ahead of the
      // busy ones the walk has not asked yet, however many there are.
      await release(routes, 'held-11');
      // The room goes to the front of the line, on its retry.
      expect((await create(routes, 'refused-1')).status).toBe(201);
      expect(stopped.has('held-11')).toBe(true);
      expect(probes()).toBe(9);
      expect(probed('held-11')).toBe(1);
      expect(fleet.slice(0, 8).every((id) => probed(id) === 1)).toBe(true);
      // A session a turn acquired again is no candidate, without a probe.
      await release(routes, 'held-10');
      expect((await routes.handleActivity('held-10', 'acquire')).status).toBe(
        200,
      );
      expect((await create(routes, 'refused-3')).status).toBe(429);
      expect(probed('held-10')).toBe(0);
    });

    test('what the sweep saw spares the walk its probes, for a while', async () => {
      const routes = new SessionRoutes(full, fakeBackend);
      await fill(routes);
      fakeHealth.lastActivityAtMs = Date.now();
      expect(await routes.sweepExpired()).toBe(0);
      expect(probes()).toBe(12);
      expect((await create(routes, 'refused-1')).status).toBe(429);
      expect(probes()).toBe(12);
      // Once the answers are old, a walk asks again.
      setSystemTime(new Date(Date.now() + 20_000));
      try {
        expect((await create(routes, 'refused-2')).status).toBe(429);
        expect(probes()).toBe(20);
      } finally {
        setSystemTime();
      }
    });
  });

  test('a replacement spawner safely finishes a frozen stop from before restart', async () => {
    const original = new SessionRoutes(capped, {
      ...fakeBackend,
      async stopSession() {
        throw new Error('spawner lost backend connection');
      },
    });
    await create(original, 'restart-idle');
    await release(original, 'restart-idle');
    expect((await create(original, 'before-restart')).status).toBe(429);
    const replacement = new SessionRoutes(capped, {
      ...fakeBackend,
      async listSessions() {
        return stopped.has('restart-idle')
          ? []
          : [mkBackendSession('restart-idle', 'org_pressure')];
      },
    });
    await replacement.adoptExisting();
    expect(await replacement.sweepExpired()).toBe(1);
    expect((await create(replacement, 'after-restart')).status).toBe(201);
    expect(destroyed.size).toBe(0);
  });
});

describe('workspace cleanup routes', () => {
  async function until(condition: () => boolean): Promise<void> {
    for (let i = 0; i < 200 && !condition(); i += 1) await Bun.sleep(1);
    expect(condition()).toBe(true);
  }

  test('if_stopped destroys only a workspace with no compute under its id', async () => {
    const listed: BackendSession[] = [];
    const routes = new SessionRoutes(cfg, {
      ...fakeBackend,
      async listSessions(): Promise<BackendSession[]> {
        return listed;
      },
    });

    // Nothing runs under the id: the preserved workspace goes.
    const idle = await routes.handleDestroy('stopped-1', { ifStopped: true });
    expect(await idle.json()).toEqual({
      destroyed: false,
      busy: false,
      deletion: 'done',
    });
    expect(destroyed.has('stopped-1')).toBe(true);

    // A container still starting (on a peer replica): kept.
    listed.push({
      ...mkBackendSession('starting-1', 'org_ws'),
      state: 'degraded',
    });
    const starting = await routes.handleDestroy('starting-1', {
      ifStopped: true,
    });
    expect(await starting.json()).toEqual({ destroyed: false, busy: true });
    expect(destroyed.has('starting-1')).toBe(false);

    // A container whose process exited out-of-band is no compute.
    listed.push({
      ...mkBackendSession('exited-1', 'org_ws'),
      state: 'degraded',
      ended: true,
    });
    await routes.handleDestroy('exited-1', { ifStopped: true });
    expect(destroyed.has('exited-1')).toBe(true);
  });

  test('if_stopped keeps a registered session even with no exec running', async () => {
    const routes = new SessionRoutes(cfg, fakeBackend);
    await routes.handleCreate(
      JSON.stringify({ sessionId: 'warm-1', organizationId: 'org_ws' }),
    );
    fakeHealth.liveExecs = 0;
    const res = await routes.handleDestroy('warm-1', { ifStopped: true });
    expect(await res.json()).toEqual({ destroyed: false, busy: true });
    expect(destroyed.has('warm-1')).toBe(false);
  });

  test('if_stopped keeps the workspace when the backend cannot list', async () => {
    const routes = new SessionRoutes(cfg, {
      ...fakeBackend,
      async listSessions(): Promise<BackendSession[]> {
        throw new Error('docker ps failed');
      },
    });
    const res = await routes.handleDestroy('unknown-1', { ifStopped: true });
    expect(await res.json()).toEqual({ destroyed: false, busy: true });
    expect(destroyed.has('unknown-1')).toBe(false);
  });

  test('a conditional destroy refuses while a create of the id is in flight', async () => {
    const gate = Promise.withResolvers<void>();
    const routes = new SessionRoutes(cfg, {
      ...fakeBackend,
      async createSession(spec: SessionSpec) {
        await gate.promise;
        return fakeBackend.createSession(spec);
      },
    });
    const creating = routes.handleCreate(
      JSON.stringify({ sessionId: 'racing-1', organizationId: 'org_ws' }),
    );
    await until(() => routes.holds('racing-1'));
    for (const opts of [{ ifIdle: true }, { ifStopped: true }]) {
      const res = await routes.handleDestroy('racing-1', opts);
      expect(await res.json()).toEqual({ destroyed: false, busy: true });
    }
    gate.resolve();
    expect((await creating).status).toBe(201);
    expect(destroyed.has('racing-1')).toBe(false);
  });

  test('a create waits for a destroy of the same id already under way', async () => {
    const gate = Promise.withResolvers<void>();
    const order: string[] = [];
    const routes = new SessionRoutes(cfg, {
      ...fakeBackend,
      async destroySession(sessionId: string) {
        order.push('destroy:start');
        await gate.promise;
        order.push('destroy:end');
        return fakeBackend.destroySession(sessionId);
      },
      async createSession(spec: SessionSpec) {
        order.push('create');
        return fakeBackend.createSession(spec);
      },
    });
    const destroying = routes.handleDestroy('reborn-1');
    await until(() => order.includes('destroy:start'));
    const creating = routes.handleCreate(
      JSON.stringify({ sessionId: 'reborn-1', organizationId: 'org_ws' }),
    );
    await Bun.sleep(20);
    expect(order).toEqual(['destroy:start']);
    gate.resolve();
    expect((await destroying).status).toBe(200);
    expect((await creating).status).toBe(201);
    expect(order).toEqual(['destroy:start', 'destroy:end', 'create']);
  });

  test('the inventory reports sessions this replica holds as active', async () => {
    const routes = new SessionRoutes(cfg, {
      ...fakeBackend,
      async listWorkspaces() {
        return [
          { sessionId: 'held-1', touchedAtMs: 1, active: false, pinned: false },
          {
            sessionId: 'stopped-2',
            touchedAtMs: 2,
            active: false,
            pinned: true,
            organizationId: 'org_ws',
          },
        ];
      },
      async listOrganizationResources() {
        return ['org_gone', 'org_ws'];
      },
    });
    await routes.handleCreate(
      JSON.stringify({ sessionId: 'held-1', organizationId: 'org_ws' }),
    );
    const res = await routes.handleWorkspaces();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      backend: 'docker',
      workspaces: [
        { sessionId: 'held-1', touchedAtMs: 1, active: true, pinned: false },
        {
          sessionId: 'stopped-2',
          touchedAtMs: 2,
          active: false,
          pinned: true,
          organizationId: 'org_ws',
        },
      ],
      organizations: ['org_gone', 'org_ws'],
    });
  });

  test('an inventory that cannot be read is a 503, never an empty list', async () => {
    const routes = new SessionRoutes(cfg, {
      ...fakeBackend,
      async listWorkspaces(): Promise<never> {
        throw new Error('EACCES');
      },
    });
    expect((await routes.handleWorkspaces()).status).toBe(503);
  });

  test('organization teardown destroys what is left, then the resources beyond it', async () => {
    const torn: string[] = [];
    const routes = new SessionRoutes(cfg, {
      ...fakeBackend,
      async listSessions(organizationId?: string): Promise<BackendSession[]> {
        return organizationId === 'org_gone'
          ? [
              mkBackendSession('left-running', 'org_gone'),
              {
                ...mkBackendSession('left-exited', 'org_gone'),
                state: 'degraded',
                ended: true,
              },
            ]
          : [];
      },
      async listWorkspaces() {
        const quiet = { touchedAtMs: 1, active: false, pinned: false };
        return [
          // Stopped: no container names it, its workspace does.
          { sessionId: 'left-stopped', organizationId: 'org_gone', ...quiet },
          { sessionId: 'left-running', organizationId: 'org_gone', ...quiet },
          { sessionId: 'kept-other', organizationId: 'org_ws', ...quiet },
          { sessionId: 'kept-unnamed', ...quiet },
        ];
      },
      async teardownOrganization(organizationId: string) {
        torn.push(organizationId);
        return { containers: 4, volumes: 7, networks: 1 };
      },
    });
    const res = await routes.handleOrganizationTeardown('org_gone');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      sessions: 3,
      containers: 4,
      volumes: 7,
      networks: 1,
    });
    expect([...destroyed].sort()).toEqual([
      'left-exited',
      'left-running',
      'left-stopped',
    ]);
    expect(torn).toEqual(['org_gone']);
  });

  test('organization teardown goes on when the workspaces cannot be listed', async () => {
    const routes = new SessionRoutes(cfg, {
      ...fakeBackend,
      async listSessions(organizationId?: string): Promise<BackendSession[]> {
        return organizationId === 'org_gone'
          ? [mkBackendSession('left-running', 'org_gone')]
          : [];
      },
      async listWorkspaces(): Promise<never> {
        throw new Error('persistentvolumeclaims is forbidden');
      },
    });
    const res = await routes.handleOrganizationTeardown('org_gone');
    expect(res.status).toBe(200);
    expect([...destroyed]).toEqual(['left-running']);
  });

  test('organization teardown waits out a create in flight and surfaces a failed destroy', async () => {
    const gate = Promise.withResolvers<void>();
    const routes = new SessionRoutes(cfg, {
      ...fakeBackend,
      async createSession(spec: SessionSpec) {
        await gate.promise;
        return fakeBackend.createSession(spec);
      },
      async listSessions(organizationId?: string): Promise<BackendSession[]> {
        return organizationId === 'org_busy'
          ? [mkBackendSession('stuck-1', 'org_busy')]
          : [];
      },
      async teardownOrganization() {
        throw new Error('teardown must wait for the sessions');
      },
    });
    const creating = routes.handleCreate(
      JSON.stringify({ sessionId: 'late-1', organizationId: 'org_busy' }),
    );
    await until(() => routes.holds('late-1'));
    expect((await routes.handleOrganizationTeardown('org_busy')).status).toBe(
      409,
    );
    gate.resolve();
    await creating;

    backendDestroyThrows.add('stuck-1');
    const failed = await routes.handleOrganizationTeardown('org_busy');
    expect(failed.status).toBe(502);
    expect(await failed.json()).toEqual({
      error: 'destroy_failed',
      sessionId: 'stuck-1',
    });
  });
});

describe('sweep and adoption hygiene', () => {
  const tokenOf = (id: string) => deriveRunnerdToken(cfg.sandboxToken, id);
  const create = (
    routes: SessionRoutes,
    id: string,
    profile: 'agent' | 'default' = 'default',
  ) =>
    routes.handleCreate(
      JSON.stringify({ sessionId: id, organizationId: 'org_hygiene', profile }),
    );
  const release = async (routes: SessionRoutes, id: string) => {
    const ticket: unknown = await (
      await routes.handleActivity(id, 'ticket')
    ).json();
    return routes.handleActivity(id, 'release', JSON.stringify(ticket));
  };

  test('a maintenance pass still running is joined, not stacked', async () => {
    const listing = Promise.withResolvers<BackendSession[]>();
    let lists = 0;
    const routes = new SessionRoutes(cfg, {
      ...fakeBackend,
      async listSessions() {
        lists += 1;
        return listing.promise;
      },
    });
    const first = routes.maintain();
    const second = routes.maintain();
    listing.resolve([]);
    await Promise.all([first, second]);
    expect(lists).toBe(1);
    await routes.maintain();
    expect(lists).toBe(2);
  });

  test('ended compute is removed by its incarnation, the workspace kept, and a failure backs off', async () => {
    const stops: Array<[string, number | undefined]> = [];
    const routes = new SessionRoutes(cfg, {
      ...fakeBackend,
      async listSessions(): Promise<BackendSession[]> {
        return [
          {
            ...mkBackendSession('exited-1', 'org_a'),
            createdAtMs: 5,
            state: 'degraded',
            ended: true,
          },
          {
            ...mkBackendSession('exited-stuck', 'org_a'),
            state: 'degraded',
            ended: true,
          },
          {
            ...mkBackendSession('starting-1', 'org_a'),
            state: 'degraded',
          },
          mkBackendSession('running-1', 'org_a'),
        ];
      },
      async stopSession(sessionId: string, expectedCreatedAtMs?: number) {
        stops.push([sessionId, expectedCreatedAtMs]);
        if (sessionId === 'exited-stuck')
          throw new Error('docker rm timed out');
        return true;
      },
    });
    await routes.adoptExisting();
    await routes.endedReapSettled();
    expect(stops).toEqual([
      ['exited-1', 5],
      ['exited-stuck', 1_000],
    ]);
    expect(destroyed.size).toBe(0);
    expect((await routes.handleGet('running-1')).status).toBe(200);
    // The failed removal waits out its back-off instead of retrying (and
    // logging) on every sweep.
    stops.length = 0;
    await routes.adoptExisting();
    await routes.endedReapSettled();
    expect(stops).toEqual([['exited-1', 5]]);
  });

  test('ended compute is removed beside the API, several at a time', async () => {
    const ended = Array.from({ length: 20 }, (_, i) => ({
      ...mkBackendSession(`exited-${i}`, 'org_a'),
      state: 'degraded' as const,
      ended: true,
    }));
    let inFlight = 0;
    let most = 0;
    const gate = Promise.withResolvers<void>();
    const routes = new SessionRoutes(cfg, {
      ...fakeBackend,
      async listSessions(): Promise<BackendSession[]> {
        return [...ended, mkBackendSession('running-1', 'org_a')];
      },
      async stopSession() {
        inFlight += 1;
        most = Math.max(most, inFlight);
        await gate.promise;
        inFlight -= 1;
        return true;
      },
    });
    // After a host reboot every session container has ended: the API (and
    // the running sessions) must not wait for twenty removals.
    expect(await settlesWithin(routes.adoptExisting(), 1_000)).toBe(true);
    expect((await routes.handleGet('running-1')).status).toBe(200);
    gate.resolve();
    await routes.endedReapSettled();
    expect(most).toBeGreaterThan(1);
    expect(most).toBeLessThanOrEqual(8);
  });

  describe('a resume beside the removal of its ended compute', () => {
    const endedRace = (id: string) => ({
      ...mkBackendSession(id, 'org_hygiene'),
      createdAtMs: 5,
      state: 'degraded' as const,
      ended: true,
    });

    test('a create of the id waits for the removal, then goes ahead on a settled slate', async () => {
      const removal = Promise.withResolvers<void>();
      const order: string[] = [];
      let listed: BackendSession[] = [endedRace('race-1')];
      const routes = new SessionRoutes(cfg, {
        ...fakeBackend,
        async listSessions(): Promise<BackendSession[]> {
          return listed;
        },
        async stopSession(sessionId: string, expectedCreatedAtMs?: number) {
          order.push(`stop:${sessionId}:${expectedCreatedAtMs}`);
          await removal.promise;
          order.push(`stopped:${sessionId}`);
          return fakeBackend.stopSession(sessionId);
        },
        async createSession(spec: SessionSpec) {
          order.push(`create:${spec.sessionId}`);
          return fakeBackend.createSession(spec);
        },
      });
      await routes.adoptExisting();
      listed = [];
      const resumed = routes.handleCreate(
        JSON.stringify({ sessionId: 'race-1', organizationId: 'org_hygiene' }),
      );
      expect(await settlesWithin(resumed, 200)).toBe(false);
      expect(order).toEqual(['stop:race-1:5']);
      removal.resolve();
      expect((await resumed).status).toBe(201);
      expect(order).toEqual([
        'stop:race-1:5',
        'stopped:race-1',
        'create:race-1',
      ]);
      expect(
        await settlesWithin(routes.handleActivity('race-1', 'acquire'), 1_000),
      ).toBe(true);
      expect(destroyed.size).toBe(0);
    });

    test('the session registered under the id is neither held up nor counted as freed by that removal', async () => {
      const removal = Promise.withResolvers<void>();
      const capped = { ...cfg, session: { ...cfg.session, maxSessions: 1 } };
      let listed: BackendSession[] = [endedRace('race-2')];
      const fenced: Array<number | undefined> = [];
      const routes = new SessionRoutes(capped, {
        ...fakeBackend,
        async listSessions(): Promise<BackendSession[]> {
          return listed;
        },
        async stopSession(sessionId: string, expectedCreatedAtMs?: number) {
          fenced.push(expectedCreatedAtMs);
          // The ended incarnation's removal hangs; the registered one's goes.
          if (expectedCreatedAtMs === 5) await removal.promise;
          return fakeBackend.stopSession(sessionId);
        },
      });
      await routes.adoptExisting();
      // A peer replica resumed the id meanwhile: the next adoption registers
      // the new incarnation while the old one's removal still runs.
      listed = [
        { ...mkBackendSession('race-2', 'org_hygiene'), createdAtMs: 9_000 },
      ];
      await routes.adoptExisting();
      expect(
        await settlesWithin(routes.handleActivity('race-2', 'acquire'), 1_000),
      ).toBe(true);
      await release(routes, 'race-2');
      // At capacity, the registered session is reclaimed for the create; the
      // other incarnation's removal is not mistaken for its stop.
      const next = create(routes, 'race-next');
      expect(await settlesWithin(next, 1_000)).toBe(true);
      expect((await next).status).toBe(201);
      expect(fenced).toEqual([5, 9_000]);
      removal.resolve();
      await routes.endedReapSettled();
    });
  });

  test('the build-cache reconcile after adoption covers agent sessions only and never holds adoption up', async () => {
    const gate = Promise.withResolvers<void>();
    const reconciled: string[][] = [];
    const routes = new SessionRoutes(cfg, {
      ...fakeBackend,
      async listSessions(): Promise<BackendSession[]> {
        return [
          mkBackendSession('builder-1', 'org_build'),
          { ...mkBackendSession('render-1', 'org_render'), profile: 'default' },
        ];
      },
      async reconcileBuildCache(orgIds: readonly string[]) {
        await gate.promise;
        reconciled.push([...orgIds]);
      },
    });
    expect(await settlesWithin(routes.adoptExisting(), 1_000)).toBe(true);
    expect((await routes.handleGet('builder-1')).status).toBe(200);
    expect(reconciled).toEqual([]);
    gate.resolve();
    await routes.buildCacheSettled();
    expect(reconciled).toEqual([['org_build']]);
  });

  test('a slow build-cache job never holds the next maintenance pass up', async () => {
    // After a release every helper is drifted and adoption recreates each
    // organization's in turn: minutes during which sessions must still be
    // swept every pass.
    const gate = Promise.withResolvers<void>();
    const reconciled: string[][] = [];
    let lists = 0;
    const routes = new SessionRoutes(cfg, {
      ...fakeBackend,
      async listSessions(): Promise<BackendSession[]> {
        lists += 1;
        return [
          {
            ...mkBackendSession('slow-cache-1', 'org_slow_cache'),
            createdAtMs: Date.now(),
            ttlMs: 3_600_000,
            idleTimeoutMs: 3_600_000,
          },
        ];
      },
      async reconcileBuildCache(orgIds: readonly string[]) {
        reconciled.push([...orgIds]);
        await gate.promise;
      },
    });
    fakeHealth.lastActivityAtMs = Date.now();
    expect(await settlesWithin(routes.maintain(), 1_000)).toBe(true);
    expect(await settlesWithin(routes.maintain(), 1_000)).toBe(true);
    expect(lists).toBe(2);
    expect(healthProbes.get(tokenOf('slow-cache-1'))).toBe(2);
    // One build-cache job at a time: the passes' upkeep joined the one
    // under way instead of stacking behind it.
    expect(reconciled).toEqual([['org_slow_cache']]);
    gate.resolve();
    await routes.buildCacheSettled();
    expect(reconciled).toEqual([['org_slow_cache']]);
    // Once it is done, the next pass's upkeep runs again.
    await routes.maintain();
    await routes.buildCacheSettled();
    expect(reconciled).toEqual([['org_slow_cache'], []]);
  });

  test('organizations adopted while the build-cache job runs are reconciled after it', async () => {
    const gate = Promise.withResolvers<void>();
    const reconciled: string[][] = [];
    let listed = [mkBackendSession('early-1', 'org_early')];
    const routes = new SessionRoutes(cfg, {
      ...fakeBackend,
      async listSessions(): Promise<BackendSession[]> {
        return listed;
      },
      async reconcileBuildCache(orgIds: readonly string[]) {
        reconciled.push([...orgIds]);
        await gate.promise;
      },
    });
    await routes.adoptExisting();
    listed = [...listed, mkBackendSession('late-1', 'org_late')];
    await routes.adoptExisting();
    expect(reconciled).toEqual([['org_early']]);
    gate.resolve();
    await routes.buildCacheSettled();
    expect(reconciled).toEqual([['org_early'], ['org_late']]);
  });

  test('a released session stops after the short window; one still held keeps the full idle window', async () => {
    const routes = new SessionRoutes(cfg, fakeBackend);
    await create(routes, 'released-1');
    await create(routes, 'held-1');
    expect(await (await release(routes, 'released-1')).json()).toEqual({
      released: true,
    });
    const now = Date.now();
    fakeHealth.lastActivityAtMs = now - 6 * 60_000;
    expect(await routes.sweepExpired(now)).toBe(1);
    expect(stopped.has('released-1')).toBe(true);
    expect(stopped.has('held-1')).toBe(false);
    expect(destroyed.size).toBe(0);
    // Under the short window, nothing goes.
    fakeHealth.lastActivityAtMs = now - 60_000;
    await create(routes, 'released-2');
    await release(routes, 'released-2');
    expect(await routes.sweepExpired(now)).toBe(0);
  });

  test('a released Docker-in-sandbox agent session keeps the full idle window', async () => {
    const routes = new SessionRoutes(
      { ...cfg, dockerInContainer: true },
      fakeBackend,
    );
    await create(routes, 'dind-1', 'agent');
    await release(routes, 'dind-1');
    const now = Date.now();
    fakeHealth.lastActivityAtMs = now - 6 * 60_000;
    expect(await routes.sweepExpired(now)).toBe(0);
    fakeHealth.lastActivityAtMs = now - 31 * 60_000;
    expect(await routes.sweepExpired(now)).toBe(1);
    expect(stopped.has('dind-1')).toBe(true);
  });

  test('a running session whose runnerd stays unreachable is stopped after five sweeps', async () => {
    const routes = new SessionRoutes(cfg, fakeBackend);
    await create(routes, 'wedged-1');
    await create(routes, 'wedged-pinned');
    await routes.handleSetPinned(
      'wedged-pinned',
      JSON.stringify({ pinned: true }),
    );
    deadDaemons.add(tokenOf('wedged-1'));
    deadDaemons.add(tokenOf('wedged-pinned'));
    fakeHealth.lastActivityAtMs = Date.now();
    for (let sweep = 1; sweep < 5; sweep += 1) {
      expect(await routes.sweepExpired()).toBe(0);
    }
    expect(stopped.size).toBe(0);
    expect(await routes.sweepExpired()).toBe(1);
    expect(stopped.has('wedged-1')).toBe(true);
    expect(stopped.has('wedged-pinned')).toBe(false);
    expect(destroyed.size).toBe(0);
  });

  test('an answer resets the unreachable streak', async () => {
    const routes = new SessionRoutes(cfg, fakeBackend);
    await create(routes, 'flaky-1');
    fakeHealth.lastActivityAtMs = Date.now();
    deadDaemons.add(tokenOf('flaky-1'));
    for (let sweep = 0; sweep < 4; sweep += 1) await routes.sweepExpired();
    deadDaemons.delete(tokenOf('flaky-1'));
    await routes.sweepExpired();
    deadDaemons.add(tokenOf('flaky-1'));
    for (let sweep = 0; sweep < 4; sweep += 1) await routes.sweepExpired();
    expect(stopped.size).toBe(0);
  });

  test('a sweep that cannot probe (pinned, or an exec running) starts the streak over', async () => {
    const routes = new SessionRoutes(cfg, fakeBackend);
    await create(routes, 'paused-1');
    fakeHealth.lastActivityAtMs = Date.now();
    deadDaemons.add(tokenOf('paused-1'));
    for (let sweep = 0; sweep < 4; sweep += 1) await routes.sweepExpired();
    // The pin itself goes through runnerd; the sweeps never reach it.
    const pin = async (pinned: boolean) => {
      deadDaemons.delete(tokenOf('paused-1'));
      await routes.handleSetPinned('paused-1', JSON.stringify({ pinned }));
      deadDaemons.add(tokenOf('paused-1'));
    };
    await pin(true);
    await routes.sweepExpired();
    await pin(false);
    // One more failure is a new streak of one, not the fifth in a row.
    await routes.sweepExpired();
    expect(stopped.has('paused-1')).toBe(false);
  });

  test('concurrent creates at capacity each reclaim a released session of their own', async () => {
    const capped = { ...cfg, session: { ...cfg.session, maxSessions: 3 } };
    const routes = new SessionRoutes(capped, fakeBackend);
    for (const id of ['warm-a', 'warm-b', 'warm-c']) {
      await create(routes, id);
      await release(routes, id);
    }
    const responses = await Promise.all(
      ['new-a', 'new-b', 'new-c'].map((id) => create(routes, id)),
    );
    expect(responses.map((response) => response.status)).toEqual([
      201, 201, 201,
    ]);
    expect([...stopped].sort()).toEqual(['warm-a', 'warm-b', 'warm-c']);
    expect(routes.sessionCount()).toBe(3);
  });

  test('pressure reclamation takes the session idle longest', async () => {
    const capped = { ...cfg, session: { ...cfg.session, maxSessions: 2 } };
    const routes = new SessionRoutes(capped, fakeBackend);
    await create(routes, 'busy-lately');
    await create(routes, 'long-idle');
    await release(routes, 'busy-lately');
    await release(routes, 'long-idle');
    const now = Date.now();
    daemonLastActivity.set(tokenOf('busy-lately'), now - 1_000);
    daemonLastActivity.set(tokenOf('long-idle'), now - 120_000);
    // The sweep reads each daemon's clock; neither is past a window yet.
    expect(await routes.sweepExpired(now)).toBe(0);
    expect((await create(routes, 'incoming')).status).toBe(201);
    expect([...stopped]).toEqual(['long-idle']);
  });

  test('a caller that hangs up on an attach does not make the backend suspect', async () => {
    let existsChecks = 0;
    const routes = new SessionRoutes(cfg, {
      ...fakeBackend,
      async sessionExists(sessionId: string) {
        existsChecks += 1;
        return fakeBackend.sessionExists(sessionId);
      },
    });
    await create(routes, 'attach-1');
    existsChecks = 0;
    const caller = new AbortController();
    const response = await routes.handleExecAttach(
      new Request('http://spawner/v1/sessions/attach-1/exec/hang-1/attach', {
        signal: caller.signal,
      }),
      'attach-1',
      'hang-1',
    );
    const reader = response.body?.getReader();
    await reader?.read();
    caller.abort();
    await reader?.cancel().catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(existsChecks).toBe(0);
  });
});

describe('the first-come line for host room', () => {
  const GIB = 1024 ** 3;
  const capped = { ...cfg, session: { ...cfg.session, maxSessions: 2 } };
  const create = (routes: SessionRoutes, id: string) =>
    routes.handleCreate(
      JSON.stringify({
        sessionId: id,
        organizationId: 'org_line',
        profile: 'agent',
      }),
    );
  const place = async (response: Response) => {
    const body: unknown = await response.json();
    return {
      status: response.status,
      retryAfter: response.headers.get('retry-after'),
      queue:
        body !== null && typeof body === 'object' && 'queue' in body
          ? body.queue
          : undefined,
    };
  };

  test('freed room goes to the oldest waiter, not to the create that arrives first', async () => {
    const routes = new SessionRoutes(capped, fakeBackend);
    await create(routes, 'line-a');
    await create(routes, 'line-b');
    // Refused, and in line: told where it stands and when to come back.
    expect(await place(await create(routes, 'waiter-old'))).toEqual({
      status: 429,
      retryAfter: '5',
      queue: { position: 0, waiting: 1 },
    });
    await routes.handleDestroy('line-a');
    // Room is free, but it is the waiter's: a newcomer gets in line behind.
    expect(await place(await create(routes, 'newcomer'))).toEqual({
      status: 429,
      retryAfter: '10',
      queue: { position: 1, waiting: 2 },
    });
    expect((await create(routes, 'waiter-old')).status).toBe(201);
    expect(routes.roomQueueLength()).toBe(1);
  });

  test('places and hints grow down the line, up to a minute', async () => {
    const routes = new SessionRoutes(
      { ...cfg, session: { ...cfg.session, maxSessions: 1 } },
      fakeBackend,
    );
    await create(routes, 'only');
    const hints: Array<string | null> = [];
    for (let i = 0; i < 14; i += 1) {
      hints.push(
        (await create(routes, `wait-${i}`)).headers.get('retry-after'),
      );
    }
    expect(hints.slice(0, 3)).toEqual(['5', '10', '15']);
    expect(hints.at(-1)).toBe('60');
    // Asking again keeps a waiter's place.
    expect((await place(await create(routes, 'wait-1'))).queue).toEqual({
      position: 1,
      waiting: 14,
    });
  });

  test('a waiter that stops asking gives its place up', async () => {
    const routes = new SessionRoutes(capped, fakeBackend);
    await create(routes, 'busy-a');
    await create(routes, 'busy-b');
    expect((await create(routes, 'gave-up')).status).toBe(429);
    await routes.handleDestroy('busy-a');
    expect((await create(routes, 'next')).status).toBe(429);
    // Twice its 5 s hint and the slack later, it no longer holds the room.
    setSystemTime(new Date(Date.now() + 26_000));
    try {
      expect((await create(routes, 'next')).status).toBe(201);
    } finally {
      setSystemTime();
    }
  });

  test('a destroyed session leaves the line', async () => {
    const routes = new SessionRoutes(capped, fakeBackend);
    await create(routes, 'held-a');
    await create(routes, 'held-b');
    expect((await create(routes, 'cancelled')).status).toBe(429);
    await routes.handleDestroy('cancelled');
    await routes.handleDestroy('held-a');
    expect((await create(routes, 'after')).status).toBe(201);
  });

  test('short of memory, the room an older waiter needs is not given to a newer create', async () => {
    let available = 2;
    const reading = () => ({
      totalBytes: 16 * GIB,
      availableBytes: available * GIB,
    });
    const routes = new SessionRoutes(cfg, fakeBackend, undefined, {
      latest: reading,
      read: () => Promise.resolve(reading()),
    });
    expect((await create(routes, 'mem-old')).status).toBe(429);
    // Enough for one more session, not for the waiter and a newcomer.
    available = 2.5;
    expect((await create(routes, 'mem-new')).status).toBe(429);
    expect((await create(routes, 'mem-old')).status).toBe(201);
  });

  test('a waiter the host could never fit holds no memory for the creates behind it', async () => {
    // A 2 GiB host keeps 1 GiB free: a 1.5 GiB working set never fits.
    const tiny = () => ({ totalBytes: 2 * GIB, availableBytes: 1.8 * GIB });
    const dind = { ...cfg, dockerInContainer: true };
    const routes = new SessionRoutes(dind, fakeBackend, undefined, {
      latest: tiny,
      read: () => Promise.resolve(tiny()),
    });
    expect((await create(routes, 'too-big')).status).toBe(429);
    const render = await routes.handleCreate(
      JSON.stringify({
        sessionId: 'small-render',
        organizationId: 'org_line',
        profile: 'default',
      }),
    );
    expect(render.status).toBe(201);
  });

  test('a restarted spawner starts with no line', async () => {
    const first = new SessionRoutes(capped, fakeBackend);
    await create(first, 'r-a');
    await create(first, 'r-b');
    expect((await create(first, 'r-wait')).status).toBe(429);
    const second = new SessionRoutes(capped, fakeBackend);
    expect(second.roomQueueLength()).toBe(0);
  });
});

describe('memory-aware admission', () => {
  const GIB = 1024 ** 3;
  const create = (routes: SessionRoutes, id: string) =>
    routes.handleCreate(
      JSON.stringify({
        sessionId: id,
        organizationId: 'org_memory',
        profile: 'agent',
      }),
    );
  /** A host whose memory reads as `available()` GiB of 16. */
  const host = (available: () => number) => {
    const reading = () => ({
      totalBytes: 16 * GIB,
      availableBytes: available() * GIB,
    });
    return { latest: reading, read: () => Promise.resolve(reading()) };
  };

  test('a create that would leave the host under its reserve is refused with host_memory', async () => {
    // 16 GiB host: the reserve is 1.6 GiB; an agent session is planned at
    // 512 MiB, so 2 GiB available is not enough.
    const routes = new SessionRoutes(
      cfg,
      fakeBackend,
      undefined,
      host(() => 2),
    );
    const refused = await create(routes, 'tight-1');
    expect(refused.status).toBe(429);
    // First in line: asked back soon.
    expect(refused.headers.get('retry-after')).toBe('5');
    expect(await refused.json()).toMatchObject({
      error: 'host_memory',
      queue: { position: 0, waiting: 1 },
    });
    expect(created.has('tight-1')).toBe(false);
    expect(routes.pendingCreates().size).toBe(0);
  });

  test('creates still starting count against the memory they are about to take', async () => {
    const gate = Promise.withResolvers<void>();
    const routes = new SessionRoutes(
      cfg,
      {
        ...fakeBackend,
        async createSession(spec) {
          await gate.promise;
          return fakeBackend.createSession(spec);
        },
      },
      undefined,
      host(() => 4),
    );
    // 4 GiB available, 1.6 GiB reserve, 512 MiB each: four fit, the fifth not.
    const burst = ['b1', 'b2', 'b3', 'b4', 'b5'].map((id) =>
      create(routes, id),
    );
    expect((await burst[4])?.status).toBe(429);
    gate.resolve();
    const statuses = await Promise.all(burst.slice(0, 4));
    expect(statuses.map((response) => response.status)).toEqual([
      201, 201, 201, 201,
    ]);
  });

  test('a session that just started keeps its working set reserved while it grows into it', async () => {
    // MemAvailable still shows 4 GiB: the new sessions sit at their idle
    // footprint, but their turns are about to take their working sets.
    const routes = new SessionRoutes(
      cfg,
      fakeBackend,
      undefined,
      host(() => 4),
    );
    for (const id of ['young-1', 'young-2', 'young-3', 'young-4']) {
      expect((await create(routes, id)).status).toBe(201);
    }
    expect((await create(routes, 'young-5')).status).toBe(429);
    // A session that is gone gives its reservation back at once.
    await routes.handleDestroy('young-1');
    expect((await create(routes, 'young-5')).status).toBe(201);
  });

  test('short of memory, a released idle session is reclaimed to make room', async () => {
    let available = 8;
    const routes = new SessionRoutes(
      cfg,
      {
        ...fakeBackend,
        async stopSession(sessionId: string) {
          available = 8;
          return fakeBackend.stopSession(sessionId);
        },
      },
      undefined,
      host(() => available),
    );
    expect((await create(routes, 'warm-mem')).status).toBe(201);
    const ticket: unknown = await (
      await routes.handleActivity('warm-mem', 'ticket')
    ).json();
    await routes.handleActivity('warm-mem', 'release', JSON.stringify(ticket));
    available = 2;
    expect((await create(routes, 'after-reclaim')).status).toBe(201);
    expect(stopped.has('warm-mem')).toBe(true);
  });

  test('unknown host memory never refuses a create', async () => {
    const routes = new SessionRoutes(cfg, fakeBackend, undefined, {
      latest: () => {
        throw new Error('meminfo unreadable');
      },
      read: () => Promise.reject(new Error('meminfo unreadable')),
    });
    expect((await create(routes, 'unknown-mem')).status).toBe(201);
  });
});

describe('disk-aware admission', () => {
  const GIB = 1024 ** 3;
  const create = (routes: SessionRoutes, id: string) =>
    routes.handleCreate(
      JSON.stringify({
        sessionId: id,
        organizationId: 'org_disk',
        profile: 'agent',
      }),
    );
  /** A 100 GiB session disk (a 5 GiB floor) with `available()` GiB free. */
  const disk = (available: () => number) => {
    const reading = () => ({
      totalBytes: 100 * GIB,
      availableBytes: available() * GIB,
    });
    return { latest: reading, read: () => Promise.resolve(reading()) };
  };

  test('below its floor, the session disk takes no session: the create waits in line with host_disk', async () => {
    let available = 4;
    const routes = new SessionRoutes(
      cfg,
      fakeBackend,
      undefined,
      undefined,
      disk(() => available),
    );
    // A released idle session: stopping it would free no disk.
    available = 50;
    expect((await create(routes, 'warm-disk')).status).toBe(201);
    const ticket: unknown = await (
      await routes.handleActivity('warm-disk', 'ticket')
    ).json();
    await routes.handleActivity('warm-disk', 'release', JSON.stringify(ticket));
    available = 4;
    const refused = await create(routes, 'disk-wait');
    expect(refused.status).toBe(429);
    expect(refused.headers.get('retry-after')).toBe('5');
    expect(await refused.json()).toMatchObject({
      error: 'host_disk',
      queue: { position: 0, waiting: 1 },
    });
    expect(stopped.has('warm-disk')).toBe(false);
    expect(created.has('disk-wait')).toBe(false);
    // Space freed: the waiter gets in.
    available = 6;
    expect((await create(routes, 'disk-wait')).status).toBe(201);
    expect(routes.roomQueueLength()).toBe(0);
  });

  test('an operator floor of 0 turns the disk check off', async () => {
    const off = { ...cfg, session: { ...cfg.session, minFreeDiskBytes: 0 } };
    const routes = new SessionRoutes(
      off,
      fakeBackend,
      undefined,
      undefined,
      disk(() => 0.5),
    );
    expect((await create(routes, 'no-floor')).status).toBe(201);
  });

  test('an unknown session disk never refuses a create', async () => {
    const unreadable = new SessionRoutes(
      cfg,
      fakeBackend,
      undefined,
      undefined,
      {
        latest: () => {
          throw new Error('statfs failed');
        },
        read: () => Promise.reject(new Error('statfs failed')),
      },
    );
    expect((await create(unreadable, 'disk-unknown-1')).status).toBe(201);
    const unread = new SessionRoutes(cfg, fakeBackend, undefined, undefined, {
      latest: () => null,
      read: () => Promise.resolve(null),
    });
    expect((await create(unread, 'disk-unknown-2')).status).toBe(201);
  });

  test('the build-cache upkeep reads the session disk afresh', async () => {
    let available = 3;
    const seen: Array<{ availableBytes: number; short: boolean } | null> = [];
    const routes = new SessionRoutes(
      cfg,
      {
        ...fakeBackend,
        async reconcileBuildCache(_orgIds, upkeep) {
          seen.push((await upkeep?.sessionDisk?.()) ?? null);
          available = 8;
          seen.push((await upkeep?.sessionDisk?.()) ?? null);
        },
      },
      undefined,
      undefined,
      disk(() => available),
    );
    await routes.maintain();
    await routes.buildCacheSettled();
    expect(seen).toEqual([
      { availableBytes: 3 * GIB, short: true },
      { availableBytes: 8 * GIB, short: false },
    ]);
  });
});

describe('settlesWithin', () => {
  test('answers whether a promise settled, either way, in time', async () => {
    expect(await settlesWithin(Promise.resolve(), 1_000)).toBe(true);
    expect(await settlesWithin(Promise.reject(new Error('gone')), 1_000)).toBe(
      true,
    );
    expect(await settlesWithin(new Promise(() => {}), 5)).toBe(false);
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
