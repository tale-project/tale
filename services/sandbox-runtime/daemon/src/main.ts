// runnerd — the in-container control daemon for persistent sandbox sessions.
//
// PID 1 of a session container (entrypoint dispatch `daemon`). Listens on
// :8200 inside tale-sandbox-net; the spawner is its only client and proxies
// in-session operations here over HTTP. Auth is the per-session token in
// x-tale-runnerd-token (derived spawner-side as HMAC(SANDBOX_TOKEN,
// "runnerd-v1:"+sessionId); empty disables the check in unsigned dev mode).
//
// Bundled to a single dist/runnerd.mjs with `bun build --target=node` and run
// by the image's Node 24 — so this file uses only node: built-ins, no deps.

import { timingSafeEqual } from 'node:crypto';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';

import { EnvStore } from './env-store.ts';
import { ExecManager } from './exec-manager.ts';
import {
  listDir,
  readWorkspaceFile,
  stageFiles,
  type StageItem,
} from './file-ops.ts';
import {
  RUNNERD_MAX_LIVE_EXECS,
  RUNNERD_PORT,
  RUNNERD_TOKEN_HEADER,
  type RunnerdExecEvent,
  type RunnerdExecRequest,
} from './protocol.ts';

const FILE_READ_MAX_BYTES = 20 * 1024 * 1024;

const TOKEN = process.env.TALE_RUNNERD_TOKEN ?? '';
const bootedAtMs = Date.now();
let lastActivityAtMs = bootedAtMs;
const touch = () => {
  lastActivityAtMs = Date.now();
};

let seedEnv: Record<string, string> | undefined;
if (process.env.TALE_SESSION_ENV) {
  try {
    const parsed: unknown = JSON.parse(process.env.TALE_SESSION_ENV);
    if (parsed !== null && typeof parsed === 'object') {
      // EnvStore drops non-string values + deny-listed names; coerce here so
      // the type stays Record<string,string> without an assertion.
      const seed: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === 'string') seed[k] = v;
      }
      seedEnv = seed;
    }
  } catch (err) {
    console.error('[runnerd] TALE_SESSION_ENV is not valid JSON:', err);
  }
}
const envStore = new EnvStore(seedEnv);
const execManager = new ExecManager(envStore, touch);

function tokenOk(req: IncomingMessage): boolean {
  if (TOKEN === '') return true; // unsigned dev mode
  const got = req.headers[RUNNERD_TOKEN_HEADER];
  const value = Array.isArray(got) ? (got[0] ?? '') : (got ?? '');
  const a = Buffer.from(value, 'utf8');
  const b = Buffer.from(TOKEN, 'utf8');
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(payload);
}

async function readBody(
  req: IncomingMessage,
  maxBytes = 4 * 1024 * 1024,
): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    // req yields Buffer chunks; the stream iterator types them as `any`, so
    // Buffer.from accepts it without an assertion.
    const buf = Buffer.from(chunk);
    total += buf.byteLength;
    if (total > maxBytes) throw new Error('payload_too_large');
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function handleExec(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  let parsed: RunnerdExecRequest;
  try {
    // Shape is re-validated field-by-field inside execManager.run (execId,
    // command/shell, cwd); this is trust-then-validate at the boundary.
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
    parsed = JSON.parse(await readBody(req)) as RunnerdExecRequest;
  } catch {
    sendJson(res, 400, { error: 'bad_request' });
    return;
  }
  if (execManager.liveCount() >= RUNNERD_MAX_LIVE_EXECS) {
    // Report through the NDJSON channel so the spawner's parser handles it
    // uniformly with pre-spawn failures.
    res.writeHead(200, { 'content-type': 'application/x-ndjson' });
    const fail: RunnerdExecEvent = {
      t: 'fail',
      code: 'EXEC_LIMIT',
      message: `live exec cap ${RUNNERD_MAX_LIVE_EXECS} reached`,
    };
    res.end(`${JSON.stringify(fail)}\n`);
    return;
  }
  res.writeHead(200, {
    'content-type': 'application/x-ndjson',
    'cache-control': 'no-cache, no-transform',
    'x-accel-buffering': 'no',
  });
  const emit = (event: RunnerdExecEvent) => {
    try {
      res.write(`${JSON.stringify(event)}\n`);
    } catch (err) {
      console.warn('[runnerd] NDJSON write after close:', err);
    }
  };
  // Client disconnect (spawner aborted the proxy) → cancel the exec.
  req.on('close', () => {
    if (execManager.has(parsed.execId)) execManager.cancel(parsed.execId);
  });
  try {
    await execManager.run(parsed, emit);
  } catch (err) {
    emit({
      t: 'fail',
      code: 'BAD_REQUEST',
      message: err instanceof Error ? err.message : String(err),
    });
  } finally {
    res.end();
  }
}

