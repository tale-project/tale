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
  spyOn,
  test,
} from 'bun:test';
import { getEventListeners } from 'node:events';

import { ActivityGate } from '../../../sandbox-runtime/daemon/src/activity-gate.ts';
import {
  SessionIncarnationChangedError,
  type BackendSession,
  type SessionBackend,
  type SessionSpec,
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
const stageBodies: unknown[] = [];
let stageFailure: string | undefined;
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
  dockerReady: undefined as boolean | undefined,
};
const fakeActivities = new Map<string, ActivityGate>();
let legacyDaemon = false;
let legacyIdleReclaim = false;
// Work arriving after a sweep's health snapshot, before runnerd checks its
// claim: the race a sibling spawner or completed operation used to lose.
let beforeReclaim: ((token: string, activity: ActivityGate) => void) | null =
  null;
const reclaimRequests: Array<{ idleBeforeMs?: number }> = [];
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

function replayGapResponse(): Response {
  return new Response(
    ndjson([
      {
        t: 'fail',
        code: 'REPLAY_UNAVAILABLE',
        message:
          'Exec output is no longer available from the requested cursor.',
      },
    ]),
    { headers: { 'content-type': 'application/x-ndjson' } },
  );
}

/** A quiet live exec: one event, then it waits for its reader to detach. */
function hangingExecResponse(): Response {
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            ndjson([
              { t: 'stdout', b64: Buffer.from('live').toString('base64') },
            ]),
          ),
        );
      },
    }),
    { headers: { 'content-type': 'application/x-ndjson' } },
  );
}