const EXEC_CANCEL_RE = /^\/execs\/([a-zA-Z0-9_-]{1,64})\/cancel$/;
const EXEC_ATTACH_RE = /^\/execs\/([a-zA-Z0-9_-]{1,64})\/attach$/;
const EXEC_STATUS_RE = /^\/execs\/([a-zA-Z0-9_-]{1,64})$/;

async function handleAttach(
  res: ServerResponse,
  execId: string,
): Promise<void> {
  if (!execManager.canAttach(execId)) {
    sendJson(res, 404, { error: 'not_found' });
    return;
  }
  res.writeHead(200, {
    'content-type': 'application/x-ndjson',
    'cache-control': 'no-cache, no-transform',
    'x-accel-buffering': 'no',
  });
  const emit = (event: RunnerdExecEvent) => {
    try {
      res.write(`${JSON.stringify(event)}\n`);
    } catch (err) {
      console.warn('[runnerd] attach write after close:', err);
    }
  };
  const stream = execManager.attach(execId, emit);
  if (stream) await stream;
  res.end();
}

async function router(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://runnerd');
  const path = url.pathname;

  // Unauthenticated kubelet probe — returns no session data.
  if (req.method === 'GET' && path === '/readyz') {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (!tokenOk(req)) {
    sendJson(res, 401, { error: 'unauthorized' });
    return;
  }

  if (req.method === 'GET' && path === '/healthz') {
    sendJson(res, 200, {
      ok: true,
      bootedAtMs,
      lastActivityAtMs,
      liveExecs: execManager.liveCount(),
    });
    return;
  }
  if (req.method === 'POST' && path === '/execs') {
    await handleExec(req, res);
    return;
  }
  const cancelMatch = path.match(EXEC_CANCEL_RE);
  if (req.method === 'POST' && cancelMatch) {
    touch();
    sendJson(res, 200, { killed: execManager.cancel(cancelMatch[1] ?? '') });
    return;
  }
  const attachMatch = path.match(EXEC_ATTACH_RE);
  if (req.method === 'GET' && attachMatch) {
    await handleAttach(res, attachMatch[1] ?? '');
    return;
  }
  const statusMatch = path.match(EXEC_STATUS_RE);
  if (req.method === 'GET' && statusMatch) {
    const id = statusMatch[1] ?? '';
    const live = execManager.status(id);
    sendJson(res, 200, {
      execId: id,
      state: live ? 'running' : 'exited',
      startedAtMs: live?.startedAtMs ?? 0,
      exitCode: null,
    });
    return;
  }
  if (req.method === 'POST' && path === '/env') {
    let body: { set?: Record<string, string>; unset?: string[] };
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      sendJson(res, 400, { error: 'bad_request' });
      return;
    }
    touch();
    const denied = envStore.patch(body.set, body.unset);
    sendJson(res, 200, { ok: true, denied });
    return;
  }
  if (req.method === 'POST' && path === '/files/stage') {
    let body: { files?: StageItem[] };
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      sendJson(res, 400, { error: 'bad_request' });
      return;
    }
    touch();
    const result = await stageFiles(body.files ?? []);
    sendJson(res, 200, result);
    return;
  }
  if (req.method === 'GET' && path === '/fs/list') {
    const entries = await listDir(url.searchParams.get('path') ?? '.');
    if (entries === null) {
      sendJson(res, 404, { error: 'not_found' });
      return;
    }
    sendJson(res, 200, { entries });
    return;
  }
  if (req.method === 'GET' && path === '/fs/read') {
    const bytes = await readWorkspaceFile(
      url.searchParams.get('path') ?? '',
      FILE_READ_MAX_BYTES,
    );
    if (bytes === null) {
      sendJson(res, 404, { error: 'not_found' });
      return;
    }
    res.writeHead(200, { 'content-type': 'application/octet-stream' });
    res.end(bytes);
    return;
  }
  sendJson(res, 404, { error: 'not_found' });
}

const server = createServer((req, res) => {
  router(req, res).catch((err) => {
    console.error('[runnerd] handler error:', err);
    try {
      sendJson(res, 500, { error: 'internal' });
    } catch {
      // headers already sent on a streaming response
    }
  });
});

// SIGTERM → graceful close (the container is being torn down; in-flight execs
// get their process-group SIGTERM from the orchestrator's container stop).
for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2_000);
  });
}

server.listen(RUNNERD_PORT, '0.0.0.0', () => {
  console.log(
    `[runnerd] listening on :${RUNNERD_PORT}; tokenAuth=${TOKEN === '' ? 'OFF (dev)' : 'on'}`,
  );
});