beforeAll(() => {
  fakeServer = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const token = req.headers.get('x-tale-runnerd-token') ?? '';
      let activity = fakeActivities.get(token);
      if (activity === undefined) {
        activity = new ActivityGate(
          () => fakeHealth.liveExecs,
          legacyIdleReclaim
            ? undefined
            : () =>
                daemonLastActivity.get(token) ?? fakeHealth.lastActivityAtMs,
        );
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
          ...(fakeHealth.dockerReady === undefined
            ? {}
            : { dockerReady: fakeHealth.dockerReady }),
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
        if (url.pathname === '/reclaim') {
          const idleBeforeMs =
            typeof body.idleBeforeMs === 'number'
              ? body.idleBeforeMs
              : undefined;
          reclaimRequests.push({ idleBeforeMs });
          beforeReclaim?.(token, activity);
          return Response.json({
            claimed: activity.claim(
              String(body.claimId),
              String(body.generation),
              idleBeforeMs,
            ),
          });
        }
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
        if (body.execId === 'gap') return replayGapResponse();
        if (body.execId?.startsWith('hang-')) return hangingExecResponse();
        // Echo-style script: a start, one stdout chunk, then exit 0.
        const text: string =
          body.command?.slice(1).join(' ') ?? body.shell ?? '';
        if (text.includes('__malformed_stream__'))
          return new Response('{broken}\n', {
            headers: { 'content-type': 'application/x-ndjson' },
          });
        // Sentinel: simulate a process that raced the deadline but still exited
        // cleanly (exitCode 0 + timedOut) — the H8 wire-coherence case.
        const cleanTimeout = text.includes('__timeout_clean__');
        // Sentinel: simulate a pre-spawn `fail` line (the process never ran,
        // so runnerd reports no measurement).
        if (text.includes('__utf8_split__')) {
          const bytes = Buffer.from('🙂');
          return new Response(
            ndjson([
              {
                t: 'stdout',
                b64: bytes.subarray(0, 2).toString('base64'),
                seq: 1,
              },
              {
                t: 'stdout',
                b64: bytes.subarray(2).toString('base64'),
                seq: 2,
              },
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
        if (text.includes('__output_limit__')) {
          return new Response(
            ndjson([
              {
                t: 'fail',
                code: 'OUTPUT_LIMIT',
                message: 'Replay limit exceeded',
              },
            ]),
            { headers: { 'content-type': 'application/x-ndjson' } },
          );
        }
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
        if (stageFailure !== undefined)
          return Response.json({ error: stageFailure }, { status: 503 });
        const staged: unknown = await req.json();
        stageBodies.push(staged);
        return Response.json({
          staged: [{ path: 'repo/README.md', bytes: 12 }],
          skipped: [],
          reconciled: true,
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
        if (url.pathname.includes('/gap/')) return replayGapResponse();
        if (url.pathname.includes('/malformed-'))
          return new Response('{broken}\n', {
            headers: { 'content-type': 'application/x-ndjson' },
          });
        if (url.pathname.includes('/replay-unavailable/')) {
          return new Response(
            ndjson([
              {
                t: 'fail',
                code: 'REPLAY_UNAVAILABLE',
                message: 'Replay could not be preserved',
              },
            ]),
            { headers: { 'content-type': 'application/x-ndjson' } },
          );
        }

        if (url.pathname.includes('/hang-')) {
          return hangingExecResponse();
        }
        return new Response(
          ndjson([
            { t: 'replay-start' },
            {
              t: 'stdout',
              b64: Buffer.from('replayed').toString('base64'),
              seq: 1,
            },
            { t: 'replay-complete', throughSeq: 1 },
            {
              t: 'stdout',
              b64: Buffer.from('live').toString('base64'),
              seq: 2,
            },
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
  stageBodies.length = 0;
  stageFailure = undefined;
  execRequests.length = 0;
  backendGone.clear();
  backendCheckThrows = false;
  backendDestroyThrows.clear();
  resumedSessions.clear();
  backendPins.clear();
  fakeHealth.lastActivityAtMs = 0;
  fakeHealth.liveExecs = 0;
  fakeHealth.dockerReady = undefined;
  fakeActivities.clear();
  legacyDaemon = false;
  legacyIdleReclaim = false;
  beforeReclaim = null;
  reclaimRequests.length = 0;
  deadDaemons.clear();
  healthProbes.clear();
  daemonLastActivity.clear();
});

describe('SessionRoutes (fake runnerd)', () => {
  test.each(['exec', 'attach'])(
    'malformed %s output is terminal replay failure and does not evict the session',
    async (method) => {
      const routes = new SessionRoutes(cfg, fakeBackend);
      await routes.handleCreate(
        JSON.stringify({
          sessionId: 'malformed-stream',
          organizationId: 'org_a',
        }),
      );
      const request = new Request('http://sandbox/stream');
      const result =
        method === 'exec'
          ? await routes.handleExec(
              request,
              'malformed-stream',
              JSON.stringify({
                execId: 'malformed-e',
                command: ['echo', '__malformed_stream__'],
              }),
            )
          : await routes.handleExecAttach(
              request,
              'malformed-stream',
              'malformed-e',
            );
      backendGone.add('malformed-stream');
      const text = await result.text();
      expect(text).toContain('REPLAY_UNAVAILABLE');
      expect(routes.holds('malformed-stream')).toBe(true);
    },
  );

  test.each(['acquire', 'exec', 'sweep'])(
    'unhealthy inner Docker recovers idle compute through the fenced claim on %s',
    async (operation) => {
      const routes = new SessionRoutes(
        { ...cfg, dockerInContainer: true },
        fakeBackend,
      );
      await routes.handleCreate(
        JSON.stringify({
          sessionId: 'docker-idle',
          organizationId: 'org_a',
          profile: 'agent',
        }),
      );
      fakeHealth.dockerReady = false;
      if (operation === 'sweep') expect(await routes.sweepExpired()).toBe(1);
      else {
        const result =
          operation === 'acquire'
            ? await routes.handleActivity('docker-idle', 'acquire')
            : await routes.handleExec(
                new Request('http://sandbox/exec'),
                'docker-idle',
                JSON.stringify({ execId: 'e-docker', command: ['true'] }),
              );
        expect(result.status).toBe(404);
      }
      expect(stopped.has('docker-idle')).toBe(true);
      expect(destroyed.has('docker-idle')).toBe(false);
      expect(execRequests).toHaveLength(0);
    },
  );

  test('Docker readiness returns not_found when its fenced idle stop discovers replacement', async () => {
    const routes = new SessionRoutes(
      { ...cfg, dockerInContainer: true },
      {
        ...fakeBackend,
        async stopSession(sessionId) {
          throw new SessionIncarnationChangedError(
            sessionId,
            'peer replaced compute',
          );
        },
      },
    );
    await routes.handleCreate(
      JSON.stringify({
        sessionId: 'docker-replaced',
        organizationId: 'org_a',
        profile: 'agent',
      }),
    );
    fakeHealth.dockerReady = false;
    const result = await routes.handleExec(
      new Request('http://sandbox/exec'),
      'docker-replaced',
      JSON.stringify({ execId: 'e-docker', command: ['true'] }),
    );
    expect(result.status).toBe(404);
    expect(routes.holds('docker-replaced')).toBe(false);
    expect(execRequests).toHaveLength(0);
    expect(destroyed.has('docker-replaced')).toBe(false);
  });

  test.each(['busy', 'pinned', 'acquired-race', 'legacy'])(
    'unhealthy inner Docker protects %s compute while refusing new work',
    async (state) => {
      const routes = new SessionRoutes(
        { ...cfg, dockerInContainer: true },
        fakeBackend,
      );
      await routes.handleCreate(
        JSON.stringify({
          sessionId: 'docker-protected',
          organizationId: 'org_a',
          profile: 'agent',
        }),
      );
      if (state === 'busy') fakeHealth.liveExecs = 1;
      if (state === 'pinned')
        await routes.handleSetPinned('docker-protected', '{"pinned":true}');
      if (state === 'legacy') legacyIdleReclaim = true;
      if (state === 'acquired-race')
        beforeReclaim = (_token, activity) => {
          activity.acquire();
        };
      fakeHealth.dockerReady = false;
      expect(
        (await routes.handleActivity('docker-protected', 'acquire')).status,
      ).toBe(503);
      expect(
        (
          await routes.handleExec(
            new Request('http://sandbox/exec'),
            'docker-protected',
            JSON.stringify({ execId: 'e-docker', command: ['true'] }),
          )
        ).status,
      ).toBe(503);
      expect(await routes.sweepExpired()).toBe(0);
      expect(stopped.has('docker-protected')).toBe(false);
      expect(destroyed.has('docker-protected')).toBe(false);
      expect(execRequests).toHaveLength(0);
    },
  );

  test.each([{ docker: 'false' }, { workload: 'bogus' }])(
    'rejects malformed capability fields at create: %j',
    async (invalid) => {
      const routes = new SessionRoutes(cfg, fakeBackend);
      const response = await routes.handleCreate(
        JSON.stringify({
          sessionId: 'invalid-capability',
          organizationId: 'org_caps',
          ...invalid,
        }),
      );
      expect(response.status).toBe(400);
      expect(created.size).toBe(0);
    },
  );

  test('staging preserves only a safe admission refusal as retryable busy', async () => {
    const routes = new SessionRoutes(cfg, fakeBackend);
    await routes.handleCreate(
      JSON.stringify({ sessionId: 'busy-stage', organizationId: 'org_stage' }),
    );
    stageFailure = 'busy';
    const busy = await routes.handleFilesStage('busy-stage', '{"files":[]}');
    expect(busy.status).toBe(503);
    expect(await busy.json()).toEqual({ error: 'busy' });
    expect(busy.headers.get('retry-after')).toBe('1');
    stageFailure = 'broken';
    expect(
      (await routes.handleFilesStage('busy-stage', '{"files":[]}')).status,
    ).toBe(502);
    expect(stageBodies).toHaveLength(0);
  });

  test('forwards source probes and bounded directory reconciliation with its compatibility marker', async () => {
    const routes = new SessionRoutes(cfg, fakeBackend);
    await routes.handleCreate(
      JSON.stringify({ sessionId: 'stage-probe', organizationId: 'org_stage' }),
    );
    const request = {
      files: [{ path: 'repo/README.md', sourceId: 'sha256:fixture' }],
      replaceRoots: ['skills'],
      keepPaths: ['skills/example/SKILL.md'],
    };
    const response = await routes.handleFilesStage(
      'stage-probe',
      JSON.stringify(request),
    );
    expect(stageBodies).toEqual([request]);
    expect(await response.json()).toMatchObject({ reconciled: true });
    expect(
      (
        await routes.handleFilesStage(
          'stage-probe',
          JSON.stringify({ files: [], replaceRoots: [42] }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await routes.handleFilesStage(
          'stage-probe',
          JSON.stringify({ files: [{ path: 'x', sourceId: 12 }] }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await routes.handleFilesStage(
          'stage-probe',
          JSON.stringify({ files: [{ path: 'missing-source' }] }),
        )
      ).status,
    ).toBe(400);
    expect(stageBodies.length).toBe(1);
  });
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

  test.each(['exec', 'attach'] as const)(
    'a replay gap stays distinct on the %s error wire',
    async (mode) => {
      const routes = new SessionRoutes(cfg, fakeBackend);
      await routes.handleCreate(
        JSON.stringify({ sessionId: 'gap-session', organizationId: 'org' }),
      );
      const request = new Request('http://x/exec');
      const response =
        mode === 'exec'
          ? await routes.handleExec(
              request,
              'gap-session',
              JSON.stringify({ execId: 'gap', command: ['true'] }),
            )
          : await routes.handleExecAttach(request, 'gap-session', 'gap');
      const { events } = await readSse(response);
      expect(
        events.find((event) => event.event === 'error')?.data,
      ).toMatchObject({
        code: 'REPLAY_UNAVAILABLE',
        message:
          'Exec output is no longer available from the requested cursor.',
      });
    },
  );

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
    expect(
      events.filter((event) =>
        ['replay-start', 'stdout', 'replay-complete'].includes(event.event),
      ),
    ).toEqual([
      { event: 'replay-start', data: {} },
      {
        event: 'stdout',
        data: {
          text: 'replayed',
          b64: Buffer.from('replayed').toString('base64'),
          seq: 1,
        },
      },
      { event: 'replay-complete', data: { throughSeq: 1 } },
      {
        event: 'stdout',
        data: {
          text: 'live',
          b64: Buffer.from('live').toString('base64'),
          seq: 2,
        },
      },
    ]);
  });

  test('stdio frames preserve exact bytes across split UTF-8 while collected output remains lossless', async () => {
    const routes = new SessionRoutes(cfg, fakeBackend);
    await routes.handleCreate(
      JSON.stringify({ sessionId: 'utf8-bytes', organizationId: 'org_text' }),
    );
    const response = await routes.handleExec(
      new Request('http://x'),
      'utf8-bytes',
      JSON.stringify({
        execId: 'split-text',
        command: ['echo', '__utf8_split__'],
      }),
    );
    const { events } = await readSse(response);
    const chunks = events
      .filter((event) => event.event === 'stdout')
      .map((event) => Buffer.from(String(event.data.b64), 'base64'));
    expect(chunks.map((chunk) => chunk.length)).toEqual([2, 2]);
    expect(Buffer.concat(chunks).toString()).toBe('🙂');
    expect(
      events.find((event) => event.event === 'result')?.data.stdoutBase64,
    ).toBe(Buffer.from('🙂').toString('base64'));
  });

  test.each(['start', 'attach'])(
    'replay storage failures on %s preserve their fatal SSE code before the compatibility result',
    async (mode) => {
      const routes = new SessionRoutes(cfg, fakeBackend);
      await routes.handleCreate(
        JSON.stringify({
          sessionId: 'replay-error',
          organizationId: 'org_replay',
        }),
      );
      const response =
        mode === 'start'
          ? await routes.handleExec(
              new Request('http://x'),
              'replay-error',
              JSON.stringify({
                execId: 'limit',
                command: ['echo', '__output_limit__'],
              }),
            )
          : await routes.handleExecAttach(
              new Request('http://x'),
              'replay-error',
              'replay-unavailable',
            );
      const { events } = await readSse(response);
      const failure = events.findIndex((event) => event.event === 'error');
      const result = events.findIndex((event) => event.event === 'result');
      expect(failure).toBeGreaterThanOrEqual(0);
      expect(result).toBeGreaterThan(failure);
      expect(events[failure]?.data.code).toBe(
        mode === 'start' ? 'OUTPUT_LIMIT' : 'REPLAY_UNAVAILABLE',
      );
      expect(events[result]?.data.status).toBe('failed');
    },
  );

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

  test.each([false, true])(
    'a failed durable pin to %s stays unpublished, protected, and retryable',
    async (pinned) => {
      let fail = false;
      const writes: Array<[boolean, number | undefined]> = [];
      const routes = new SessionRoutes(cfg, {
        ...fakeBackend,
        async setPinned(id, value, stamp) {
          writes.push([value, stamp]);
          if (fail) throw new Error('pin persistence unavailable');
          await fakeBackend.setPinned(id, value);
        },
      });
      await routes.handleCreate(
        JSON.stringify({ sessionId: 'pin-retry', organizationId: 'org_pin' }),
      );
      expect(
        (
          await routes.handleSetPinned(
            'pin-retry',
            JSON.stringify({ pinned: !pinned }),
          )
        ).status,
      ).toBe(200);
      fail = true;
      expect(
        (await routes.handleSetPinned('pin-retry', JSON.stringify({ pinned })))
          .status,
      ).toBe(503);
      expect(await (await routes.handleGet('pin-retry')).json()).toMatchObject({
        session: { pinned: !pinned },
      });
      expect(backendPins.get('pin-retry')).toBe(!pinned);
      expect(await routes.sweepExpired()).toBe(0);
      expect(stopped.has('pin-retry')).toBe(false);
      fail = false;
      expect(
        (await routes.handleSetPinned('pin-retry', JSON.stringify({ pinned })))
          .status,
      ).toBe(200);
      expect(await (await routes.handleGet('pin-retry')).json()).toMatchObject({
        session: { pinned },
      });
      expect(backendPins.get('pin-retry')).toBe(pinned);
      expect(writes.every(([, stamp]) => typeof stamp === 'number')).toBe(true);
    },
  );

  test('a failed durable pin protects a legacy daemon without publishing success', async () => {
    legacyDaemon = true;
    const routes = new SessionRoutes(cfg, {
      ...fakeBackend,
      async setPinned() {
        throw new Error('storage unavailable');
      },
    });
    await routes.handleCreate(
      JSON.stringify({ sessionId: 'legacy-pin', organizationId: 'org_pin' }),
    );
    expect(
      (await routes.handleSetPinned('legacy-pin', '{"pinned":true}')).status,
    ).toBe(503);
    expect(await (await routes.handleGet('legacy-pin')).json()).toMatchObject({
      session: { pinned: false },
    });
    expect(await routes.sweepExpired()).toBe(0);
  });

  test('a canceled pin whose two durable writes fail stays observably unsynchronized until retry succeeds', async () => {
    let fail = true;
    const routes = new SessionRoutes(cfg, {
      ...fakeBackend,
      async setPinned() {
        if (fail) throw new Error('pin persistence unavailable');
      },
    });
    await routes.handleCreate(
      JSON.stringify({ sessionId: 'canceled-pin', organizationId: 'org_pin' }),
    );
    for (const pinned of [true, false]) {
      expect(
        (
          await routes.handleSetPinned(
            'canceled-pin',
            JSON.stringify({ pinned }),
          )
        ).status,
      ).toBe(503);
      expect(
        await (await routes.handleGet('canceled-pin')).json(),
      ).toMatchObject({ session: { pinned: false, pinSynchronized: false } });
    }
    fail = false;
    expect(
      (await routes.handleSetPinned('canceled-pin', '{"pinned":false}')).status,
    ).toBe(200);
    expect(
      await (await routes.handleGet('canceled-pin')).json(),
    ).not.toMatchObject({ session: { pinSynchronized: false } });
  });

  test('a pin rejected by a peer replacement drops only its stale registry incarnation', async () => {
    const replacement = {
      ...mkBackendSession('pin-replaced', 'org_pin'),
      createdAtMs: 987654,
      pinned: false,
    };
    const routes = new SessionRoutes(cfg, {
      ...fakeBackend,
      async setPinned(id) {
        throw new SessionIncarnationChangedError(id, 'replaced');
      },
      async listSessions() {
        return [replacement];
      },
    });
    await routes.handleCreate(
      JSON.stringify({
        sessionId: replacement.sessionId,
        organizationId: 'org_pin',
      }),
    );
    expect(
      (await routes.handleSetPinned(replacement.sessionId, '{"pinned":true}'))
        .status,
    ).toBe(503);
    expect(
      await (await routes.handleGet(replacement.sessionId)).json(),
    ).toMatchObject({
      session: { createdAtMs: replacement.createdAtMs, pinned: false },
    });
    expect(destroyed.has(replacement.sessionId)).toBe(false);
  });

  test('pin writes are serialized, and destroy waits before removing their incarnation', async () => {
    const entered = Promise.withResolvers<void>();
    const finish = Promise.withResolvers<void>();
    const writes: boolean[] = [];
    const routes = new SessionRoutes(cfg, {
      ...fakeBackend,
      async setPinned(id, value) {
        writes.push(value);
        if (value) {
          entered.resolve();
          await finish.promise;
        }
        await fakeBackend.setPinned(id, value);
      },
    });
    await routes.handleCreate(
      JSON.stringify({ sessionId: 'pin-order', organizationId: 'org_pin' }),
    );
    const first = routes.handleSetPinned('pin-order', '{"pinned":true}');
    await entered.promise;
    const second = routes.handleSetPinned('pin-order', '{"pinned":false}');
    await Promise.resolve();
    expect(writes).toEqual([true]);
    const destroy = routes.handleDestroy('pin-order');
    expect(await settlesWithin(destroy, 5)).toBe(false);
    finish.resolve();
    expect((await first).status).toBe(200);
    // The queued toggle loses to the announced destroy; it cannot recreate its marker.
    expect((await second).status).toBe(503);
    expect((await destroy).status).toBe(200);
    expect(writes).toEqual([true]);
  });

  test('only an acknowledged true-to-false pin transition renews the TTL', async () => {
    const routes = new SessionRoutes(cfg, fakeBackend);
    await routes.handleCreate(
      JSON.stringify({ sessionId: 'pin-ttl', organizationId: 'org_pin' }),
    );
    const expiry = async () => {
      // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- fake route response asserted by this regression
      const response = (await (await routes.handleGet('pin-ttl')).json()) as {
        session: { expiresAtMs: number };
      };
      return response.session.expiresAtMs;
    };
    const original = await expiry();
    try {
      setSystemTime(Date.now() + 1000);
      await routes.handleSetPinned('pin-ttl', '{"pinned":false}');
      expect(await expiry()).toBe(original);
      await routes.handleSetPinned('pin-ttl', '{"pinned":true}');
      await routes.handleSetPinned('pin-ttl', '{"pinned":false}');
      const renewed = await expiry();
      expect(renewed).toBeGreaterThan(original);
      setSystemTime(Date.now() + 1000);
      await routes.handleSetPinned('pin-ttl', '{"pinned":false}');
      expect(await expiry()).toBe(renewed);
    } finally {
      setSystemTime();
    }
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
            ended: stopped.has('adopt-pinned'),
          },
          {
            ...mkBackendSession('adopt-plain', 'org_restart'),
            createdAtMs: ancient,
            state: stateOf('adopt-plain'),
            ended: stopped.has('adopt-plain'),
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
    test('a delayed dead probe cannot evict a replacement or join its liveness check', async () => {
      const started = Promise.withResolvers<void>();
      const answer = Promise.withResolvers<boolean>();
      let checks = 0;
      const routes = new SessionRoutes(cfg, {
        ...fakeBackend,
        async sessionExists() {
          checks += 1;
          if (checks === 1) {
            started.resolve();
            return answer.promise;
          }
          return true;
        },
      });
      const body = JSON.stringify({
        sessionId: 'probe-replacement',
        organizationId: 'org_z',
      });
      await routes.handleCreate(body);
      const oldProbe = routes.handleGet('probe-replacement');
      await started.promise;
      await routes.handleDestroy('probe-replacement');
      expect((await routes.handleCreate(body)).status).toBe(201);
      const newProbe = routes.handleGet('probe-replacement');
      await new Promise<void>((resolve) => setImmediate(resolve));
      const replacementChecks = checks;
      answer.resolve(false);
      const responses = await Promise.all([oldProbe, newProbe]);
      expect(replacementChecks).toBe(2);
      expect(responses.map((response) => response.status)).toEqual([200, 200]);
      expect(routes.holds('probe-replacement')).toBe(true);
      expect((await routes.handleGet('probe-replacement')).status).toBe(200);
      expect(checks).toBe(3);
    });

    test.each(['alive', 'unknown'])(
      'concurrent liveness checks share an in-flight %s answer but never cache it',
      async (outcome) => {
        const started = Promise.withResolvers<void>();
        const release = Promise.withResolvers<void>();
        let checks = 0;
        const routes = new SessionRoutes(cfg, {
          ...fakeBackend,
          async sessionExists() {
            checks += 1;
            started.resolve();
            await release.promise;
            if (outcome === 'unknown') throw new Error('temporary API failure');
            return true;
          },
        });
        await routes.handleCreate(
          JSON.stringify({
            sessionId: 'shared-probe',
            organizationId: 'org_z',
          }),
        );
        const requests = Array.from({ length: 16 }, () =>
          routes.handleGet('shared-probe'),
        );
        await started.promise;
        const simultaneousChecks = checks;
        release.resolve();
        const responses = await Promise.all(requests);
        expect(simultaneousChecks).toBe(1);
        expect(responses.every((response) => response.status === 200)).toBe(
          true,
        );
        expect(routes.holds('shared-probe')).toBe(true);
        expect((await routes.handleGet('shared-probe')).status).toBe(200);
        expect(checks).toBe(2);
      },
    );

    test('a stop that begins during a liveness probe keeps its capacity until compute is gone', async () => {
      const probeStarted = Promise.withResolvers<void>();
      const probeAnswer = Promise.withResolvers<boolean>();
      const stopStarted = Promise.withResolvers<void>();
      const stopRelease = Promise.withResolvers<void>();
      let checks = 0;
      const routes = new SessionRoutes(cfg, {
        ...fakeBackend,
        async sessionExists() {
          checks += 1;
          if (checks === 1) {
            probeStarted.resolve();
            return probeAnswer.promise;
          }
          return false;
        },
        async stopSession() {
          stopStarted.resolve();
          await stopRelease.promise;
          return true;
        },
      });
      await routes.handleCreate(
        JSON.stringify({ sessionId: 'probe-stop', organizationId: 'org_z' }),
      );
      const probe = routes.handleGet('probe-stop');
      await probeStarted.promise;
      const sweep = routes.sweepExpired(
        Date.now() + cfg.session.maxLifetimeMs + 1,
      );
      await stopStarted.promise;
      probeAnswer.resolve(false);
      const response = await probe;
      const heldDuringStop = routes.holds('probe-stop');
      stopRelease.resolve();
      await sweep;
      expect(response.status).toBe(200);
      expect(heldDuringStop).toBe(true);
      expect(routes.holds('probe-stop')).toBe(false);
    });

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
    describe('peer incarnation replacement', () => {
      function fixture(initialEndpoint = fakeBaseUrl) {
        let current: BackendSession = {
          ...mkBackendSession('peer-replaced', 'org_peer'),
          pinned: true,
          docker: true,
        };
        let listed: BackendSession | undefined;
        let endpoint = initialEndpoint;
        let draining = false;
        let memoryAvailable: number | null = null;
        const resolutions: Array<number | undefined> = [];
        const checks: Array<number | undefined> = [];
        const mutations: string[] = [];
        const backend: SessionBackend = {
          ...fakeBackend,
          async listSessions() {
            return [listed ?? current];
          },
          async resolveEndpoint(_id, expected) {
            resolutions.push(expected);
            if (expected !== undefined && expected !== current.createdAtMs)
              throw new SessionIncarnationChangedError(
                'peer-replaced',
                'test replacement',
              );
            return endpoint;
          },
          async sessionExists(_id, expected) {
            checks.push(expected);
            return expected === undefined || expected === current.createdAtMs;
          },
          async stopSession() {
            mutations.push('stop');
            return true;
          },
          async destroySession() {
            mutations.push('destroy');
            return true;
          },
        };
        const memory = () =>
          memoryAvailable === null
            ? null
            : {
                totalBytes: 16 * 1024 ** 3,
                availableBytes: memoryAvailable,
              };
        const routes = new SessionRoutes(cfg, backend, () => draining, {
          latest: memory,
          read: async () => memory(),
        });
        return {
          routes,
          backend,
          checks,
          resolutions,
          mutations,
          current: () => current,
          replace(nextEndpoint = fakeBaseUrl) {
            current = {
              ...current,
              createdAtMs: current.createdAtMs + 1000,
              pinned: false,
              docker: false,
            };
            endpoint = nextEndpoint;
          },
          list(value: BackendSession | undefined) {
            listed = value;
          },
          drain() {
            draining = true;
          },
          memoryAvailable(bytes: number) {
            memoryAvailable = bytes;
          },
        };
      }

      test.each(['ready', 'unready', 'failed'])(
        'exec ignores a replaced Docker readiness response: %s',
        async (state) => {
          const f = fixture('http://old-peer.invalid');
          await f.routes.adoptExisting();
          const started = Promise.withResolvers<void>();
          const answer = Promise.withResolvers<Response>();
          const realFetch = globalThis.fetch;
          let staleExecs = 0;
          const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(
            Object.assign(
              (...args: Parameters<typeof fetch>) => {
                const [input, init] = args;
                if (input === 'http://old-peer.invalid/healthz') {
                  started.resolve();
                  return answer.promise;
                }
                if (input === 'http://old-peer.invalid/execs') {
                  staleExecs += 1;
                  return realFetch(`${fakeBaseUrl}/execs`, init);
                }
                return realFetch(input, init);
              },
              { preconnect: realFetch.preconnect },
            ),
          );
          try {
            const pending = f.routes.handleExec(
              new Request('http://sandbox/exec'),
              'peer-replaced',
              JSON.stringify({ execId: 'stale-readiness', command: ['true'] }),
            );
            await started.promise;
            f.replace();
            await f.routes.adoptExisting();
            if (state === 'failed') answer.reject(new Error('old daemon gone'));
            else
              answer.resolve(
                Response.json({
                  ok: true,
                  bootedAtMs: 0,
                  lastActivityAtMs: 0,
                  liveExecs: 0,
                  dockerReady: state === 'ready',
                }),
              );
            const result = await pending;
            await result.text();
            expect(result.status).toBe(404);
            expect(staleExecs).toBe(0);
            expect(
              await (await f.routes.handleGet('peer-replaced')).json(),
            ).toMatchObject({ session: { createdAtMs: 2000, docker: false } });
            expect(f.mutations).toEqual([]);
          } finally {
            answer.resolve(Response.json({ ok: true }));
            fetchSpy.mockRestore();
          }
        },
      );

      test('exec rechecks its captured session after admission succeeds', async () => {
        const f = fixture();
        await f.routes.adoptExisting();
        f.memoryAvailable(16 * 1024 ** 3);
        const started = Promise.withResolvers<void>();
        const answer = Promise.withResolvers<Response>();
        const admission = spyOn(f.routes, 'handleActivity').mockImplementation(
          () => {
            started.resolve();
            return answer.promise;
          },
        );
        try {
          const pending = f.routes.handleExec(
            new Request('http://sandbox/exec'),
            'peer-replaced',
            JSON.stringify({ execId: 'stale-admission', command: ['true'] }),
          );
          await started.promise;
          f.replace();
          await f.routes.adoptExisting();
          answer.resolve(Response.json({ generation: 'old' }));
          const result = await pending;
          await result.text();
          expect(result.status).toBe(404);
          expect(execRequests).toHaveLength(0);
          expect(
            await (await f.routes.handleGet('peer-replaced')).json(),
          ).toMatchObject({ session: { createdAtMs: 2000, docker: false } });
          expect(f.mutations).toEqual([]);
        } finally {
          answer.resolve(Response.json({ generation: 'old' }));
          admission.mockRestore();
        }
      });

      test('periodic adoption refreshes the pinned incarnation and its endpoint without mutating compute', async () => {
        const f = fixture();
        let replacementCalls = 0;
        const replacement = Bun.serve({
          port: 0,
          fetch() {
            replacementCalls += 1;
            return Response.json({ ok: true });
          },
        });
        try {
          await f.routes.adoptExisting();
          f.replace(`http://127.0.0.1:${replacement.port}`);
          await f.routes.adoptExisting();
          expect(
            await (await f.routes.handleGet('peer-replaced')).json(),
          ).toMatchObject({
            session: { createdAtMs: 2000, pinned: false, docker: false },
          });
          expect(
            (
              await f.routes.handleEnvPatch(
                'peer-replaced',
                '{"set":{"A":"b"}}',
              )
            ).status,
          ).toBe(200);
          expect(replacementCalls).toBe(1);
          expect(f.resolutions).toEqual([1000, 2000]);
          expect(f.mutations).toEqual([]);
        } finally {
          await replacement.stop(true);
        }
      });

      test('GET evicts an old incarnation and the next lookup adopts its running replacement', async () => {
        const f = fixture();
        await f.routes.adoptExisting();
        f.replace();
        expect((await f.routes.handleGet('peer-replaced')).status).toBe(404);
        expect(
          await (await f.routes.handleGet('peer-replaced')).json(),
        ).toMatchObject({
          session: { createdAtMs: 2000, pinned: false, docker: false },
        });
        expect(f.checks).toEqual([1000, 2000]);
        expect(f.mutations).toEqual([]);
      });

      test('linger shutdown fences the held incarnation and never stops a peer replacement', async () => {
        const f = fixture();
        const fences: Array<number | undefined> = [];
        f.backend.stopSession = async (_id, stamp) => {
          fences.push(stamp);
          if (stamp !== undefined && stamp !== f.current().createdAtMs)
            throw new SessionIncarnationChangedError(
              'peer-replaced',
              'linger replacement',
            );
          f.mutations.push('stop');
          return true;
        };
        await f.routes.adoptExisting();
        f.replace();
        f.drain();
        expect(await f.routes.stopAllSessions()).toBe(0);
        expect(f.routes.holds('peer-replaced')).toBe(false);
        expect(fences).toEqual([1000]);
        expect(f.mutations).toEqual([]);
      });

      test('an older listing cannot borrow the replacement endpoint', async () => {
        const f = fixture();
        f.list(f.current());
        f.replace();
        const unavailable = await f.routes.handleGet('peer-replaced');
        expect(unavailable.status).toBe(503);
        expect(unavailable.headers.get('retry-after')).toBe('1');
        expect(await unavailable.json()).toEqual({
          error: 'session_unavailable',
        });
        expect(f.routes.holds('peer-replaced')).toBe(false);
        expect(f.resolutions).toEqual([1000]);
        f.list(undefined);
        expect((await f.routes.handleGet('peer-replaced')).status).toBe(200);
        expect(f.resolutions).toEqual([1000, 2000]);
        expect(f.mutations).toEqual([]);
      });

      test('an unknown replacement endpoint preserves the current entry until a verified retry', async () => {
        const f = fixture();
        await f.routes.adoptExisting();
        f.replace();
        const resolve = f.backend.resolveEndpoint.bind(f.backend);
        f.backend.resolveEndpoint = async () => {
          throw new Error('temporary API failure');
        };
        await f.routes.adoptExisting();
        expect(await f.routes.handleList(null).json()).toMatchObject({
          sessions: [{ createdAtMs: 1000, pinned: true, docker: true }],
        });
        f.backend.resolveEndpoint = resolve;
        await f.routes.adoptExisting();
        expect(await f.routes.handleList(null).json()).toMatchObject({
          sessions: [{ createdAtMs: 2000, pinned: false, docker: false }],
        });
        expect(f.mutations).toEqual([]);
      });

      test('a delayed old liveness answer cannot evict a periodically adopted replacement', async () => {
        const f = fixture();
        await f.routes.adoptExisting();
        const started = Promise.withResolvers<void>();
        const answer = Promise.withResolvers<boolean>();
        f.backend.sessionExists = async () => {
          started.resolve();
          return answer.promise;
        };
        const oldProbe = f.routes.handleGet('peer-replaced');
        await started.promise;
        f.replace();
        await f.routes.adoptExisting();
        answer.resolve(false);
        expect((await oldProbe).status).toBe(200);
        expect(await f.routes.handleList(null).json()).toMatchObject({
          sessions: [{ createdAtMs: 2000 }],
        });
        expect(f.mutations).toEqual([]);
      });

      test('an old release response cannot update the replacement bookkeeping', async () => {
        const f = fixture();
        f.replace('http://old-peer.invalid');
        await f.routes.adoptExisting();
        const started = Promise.withResolvers<void>();
        const released = Promise.withResolvers<Response>();
        const realFetch = globalThis.fetch;
        const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(
          Object.assign(
            (...args: Parameters<typeof fetch>) => {
              const [input, init] = args;
              if (input === 'http://old-peer.invalid/release') {
                started.resolve();
                return released.promise;
              }
              return realFetch(input, init);
            },
            { preconnect: realFetch.preconnect },
          ),
        );
        try {
          const release = f.routes.handleActivity(
            'peer-replaced',
            'release',
            '{"generation":"old"}',
          );
          await started.promise;
          f.replace();
          await f.routes.adoptExisting();
          released.resolve(Response.json({ released: true }));
          expect((await release).status).toBe(404);
          expect(await f.routes.handleList(null).json()).toMatchObject({
            sessions: [{ createdAtMs: 3000 }],
          });
          expect(f.mutations).toEqual([]);
        } finally {
          released.resolve(Response.json({ released: true }));
          fetchSpy.mockRestore();
        }
      });

      test.each(['liveness', 'health'])(
        'a legacy acquire awaiting %s cannot succeed for a destroyed and recreated session',
        async (boundary) => {
          const f = fixture();
          f.replace('http://old-peer.invalid');
          await f.routes.adoptExisting();
          const oldStamp = f.current().createdAtMs;
          const started = Promise.withResolvers<void>();
          const release = Promise.withResolvers<void>();
          let oldChecks = 0;
          let oldHealthCalls = 0;
          f.backend.sessionExists = async (_id, stamp) => {
            if (stamp === oldStamp) {
              oldChecks += 1;
              if (boundary === 'liveness' && oldChecks === 2) {
                started.resolve();
                await release.promise;
              }
            }
            return true;
          };
          const realFetch = globalThis.fetch;
          const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(
            Object.assign(
              async (...args: Parameters<typeof fetch>) => {
                const [input, init] = args;
                if (input === 'http://old-peer.invalid/acquire')
                  return new Response('unsupported', { status: 404 });
                if (input === 'http://old-peer.invalid/healthz') {
                  oldHealthCalls += 1;
                  if (boundary === 'health') {
                    started.resolve();
                    await release.promise;
                  }
                  return Response.json({
                    ok: true,
                    bootedAtMs: 0,
                    lastActivityAtMs: 0,
                    liveExecs: 0,
                  });
                }
                return realFetch(input, init);
              },
              { preconnect: realFetch.preconnect },
            ),
          );
          const acquiring = f.routes.handleActivity('peer-replaced', 'acquire');
          try {
            await started.promise;
            expect((await f.routes.handleDestroy('peer-replaced')).status).toBe(
              200,
            );
            f.replace();
            expect(
              (
                await f.routes.handleCreate(
                  JSON.stringify({
                    sessionId: 'peer-replaced',
                    organizationId: 'org_peer',
                  }),
                )
              ).status,
            ).toBe(201);
            const replacement = await f.routes.handleList(null).text();
            release.resolve();
            const stale = await acquiring;
            expect(stale.status).toBe(404);
            expect(await stale.json()).toEqual({ error: 'not_found' });
            expect(await f.routes.handleList(null).text()).toBe(replacement);
            const current = await f.routes.handleActivity(
              'peer-replaced',
              'acquire',
            );
            expect(current.status).toBe(200);
            expect(await current.json()).not.toEqual({ generation: 'legacy' });
            expect(oldHealthCalls).toBe(boundary === 'health' ? 1 : 0);
            expect(f.mutations).toEqual(['destroy']);
          } finally {
            release.resolve();
            await acquiring;
            fetchSpy.mockRestore();
          }
        },
      );

      test.each(['before', 'during'])(
        'a drain %s endpoint resolution preserves the old owned entry',
        async (when) => {
          const f = fixture();
          await f.routes.adoptExisting();
          f.replace();
          const started = Promise.withResolvers<void>();
          const release = Promise.withResolvers<void>();
          const resolve = f.backend.resolveEndpoint.bind(f.backend);
          f.backend.resolveEndpoint = async (...args) => {
            started.resolve();
            await release.promise;
            return resolve(...args);
          };
          if (when === 'before') f.drain();
          const refresh = f.routes.adoptExisting();
          if (when === 'during') {
            await started.promise;
            f.drain();
          }
          release.resolve();
          await refresh;
          expect(await f.routes.handleList(null).json()).toMatchObject({
            sessions: [{ createdAtMs: 1000, pinned: true }],
          });
          expect(f.mutations).toEqual([]);
        },
      );

      test('a stop beginning during endpoint resolution retains its ownership until settlement', async () => {
        const f = fixture();
        f.replace();
        await f.routes.adoptExisting();
        f.replace();
        const resolveStarted = Promise.withResolvers<void>();
        const resolveRelease = Promise.withResolvers<void>();
        const stopStarted = Promise.withResolvers<void>();
        const stopRelease = Promise.withResolvers<void>();
        const resolve = f.backend.resolveEndpoint.bind(f.backend);
        f.backend.resolveEndpoint = async (...args) => {
          resolveStarted.resolve();
          await resolveRelease.promise;
          return resolve(...args);
        };
        f.backend.stopSession = async () => {
          stopStarted.resolve();
          await stopRelease.promise;
          throw new SessionIncarnationChangedError(
            'peer-replaced',
            'peer replaced compute',
          );
        };
        const refresh = f.routes.adoptExisting();
        await resolveStarted.promise;
        const stopping = f.routes.sweepExpired(
          Date.now() + cfg.session.maxLifetimeMs + 1,
        );
        await stopStarted.promise;
        resolveRelease.resolve();
        await refresh;
        await f.routes.adoptExisting();
        expect(await f.routes.handleList(null).json()).toMatchObject({
          sessions: [{ createdAtMs: 2000 }],
        });
        expect(f.resolutions).toEqual([2000, 3000]);
        stopRelease.resolve();
        await stopping;
        await f.routes.adoptExisting();
        expect(await f.routes.handleList(null).json()).toMatchObject({
          sessions: [{ createdAtMs: 3000 }],
        });
        expect(f.mutations).toEqual([]);
      });

      test('a pending endpoint refresh cannot overwrite a local destroy and recreate', async () => {
        const f = fixture();
        await f.routes.adoptExisting();
        f.replace();
        const started = Promise.withResolvers<void>();
        const release = Promise.withResolvers<void>();
        const resolve = f.backend.resolveEndpoint.bind(f.backend);
        f.backend.resolveEndpoint = async (id, stamp) => {
          if (stamp !== undefined) {
            started.resolve();
            await release.promise;
          }
          return resolve(id, stamp);
        };
        const refresh = f.routes.adoptExisting();
        await started.promise;
        await f.routes.handleDestroy('peer-replaced');
        expect(
          (
            await f.routes.handleCreate(
              JSON.stringify({
                sessionId: 'peer-replaced',
                organizationId: 'org_peer',
              }),
            )
          ).status,
        ).toBe(201);
        const replacement = await f.routes.handleList(null).text();
        release.resolve();
        await refresh;
        expect(await f.routes.handleList(null).text()).toBe(replacement);
        expect(f.mutations).toEqual(['destroy']);
      });

      test('an old pin failure cannot clear the successor admission reservation', async () => {
        const f = fixture();
        await f.routes.adoptExisting();
        const started = Promise.withResolvers<void>();
        const release = Promise.withResolvers<void>();
        f.backend.setPinned = async () => {
          started.resolve();
          await release.promise;
          throw new SessionIncarnationChangedError(
            'peer-replaced',
            'old pin settled',
          );
        };
        const pinning = f.routes.handleSetPinned(
          'peer-replaced',
          '{"pinned":false}',
        );
        await started.promise;
        f.replace();
        expect((await f.routes.handleGet('peer-replaced')).status).toBe(404);
        expect((await f.routes.handleGet('peer-replaced')).status).toBe(200);
        f.memoryAvailable(16 * 1024 ** 3);
        expect(
          (await f.routes.handleActivity('peer-replaced', 'acquire')).status,
        ).toBe(200);
        f.memoryAvailable(0);
        release.resolve();
        expect((await pinning).status).toBe(503);
        // The new generation was already admitted: old failure cleanup must
        // not make its idempotent acquire compete again under memory pressure.
        expect(
          (await f.routes.handleActivity('peer-replaced', 'acquire')).status,
        ).toBe(200);
        expect(f.mutations).toEqual([]);
      });

      test('an old exec completion cannot unregister the same exec id on its replacement', async () => {
        const f = fixture();
        f.replace('http://old-peer.invalid');
        await f.routes.adoptExisting();
        const started = Promise.withResolvers<void>();
        const completed = Promise.withResolvers<Response>();
        const realFetch = globalThis.fetch;
        const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(
          Object.assign(
            (...args: Parameters<typeof fetch>) => {
              const [input, init] = args;
              if (input === 'http://old-peer.invalid/execs') {
                started.resolve();
                return completed.promise;
              }
              return realFetch(input, init);
            },
            { preconnect: realFetch.preconnect },
          ),
        );
        const newRequest = new AbortController();
        try {
          const body = JSON.stringify({
            execId: 'hang-peer',
            command: ['sleep', '60'],
          });
          const oldExec = await f.routes.handleExec(
            new Request('http://x'),
            'peer-replaced',
            body,
          );
          await started.promise;
          f.replace();
          await f.routes.adoptExisting();
          const newExec = await f.routes.handleExec(
            new Request('http://x', { signal: newRequest.signal }),
            'peer-replaced',
            body,
          );
          const reader = newExec.body!.getReader();
          await reader.read();
          completed.resolve(
            new Response(
              ndjson([
                {
                  t: 'exit',
                  exitCode: 0,
                  durationMs: 1,
                  truncated: { stdout: false, stderr: false },
                  timedOut: false,
                  cancelled: false,
                },
              ]),
            ),
          );
          await readSse(oldExec);
          expect(
            await f.routes.sweepExpired(
              Date.now() + cfg.session.maxLifetimeMs + 1,
            ),
          ).toBe(0);
          expect(f.mutations).toEqual([]);
          newRequest.abort();
          await reader.cancel();
        } finally {
          completed.resolve(new Response(''));
          newRequest.abort();
          fetchSpy.mockRestore();
        }
      });

      test('an old sweep health response cannot stop or mark the replacement', async () => {
        const f = fixture();
        f.replace('http://old-peer.invalid');
        await f.routes.adoptExisting();
        const started = Promise.withResolvers<void>();
        const health = Promise.withResolvers<Response>();
        const realFetch = globalThis.fetch;
        const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(
          Object.assign(
            (...args: Parameters<typeof fetch>) => {
              const [input, init] = args;
              if (input === 'http://old-peer.invalid/healthz') {
                started.resolve();
                return health.promise;
              }
              return realFetch(input, init);
            },
            { preconnect: realFetch.preconnect },
          ),
        );
        try {
          const sweep = f.routes.sweepExpired(
            Date.now() + cfg.session.maxLifetimeMs + 1,
          );
          await started.promise;
          f.replace();
          await f.routes.adoptExisting();
          health.resolve(Response.json({ liveExecs: 0, lastActivityAtMs: 0 }));
          expect(await sweep).toBe(0);
          expect(await f.routes.handleList(null).json()).toMatchObject({
            sessions: [{ createdAtMs: 3000 }],
          });
          expect(f.mutations).toEqual([]);
        } finally {
          health.resolve(Response.json({ liveExecs: 0, lastActivityAtMs: 0 }));
          fetchSpy.mockRestore();
        }
      });
    });

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

    test('adoptExisting resolves endpoints eight at a time and retries only the failed session', async () => {
      const listed = Array.from({ length: 18 }, (_, index) =>
        mkBackendSession(`parallel-adopt-${index}`, 'org_adopt'),
      );
      const release = Promise.withResolvers<void>();
      const firstWave = Promise.withResolvers<void>();
      const calls = new Map<string, number>();
      let resolving = 0;
      let peak = 0;
      let failOne = true;
      const routes = new SessionRoutes(cfg, {
        ...fakeBackend,
        async listSessions() {
          // A duplicate row must never occupy a second resolution lane.
          return [...listed, listed[0]!, listed[9]!];
        },
        async resolveEndpoint(id) {
          calls.set(id, (calls.get(id) ?? 0) + 1);
          resolving += 1;
          peak = Math.max(peak, resolving);
          if (resolving === 8) firstWave.resolve();
          try {
            await release.promise;
            if (id === 'parallel-adopt-9' && failOne) {
              throw new Error('pod endpoint temporarily unavailable');
            }
            return fakeBaseUrl;
          } finally {
            resolving -= 1;
          }
        },
      });
      const adoption = routes.adoptExisting();
      try {
        expect(await settlesWithin(firstWave.promise, 1_000)).toBe(true);
        expect(calls.size).toBe(8);
        expect(resolving).toBe(8);
      } finally {
        release.resolve();
        await adoption;
      }
      expect(peak).toBe(8);
      expect(routes.sessionCount()).toBe(17);
      expect(routes.holds('parallel-adopt-9')).toBe(false);
      expect([...calls.values()]).toEqual(Array.from({ length: 18 }, () => 1));
      failOne = false;
      await routes.adoptExisting();
      expect(routes.sessionCount()).toBe(18);
      expect(calls.get('parallel-adopt-9')).toBe(2);
      expect(calls.get('parallel-adopt-0')).toBe(1);
    });

    test('a drain during adoption skips waiting candidates and cannot claim resolved peer sessions', async () => {
      const listed = Array.from({ length: 18 }, (_, index) =>
        mkBackendSession(`drain-peer-${index}`, 'org_peer'),
      );
      const firstWave = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const resolved: string[] = [];
      let draining = false;
      const routes = new SessionRoutes(
        cfg,
        {
          ...fakeBackend,
          async listSessions() {
            return listed;
          },
          async resolveEndpoint(id) {
            if (id === 'drain-owned') return fakeBaseUrl;
            resolved.push(id);
            if (resolved.length === 8) firstWave.resolve();
            await release.promise;
            return fakeBaseUrl;
          },
        },
        () => draining,
      );
      expect(
        (
          await routes.handleCreate(
            JSON.stringify({
              sessionId: 'drain-owned',
              organizationId: 'org_owned',
            }),
          )
        ).status,
      ).toBe(201);
      const adoption = routes.adoptExisting();
      try {
        expect(await settlesWithin(firstWave.promise, 1_000)).toBe(true);
        draining = true;
      } finally {
        release.resolve();
        await adoption;
      }
      expect(resolved).toHaveLength(8);
      expect(routes.sessionIds()).toEqual(['drain-owned']);
      expect((await routes.handleGet('drain-owned')).status).toBe(200);
      expect(await routes.stopAllSessions()).toBe(1);
      expect([...stopped]).toEqual(['drain-owned']);
    });

    test.each(['get', 'pin'])(
      'a %s miss whose endpoint resolves after drain begins cannot adopt a peer',
      async (action) => {
        const started = Promise.withResolvers<void>();
        const release = Promise.withResolvers<void>();
        let draining = false;
        const routes = new SessionRoutes(
          cfg,
          {
            ...fakeBackend,
            async listSessions() {
              return [mkBackendSession('drain-route-peer', 'org_peer')];
            },
            async resolveEndpoint() {
              started.resolve();
              await release.promise;
              return fakeBaseUrl;
            },
          },
          () => draining,
        );
        const request =
          action === 'get'
            ? routes.handleGet('drain-route-peer')
            : routes.handleSetPinned('drain-route-peer', '{"pinned":true}');
        await started.promise;
        draining = true;
        release.resolve();
        expect((await request).status).toBe(404);
        expect(routes.sessionIds()).toEqual([]);
        expect(backendPins.has('drain-route-peer')).toBe(false);
        expect(await routes.stopAllSessions()).toBe(0);
        expect(stopped.has('drain-route-peer')).toBe(false);
      },
    );

    test('an adoption resolution cannot overwrite a session created while it awaited', async () => {
      const started = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      let first = true;
      const routes = new SessionRoutes(cfg, {
        ...fakeBackend,
        async listSessions() {
          return [mkBackendSession('adopt-created-race', 'org_adopt')];
        },
        async resolveEndpoint() {
          if (first) {
            first = false;
            started.resolve();
            await release.promise;
          }
          return fakeBaseUrl;
        },
      });
      const adoption = routes.adoptExisting();
      await started.promise;
      try {
        expect(
          (
            await routes.handleCreate(
              JSON.stringify({
                sessionId: 'adopt-created-race',
                organizationId: 'org_create',
              }),
            )
          ).status,
        ).toBe(201);
      } finally {
        release.resolve();
        await adoption;
      }
      expect(routes.sessionCount()).toBe(1);
      expect(
        await (await routes.handleGet('adopt-created-race')).json(),
      ).toMatchObject({ session: { organizationId: 'org_create' } });
    });

    test('an adoption resolution leaves an id to a create still in flight', async () => {
      const resolveStarted = Promise.withResolvers<void>();
      const releaseResolve = Promise.withResolvers<void>();
      const createStarted = Promise.withResolvers<void>();
      const releaseCreate = Promise.withResolvers<void>();
      const routes = new SessionRoutes(cfg, {
        ...fakeBackend,
        async listSessions() {
          return [mkBackendSession('adopt-pending-race', 'org_adopt')];
        },
        async resolveEndpoint() {
          resolveStarted.resolve();
          await releaseResolve.promise;
          return fakeBaseUrl;
        },
        async createSession(spec) {
          createStarted.resolve();
          await releaseCreate.promise;
          return fakeBackend.createSession(spec);
        },
      });
      const adoption = routes.adoptExisting();
      await resolveStarted.promise;
      const creating = routes.handleCreate(
        JSON.stringify({
          sessionId: 'adopt-pending-race',
          organizationId: 'org_create',
        }),
      );
      await createStarted.promise;
      try {
        releaseResolve.resolve();
        await adoption;
        expect(routes.sessionCount()).toBe(0);
        expect(routes.holds('adopt-pending-race')).toBe(true);
      } finally {
        releaseCreate.resolve();
        await creating;
      }
      expect(routes.sessionCount()).toBe(1);
      expect(
        await (await routes.handleGet('adopt-pending-race')).json(),
      ).toMatchObject({ session: { organizationId: 'org_create' } });
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

      test.each(['ready', 'failed'])(
        'same-incarnation misses share an in-flight %s endpoint resolution',
        async (outcome) => {
          const resolveStarted = Promise.withResolvers<void>();
          const release = Promise.withResolvers<void>();
          let resolutions = 0;
          let lists = 0;
          let fail = outcome === 'failed';
          const entry = mkBackendSession('shared-endpoint', 'org_peer');
          const routes = new SessionRoutes(cfg, {
            ...fakeBackend,
            async listSessions() {
              lists += 1;
              return [entry];
            },
            async resolveEndpoint() {
              resolutions += 1;
              resolveStarted.resolve();
              await release.promise;
              if (fail) throw new Error('temporary endpoint failure');
              return fakeBaseUrl;
            },
          });
          const requests = Array.from({ length: 16 }, () =>
            routes.handleGet(entry.sessionId),
          );
          await resolveStarted.promise;
          await new Promise<void>((resolve) => setImmediate(resolve));
          const simultaneousResolutions = resolutions;
          release.resolve();
          const responses = await Promise.all(requests);
          expect(lists).toBe(2);
          expect(simultaneousResolutions).toBe(1);
          expect(
            responses.every(
              (response) => response.status === (fail ? 503 : 200),
            ),
          ).toBe(true);
          if (fail) {
            for (const response of responses) {
              expect(response.headers.get('retry-after')).toBe('1');
              expect(await response.json()).toEqual({
                error: 'session_unavailable',
              });
            }
            fail = false;
            expect((await routes.handleGet(entry.sessionId)).status).toBe(200);
            expect(resolutions).toBe(2);
          }
        },
      );

      test('a newer listed incarnation resolves separately from an older in-flight adoption', async () => {
        const oldStarted = Promise.withResolvers<void>();
        const oldRelease = Promise.withResolvers<void>();
        let resolutions = 0;
        let entry = mkBackendSession('new-endpoint', 'org_peer');
        const routes = new SessionRoutes(cfg, {
          ...fakeBackend,
          async listSessions() {
            return [entry];
          },
          async resolveEndpoint() {
            resolutions += 1;
            if (resolutions === 1) {
              oldStarted.resolve();
              await oldRelease.promise;
            }
            return fakeBaseUrl;
          },
        });
        const older = routes.handleGet(entry.sessionId);
        await oldStarted.promise;
        entry = { ...entry, createdAtMs: entry.createdAtMs + 1 };
        const newer = routes.handleGet(entry.sessionId);
        await new Promise<void>((resolve) => setImmediate(resolve));
        const simultaneousResolutions = resolutions;
        oldRelease.resolve();
        const responses = await Promise.all([older, newer]);
        expect(simultaneousResolutions).toBe(2);
        for (const response of responses) {
          expect(await response.json()).toMatchObject({
            session: { createdAtMs: entry.createdAtMs },
          });
        }
      });

      test('an old endpoint failure cannot clear a newer incarnation resolution still in flight', async () => {
        const oldStarted = Promise.withResolvers<void>();
        const oldRelease = Promise.withResolvers<void>();
        const newStarted = Promise.withResolvers<void>();
        const newRelease = Promise.withResolvers<void>();
        let resolutions = 0;
        let entry = mkBackendSession('pending-endpoint', 'org_peer');
        const routes = new SessionRoutes(cfg, {
          ...fakeBackend,
          async listSessions() {
            return [entry];
          },
          async resolveEndpoint() {
            resolutions += 1;
            if (resolutions === 1) {
              oldStarted.resolve();
              await oldRelease.promise;
              throw new Error('old Pod disappeared');
            }
            newStarted.resolve();
            await newRelease.promise;
            return fakeBaseUrl;
          },
        });
        const older = routes.handleGet(entry.sessionId);
        await oldStarted.promise;
        entry = { ...entry, createdAtMs: entry.createdAtMs + 1 };
        const newer = routes.handleGet(entry.sessionId);
        await newStarted.promise;
        oldRelease.resolve();
        const unavailable = await older;
        expect(unavailable.status).toBe(503);
        expect(unavailable.headers.get('retry-after')).toBe('1');
        expect(await unavailable.json()).toEqual({
          error: 'session_unavailable',
        });
        const joining = routes.handleGet(entry.sessionId);
        await new Promise<void>((resolve) => setImmediate(resolve));
        const simultaneousResolutions = resolutions;
        newRelease.resolve();
        const responses = await Promise.all([newer, joining]);
        expect(simultaneousResolutions).toBe(2);
        expect(responses.map((response) => response.status)).toEqual([
          200, 200,
        ]);
      });

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
            ended: true,
          }),
        );
        expect((await routes.handleGet('stopped1')).status).toBe(404);
        expect((await routes.handleExecStatus('stopped1', 'e1')).status).toBe(
          404,
        );
      });

      test('a failed backend list answers retryable without registering anything', async () => {
        const failing: SessionBackend = {
          ...fakeBackend,
          async listSessions(): Promise<BackendSession[]> {
            throw new Error('docker ps failed');
          },
        };
        const routes = new SessionRoutes(cfg, failing);
        expect((await routes.handleGet('nope')).status).toBe(503);
        expect(routes.sessionCount()).toBe(0);
      });

      test('an unresolvable endpoint is logged and left for a later retry, not registered', async () => {
        const routes = new SessionRoutes(
          cfg,
          peerBackend(mkBackendSession('unaddressable-peer', 'org_peer')),
        );
        expect((await routes.handleGet('unaddressable-peer')).status).toBe(503);
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

  test('a pinned session whose backend died gives back capacity without destroying its workspace', async () => {
    const routes = new SessionRoutes(
      { ...cfg, session: { ...cfg.session, maxSessions: 1 } },
      fakeBackend,
    );
    await create(routes, 'pinned-dead');
    await routes.handleSetPinned(
      'pinned-dead',
      JSON.stringify({ pinned: true }),
    );
    backendGone.add('pinned-dead');
    await routes.maintain();
    expect(routes.sessionCount()).toBe(0);
    expect((await create(routes, 'after-pinned-death')).status).toBe(201);
    expect(destroyed.has('pinned-dead')).toBe(false);
  });

  test('nonterminal unregistered backend objects occupy capacity after restart', async () => {
    const routes = new SessionRoutes(
      { ...cfg, session: { ...cfg.session, maxSessions: 1 } },
      {
        ...fakeBackend,
        kind: 'kubernetes',
        async listSessions() {
          return [
            {
              ...mkBackendSession('pending-peer', 'org_hygiene'),
              state: 'degraded' as const,
              ended: false,
            },
          ];
        },
      },
    );
    await routes.maintain();
    expect((await create(routes, 'would-overfill')).status).toBe(429);
    expect(stopped.has('pending-peer')).toBe(false);
    const sameId = await create(routes, 'pending-peer');
    expect(sameId.status).toBe(429);
    expect(await sameId.json()).toMatchObject({ error: 'busy' });
    expect(created.has('pending-peer')).toBe(false);
  });

  test('pending recovery frees capacity only after the backend confirms its compute is gone', async () => {
    const removal = Promise.withResolvers<boolean>();
    const pending = {
      ...mkBackendSession('abandoned-pending', 'org_hygiene'),
      state: 'degraded' as const,
      ended: false,
    };
    const reaped: Array<[string, number]> = [];
    let present = true;
    const routes = new SessionRoutes(
      { ...cfg, session: { ...cfg.session, maxSessions: 1 } },
      {
        ...fakeBackend,
        kind: 'kubernetes',
        async listSessions() {
          return present ? [pending] : [];
        },
        async reapStaleSession(id, stamp) {
          reaped.push([id, stamp]);
          const removed = await removal.promise;
          if (removed) present = false;
          return removed;
        },
      },
    );
    await routes.maintain();
    expect(reaped).toEqual([[pending.sessionId, pending.createdAtMs]]);
    expect((await create(routes, 'after-pending')).status).toBe(429);
    removal.resolve(true);
    await routes.endedReapSettled();
    expect((await create(routes, 'after-pending')).status).toBe(201);
    expect(destroyed.has(pending.sessionId)).toBe(false);
  });

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

  test('the build-cache reconcile after adoption excludes render and opted-out agents and never holds adoption up', async () => {
    const gate = Promise.withResolvers<void>();
    const reconciled: string[][] = [];
    const routes = new SessionRoutes(cfg, {
      ...fakeBackend,
      async listSessions(): Promise<BackendSession[]> {
        return [
          mkBackendSession('builder-1', 'org_build'),
          { ...mkBackendSession('light-agent', 'org_light'), docker: false },
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
    const createdAtMs = Date.now();
    const routes = new SessionRoutes(cfg, {
      ...fakeBackend,
      async listSessions(): Promise<BackendSession[]> {
        lists += 1;
        return [
          {
            ...mkBackendSession('slow-cache-1', 'org_slow_cache'),
            createdAtMs,
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

  test.each([
    ['idle', 'acquire'],
    ['idle', 'touch'],
    ['lifetime', 'acquire'],
    ['lifetime', 'touch'],
  ])(
    '%s expiry yields to a %s after its health snapshot',
    async (expiry, work) => {
      const routes = new SessionRoutes(
        expiry === 'lifetime'
          ? { ...cfg, session: { ...cfg.session, maxLifetimeMs: 1 } }
          : cfg,
        fakeBackend,
      );
      const id = `expiry-${expiry}-${work}`;
      await create(routes, id);
      const now = Date.now() + 10_000;
      beforeReclaim = (token, activity) => {
        if (work === 'acquire') activity.acquire();
        else {
          const finish = activity.enter();
          daemonLastActivity.set(token, now);
          finish?.();
        }
      };
      expect(await routes.sweepExpired(now)).toBe(0);
      expect(stopped.has(id)).toBe(false);
      expect(routes.holds(id)).toBe(true);
      expect(reclaimRequests).toEqual([
        {
          idleBeforeMs:
            expiry === 'lifetime' ? now - 1 : now - cfg.session.maxIdleMs,
        },
      ]);
      beforeReclaim = null;
      const later =
        expiry === 'lifetime' ? now + 1 : now + cfg.session.maxIdleMs + 1;
      expect(await routes.sweepExpired(later)).toBe(1);
      expect(stopped.has(id)).toBe(true);
      expect(destroyed.has(id)).toBe(false);
    },
  );

  test('a daemon without idle-claim capability keeps legacy expiry without a force claim', async () => {
    legacyIdleReclaim = true;
    const routes = new SessionRoutes(cfg, fakeBackend);
    await create(routes, 'legacy-idle');
    expect(await routes.sweepExpired()).toBe(1);
    expect(stopped.has('legacy-idle')).toBe(true);
    expect(destroyed.has('legacy-idle')).toBe(false);
    expect(reclaimRequests).toEqual([]);
  });

  test('a peer pin reported by a legacy idle daemon still prevents expiry', async () => {
    legacyIdleReclaim = true;
    const routes = new SessionRoutes(cfg, fakeBackend);
    await create(routes, 'legacy-peer-pin');
    await routes.handleActivity('legacy-peer-pin', 'ticket');
    expect(
      fakeActivities.get(tokenOf('legacy-peer-pin'))?.setPinned(true),
    ).toBe(true);
    expect(await routes.sweepExpired()).toBe(0);
    expect(stopped.has('legacy-peer-pin')).toBe(false);
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

  test.each(['exec', 'attach'])(
    'cancelling the %s response detaches its upstream read and releases the request listener',
    async (lane) => {
      const cancelsBefore = cancelRequests.length;
      let existsChecks = 0;
      const routes = new SessionRoutes(cfg, {
        ...fakeBackend,
        async sessionExists(sessionId: string) {
          existsChecks += 1;
          return fakeBackend.sessionExists(sessionId);
        },
      });
      await create(routes, `cancel-${lane}`);
      existsChecks = 0;
      const request = new Request('http://spawner/exec', { method: 'POST' });
      const response =
        lane === 'exec'
          ? await routes.handleExec(
              request,
              `cancel-${lane}`,
              JSON.stringify({
                execId: 'hang-cancel',
                command: ['echo', 'live'],
              }),
            )
          : await routes.handleExecAttach(
              request,
              `cancel-${lane}`,
              'hang-cancel',
            );
      const reader = response.body?.getReader();
      await reader?.read();
      expect(getEventListeners(request.signal, 'abort')).toHaveLength(1);
      await reader?.cancel();
      const deadline = Date.now() + 1000;
      while (
        getEventListeners(request.signal, 'abort').length > 0 &&
        Date.now() < deadline
      ) {
        await Bun.sleep(10);
      }
      expect(getEventListeners(request.signal, 'abort')).toHaveLength(0);
      expect(request.signal.aborted).toBe(false);
      expect(existsChecks).toBe(0);
      expect(cancelRequests).toHaveLength(cancelsBefore);
    },
  );
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

  const release = async (routes: SessionRoutes, id: string) => {
    const ticket: unknown = await (
      await routes.handleActivity(id, 'ticket')
    ).json();
    return routes.handleActivity(id, 'release', JSON.stringify(ticket));
  };

  test('a warm released session waits for memory before acquiring without losing its workspace', async () => {
    let available = 8;
    const routes = new SessionRoutes(
      cfg,
      fakeBackend,
      undefined,
      host(() => available),
    );
    await create(routes, 'warm-acquire');
    await release(routes, 'warm-acquire');
    available = 2;
    const refused = await routes.handleActivity('warm-acquire', 'acquire');
    expect(refused.status).toBe(429);
    expect(await refused.json()).toMatchObject({
      error: 'host_memory',
      queue: { position: 0, waiting: 1 },
    });
    expect(stopped.has('warm-acquire')).toBe(false);
    expect(destroyed.has('warm-acquire')).toBe(false);
    available = 8;
    expect(
      (await routes.handleActivity('warm-acquire', 'acquire')).status,
    ).toBe(200);
  });

  test('warm activations reserve memory once, stale releases cannot give it back, and current releases can', async () => {
    let available = 8;
    const routes = new SessionRoutes(
      cfg,
      fakeBackend,
      undefined,
      host(() => available),
    );
    for (const id of ['warm-a', 'warm-b']) {
      await create(routes, id);
      await release(routes, id);
    }
    const oldTicket: unknown = await (
      await routes.handleActivity('warm-a', 'ticket')
    ).json();
    // Only one 512 MiB activation fits beside the 1.6 GiB reserve.
    available = 2.2;
    const first = await routes.handleActivity('warm-a', 'acquire');
    expect(first.status).toBe(200);
    expect((await routes.handleActivity('warm-a', 'acquire')).status).toBe(200);
    expect(
      await (
        await routes.handleActivity(
          'warm-a',
          'release',
          JSON.stringify(oldTicket),
        )
      ).json(),
    ).toEqual({ released: false });
    expect((await routes.handleActivity('warm-b', 'acquire')).status).toBe(429);
    await release(routes, 'warm-a');
    expect((await routes.handleActivity('warm-b', 'acquire')).status).toBe(200);
  });

  test('concurrent acquires of one released session share its activation reservation', async () => {
    let available = 8;
    const routes = new SessionRoutes(
      cfg,
      fakeBackend,
      undefined,
      host(() => available),
    );
    await create(routes, 'shared-activation');
    await release(routes, 'shared-activation');
    available = 2.2;
    const responses = await Promise.all(
      Array.from({ length: 4 }, () =>
        routes.handleActivity('shared-activation', 'acquire'),
      ),
    );
    expect(responses.map((response) => response.status)).toEqual([
      200, 200, 200, 200,
    ]);
  });

  test('direct exec of idle warm compute shares activation admission and the current turn keeps its reservation', async () => {
    let available = 8;
    const routes = new SessionRoutes(
      cfg,
      fakeBackend,
      undefined,
      host(() => available),
    );
    await create(routes, 'direct-warm');
    await release(routes, 'direct-warm');
    const exec = () =>
      routes.handleExec(
        new Request('http://x'),
        'direct-warm',
        JSON.stringify({ execId: 'direct-exec', command: ['echo', 'ok'] }),
      );
    available = 2;
    expect((await exec()).status).toBe(429);
    expect(execRequests).toHaveLength(0);
    available = 2.2;
    const admitted = await exec();
    expect(admitted.status).toBe(200);
    await readSse(admitted);
    available = 1;
    const sameTurn = await exec();
    expect(sameTurn.status).toBe(200);
    await readSse(sameTurn);
    await release(routes, 'direct-warm');
    expect((await exec()).status).toBe(429);
    expect(execRequests).toHaveLength(2);
  });

  test('an acquired but abandoned idle generation must re-enter admission after its growth window', async () => {
    let available = 8;
    const routes = new SessionRoutes(
      cfg,
      fakeBackend,
      undefined,
      host(() => available),
    );
    await create(routes, 'abandoned-acquire');
    expect(
      (await routes.handleActivity('abandoned-acquire', 'acquire')).status,
    ).toBe(200);
    try {
      setSystemTime(Date.now() + 91_000);
      available = 2;
      expect(
        (
          await routes.handleExec(
            new Request('http://x'),
            'abandoned-acquire',
            JSON.stringify({ execId: 'too-late', command: ['echo', 'ok'] }),
          )
        ).status,
      ).toBe(429);
      expect(execRequests).toHaveLength(0);
    } finally {
      setSystemTime();
    }
  });

  test('warm waiters hold memory in the shared FIFO without holding another runtime slot', async () => {
    let available = 8;
    const routes = new SessionRoutes(
      { ...cfg, session: { ...cfg.session, maxSessions: 2 } },
      fakeBackend,
      undefined,
      host(() => available),
    );
    await create(routes, 'fifo-warm');
    await release(routes, 'fifo-warm');
    await routes.handleSetPinned('fifo-warm', '{"pinned":true}');
    available = 2;
    expect((await routes.handleActivity('fifo-warm', 'acquire')).status).toBe(
      429,
    );
    available = 2.2;
    const behind = await create(routes, 'fifo-create');
    expect(behind.status).toBe(429);
    expect(await behind.json()).toMatchObject({
      error: 'host_memory',
      queue: { position: 1 },
    });
    available = 2.7;
    expect((await create(routes, 'fifo-create')).status).toBe(201);
    expect((await routes.handleActivity('fifo-warm', 'acquire')).status).toBe(
      200,
    );
  });

  test.each([false, true])(
    'adopted actual Docker capability %s determines warm working set after policy changes',
    async (docker) => {
      const session = {
        ...mkBackendSession('adopted-capability', 'org_memory'),
        docker,
      };
      const routes = new SessionRoutes(
        { ...cfg, dockerInContainer: !docker },
        {
          ...fakeBackend,
          async listSessions() {
            return [session];
          },
        },
        undefined,
        host(() => 2.2),
      );
      await routes.adoptExisting();
      await release(routes, session.sessionId);
      const response = await routes.handleActivity(
        session.sessionId,
        'acquire',
      );
      expect(response.status).toBe(docker ? 429 : 200);
      expect(
        await (await routes.handleGet(session.sessionId)).json(),
      ).toMatchObject({ session: { docker } });
    },
  );

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

describe('per-session Docker capability', () => {
  test.each(['false', 1])(
    'refuses a malformed request (%p)',
    async (docker) => {
      const routes = new SessionRoutes(cfg, fakeBackend);
      const response = await routes.handleCreate(
        JSON.stringify({
          sessionId: 'no-elevation',
          organizationId: 'org',
          profile: 'agent',
          docker,
        }),
      );
      expect(response.status).toBe(400);
      expect(created.size).toBe(0);
    },
  );

  test('an opt-out is persisted, reported and admitted with the lighter working set', async () => {
    let launched: SessionSpec | undefined;
    const GIB = 1024 ** 3;
    const memory = { totalBytes: 4 * GIB, availableBytes: 1.75 * GIB };
    const routes = new SessionRoutes(
      { ...cfg, dockerInContainer: true },
      {
        ...fakeBackend,
        async createSession(spec) {
          launched = spec;
          return fakeBackend.createSession(spec);
        },
      },
      undefined,
      { latest: () => memory, read: async () => memory },
    );
    const response = await routes.handleCreate(
      JSON.stringify({
        sessionId: 'light-agent',
        organizationId: 'org',
        profile: 'agent',
        docker: false,
      }),
    );
    expect(response.status).toBe(201);
    expect(launched?.docker).toBe(false);
    expect(await response.json()).toMatchObject({
      session: { docker: false },
    });
    const ticket = await routes.handleActivity('light-agent', 'ticket');
    await routes.handleActivity('light-agent', 'release', await ticket.text());
    const now = Date.now();
    fakeHealth.lastActivityAtMs = now - 6 * 60_000;
    expect(await routes.sweepExpired(now)).toBe(1);
    expect(stopped.has('light-agent')).toBe(true);
  });

  test('adoption keeps the actual capability across a configuration change', async () => {
    const now = Date.now();
    const routes = new SessionRoutes(
      { ...cfg, dockerInContainer: true },
      {
        ...fakeBackend,
        async listSessions() {
          return [
            {
              ...mkBackendSession('adopt-light', 'org'),
              createdAtMs: now,
              ttlMs: cfg.session.maxLifetimeMs,
              idleTimeoutMs: cfg.session.maxIdleMs,
              docker: false,
            },
          ];
        },
      },
    );
    await routes.adoptExisting();
    expect(await (await routes.handleGet('adopt-light')).json()).toMatchObject({
      session: { docker: false },
    });
    const ticket = await routes.handleActivity('adopt-light', 'ticket');
    await routes.handleActivity('adopt-light', 'release', await ticket.text());
    fakeHealth.lastActivityAtMs = now - 6 * 60_000;
    expect(await routes.sweepExpired(now)).toBe(1);
  });
});

describe('unavailable session observations', () => {
  test('a lookup during a local create retries until the session is routable', async () => {
    const entered = Promise.withResolvers<void>();
    const ready = Promise.withResolvers<void>();
    const routes = new SessionRoutes(cfg, {
      ...fakeBackend,
      async createSession(spec) {
        entered.resolve();
        await ready.promise;
        return fakeBackend.createSession(spec);
      },
    });
    const pending = routes.handleCreate(
      JSON.stringify({
        sessionId: 'starting-local',
        organizationId: 'org_start',
      }),
    );
    await entered.promise;
    try {
      const response = await routes.handleGet('starting-local');
      expect(response.status).toBe(503);
      expect(response.headers.get('retry-after')).toBe('1');
    } finally {
      ready.resolve();
      expect((await pending).status).toBe(201);
    }
    expect((await routes.handleGet('starting-local')).status).toBe(200);
  });

  test.each(['inventory', 'endpoint', 'readiness'] as const)(
    'a cold registry reports a failed %s as retryable and recovers without recreating',
    async (failure) => {
      let unavailable = true;
      const id = 'existing-unobserved';
      const routes = new SessionRoutes(cfg, {
        ...fakeBackend,
        async listSessions() {
          if (unavailable && failure === 'inventory')
            throw new Error('temporary inventory failure');
          return [
            {
              ...mkBackendSession(id, 'org_observed'),
              ...(unavailable && failure === 'readiness'
                ? { state: 'degraded' as const, ended: false }
                : {}),
            },
          ];
        },
        async resolveEndpoint() {
          if (unavailable && failure === 'endpoint')
            throw new Error('temporary endpoint failure');
          return fakeBaseUrl;
        },
      });
      const requests = [
        () => routes.handleGet(id),
        () => routes.handleExecStatus(id, 'run1'),
        () => routes.handleActivity(id, 'acquire'),
        () => routes.handleActivity(id, 'ticket'),
        () => routes.handleExec(new Request('http://x/exec'), id, '{}'),
        () => routes.handleExecAttach(new Request('http://x/attach'), id, 'e1'),
        () => routes.handleExecCancel(id, 'e1'),
        () => routes.handleExecStdin(id, 'e1', '{}'),
        () => routes.handleEnvPatch(id, '{}'),
        () => routes.handleSetPinned(id, '{"pinned":true}'),
        () => routes.handleFilesStage(id, '{}'),
        () => routes.handleFilesDelete(id, '{}'),
        () => routes.handleFilesList(id, '.'),
        () => routes.handleFileContent(id, 'file.txt'),
      ];
      for (const request of requests) {
        const response = await request();
        expect(response.status).toBe(503);
        expect(response.headers.get('retry-after')).toBe('1');
        expect(await response.json()).toEqual({ error: 'session_unavailable' });
      }
      expect(routes.sessionCount()).toBe(0);
      expect(created.size).toBe(0);
      expect(stopped.size).toBe(0);
      unavailable = false;
      expect((await routes.handleGet(id)).status).toBe(200);
      expect((await routes.handleExecStatus(id, 'run1')).status).toBe(200);
      expect(routes.sessionIds()).toEqual([id]);
      expect(created.size).toBe(0);
    },
  );
});

describe('Kubernetes namespace admission', () => {
  const create = (routes: SessionRoutes, sessionId: string) =>
    routes.handleCreate(JSON.stringify({ sessionId, organizationId: 'org' }));
  const namespaceCfg = {
    ...cfg,
    backend: 'kubernetes' as const,
    session: { ...cfg.session, maxSessions: 1 },
  };

  test('sequential creates on different replicas count the preceding Pod before the next sweep', async () => {
    const sessions: BackendSession[] = [];
    const backend: SessionBackend = {
      ...fakeBackend,
      kind: 'kubernetes',
      async createSession(spec) {
        sessions.push({
          ...mkBackendSession(spec.sessionId, spec.organizationId),
          createdAtMs: spec.createdAtMs,
        });
        return { resumed: false };
      },
      async listSessions() {
        return [...sessions];
      },
    };
    const first = new SessionRoutes(namespaceCfg, backend);
    const second = new SessionRoutes(namespaceCfg, backend);
    await first.adoptExisting();
    await second.adoptExisting();
    expect((await create(first, 'replica-one')).status).toBe(201);
    expect((await create(second, 'replica-two')).status).toBe(429);
    expect(sessions.map((s) => s.sessionId)).toEqual(['replica-one']);
  });

  test.each(['starting', 'unknown', 'terminating'] as const)(
    'a %s Pod occupies namespace capacity even when it cannot be routed',
    async (phase) => {
      const routes = new SessionRoutes(namespaceCfg, {
        ...fakeBackend,
        kind: 'kubernetes',
        async listSessions() {
          return [
            {
              ...mkBackendSession(`peer-${phase}`, 'org_peer'),
              state: 'degraded' as const,
              ended: false,
            },
          ];
        },
      });
      await routes.adoptExisting();
      expect(routes.sessionCount()).toBe(0);
      expect((await create(routes, `after-${phase}`)).status).toBe(429);
      expect(created.size).toBe(0);
    },
  );

  test('terminal Pods free room but an unknown namespace observation does not', async () => {
    let unreadable = true;
    const routes = new SessionRoutes(namespaceCfg, {
      ...fakeBackend,
      kind: 'kubernetes',
      async listSessions() {
        if (unreadable) throw new Error('apiserver temporarily unavailable');
        return [{ ...mkBackendSession('ended', 'org_peer'), ended: true }];
      },
    });
    expect((await create(routes, 'new-session')).status).toBe(503);
    expect(created.size).toBe(0);
    unreadable = false;
    expect((await create(routes, 'new-session')).status).toBe(201);
  });

  test('a local create finishing while the inventory is in flight still occupies its slot', async () => {
    const creating = Promise.withResolvers<void>();
    const finishCreate = Promise.withResolvers<void>();
    const listing = Promise.withResolvers<void>();
    const finishList = Promise.withResolvers<void>();
    let holdInventory = false;
    let lists = 0;
    const sessions: BackendSession[] = [];
    const routes = new SessionRoutes(namespaceCfg, {
      ...fakeBackend,
      kind: 'kubernetes',
      async createSession(spec) {
        creating.resolve();
        await finishCreate.promise;
        sessions.push({
          ...mkBackendSession(spec.sessionId, spec.organizationId),
          createdAtMs: spec.createdAtMs,
        });
        return { resumed: false };
      },
      async listSessions() {
        lists += 1;
        const snapshot = [...sessions];
        if (holdInventory && lists === 2) {
          listing.resolve();
          await finishList.promise;
        }
        return snapshot;
      },
    });
    const first = create(routes, 'finishing');
    await creating.promise;
    // Advance the observation clock beyond createdAtMs: equality alone must
    // not be what preserves the create's reservation.
    const now = Date.now();
    setSystemTime(now + 1_000);
    holdInventory = true;
    const second = create(routes, 'late');
    try {
      await listing.promise;
      finishCreate.resolve();
      expect((await first).status).toBe(201);
      finishList.resolve();
      expect((await second).status).toBe(429);
      expect(sessions.map((s) => s.sessionId)).toEqual(['finishing']);
    } finally {
      finishCreate.resolve();
      finishList.resolve();
      setSystemTime();
      await Promise.allSettled([first, second]);
    }
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

test('staging stops before contacting runnerd when its caller has cancelled', async () => {
  const routes = new SessionRoutes(cfg, fakeBackend);
  await routes.handleCreate(
    JSON.stringify({
      sessionId: 'cancel-stage',
      organizationId: 'org_stage',
    }),
  );
  const signal = AbortSignal.abort();
  const response = await routes.handleFilesStage(
    'cancel-stage',
    JSON.stringify({
      files: [{ path: 'ignored.txt', contentBase64: 'eA==' }],
    }),
    signal,
  );
  expect(response.status).toBe(502);
  expect((await routes.handleGet('cancel-stage')).status).toBe(200);
});

test('cancelled status probes detach runnerd and skip backend eviction probes', async () => {
  const arrived = Promise.withResolvers<void>();
  const upstream = Bun.serve({
    port: 0,
    fetch(req) {
      if (new URL(req.url).pathname.startsWith('/execs/')) {
        arrived.resolve();
        return new Promise<Response>(() => {});
      }
      return Response.json({ denied: [] });
    },
  });
  let existsChecks = 0;
  const routes = new SessionRoutes(cfg, {
    ...fakeBackend,
    async resolveEndpoint() {
      return upstream.url.origin;
    },
    async sessionExists() {
      existsChecks += 1;
      return true;
    },
  });
  const abort = new AbortController();
  try {
    await routes.handleCreate(
      JSON.stringify({ sessionId: 'cancel-status', organizationId: 'org' }),
    );
    existsChecks = 0;
    const result = routes.handleExecStatus('cancel-status', 'e', abort.signal);
    await arrived.promise;
    abort.abort();
    const response = await result;
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'cancelled' });
    expect(existsChecks).toBe(0);
  } finally {
    abort.abort();
    await upstream.stop(true);
  }
});

test('busy replay admission stays nonterminal and preserves invalid cursor validation', async () => {
  const queries: Array<string | null> = [];
  const upstream = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname.endsWith('/attach')) {
        queries.push(url.searchParams.get('sinceSeq'));
        return Response.json({ error: 'busy' }, { status: 503 });
      }
      return Response.json({ denied: [] });
    },
  });
  let existsChecks = 0;
  const routes = new SessionRoutes(cfg, {
    ...fakeBackend,
    async resolveEndpoint() {
      return upstream.url.origin;
    },
    async sessionExists() {
      existsChecks += 1;
      return true;
    },
  });
  try {
    await routes.handleCreate(
      JSON.stringify({ sessionId: 'busy-attach', organizationId: 'org' }),
    );
    existsChecks = 0;
    const response = await routes.handleExecAttach(
      new Request(
        'http://sandbox/v1/sessions/busy-attach/exec/e/attach?sinceSeq=not-a-number',
      ),
      'busy-attach',
      'e',
    );
    const stream = await response.text();
    expect(stream).toContain('ATTACH_BUSY');
    expect(stream).not.toContain('event: result');
    expect(queries).toEqual(['NaN']);
    expect(existsChecks).toBe(0);
  } finally {
    await upstream.stop(true);
  }
});
