// runnerd — the in-container control daemon for persistent sandbox sessions.
//
// The control process of a session container (entrypoint dispatch `daemon`),
// run under the image's tini init so the orphans that cancelled exec trees and
// child processes leave behind are reaped rather than left as zombies. Listens
// on :8200 inside tale-sandbox-net; the spawner is its only client and proxies
// in-session operations here over HTTP. Auth is the per-session token in
// x-tale-runnerd-token (derived spawner-side as HMAC(SANDBOX_TOKEN,
// "runnerd-v1:"+sessionId); empty disables the check in unsigned dev mode).
//
// Bundled to a single dist/runnerd.mjs with `bun build --target=node` and run
// by the image's Node 24 — so this file uses only node: built-ins, no deps.

import { timingSafeEqual } from 'node:crypto';
import { once } from 'node:events';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

import { ActivityGate } from './activity-gate.ts';
import { reconcileBakedSkills } from './baked-skills.ts';
import { exitDaemon } from './daemon-exit.ts';
import { EnvStore } from './env-store.ts';
import { ExecManager } from './exec-manager.ts';
import {
  deletePaths,
  listDir,
  streamWorkspaceFile,
  type StageOptions,
  stageFiles,
  type StageItem,
} from './file-ops.ts';
import { readJsonBody } from './http-body.ts';
import {
  RUNNERD_CONSUMER_BUFFER_MAX_BYTES,
  RUNNERD_MAX_LIVE_EXECS,
  RUNNERD_PORT,
  RUNNERD_TOKEN_HEADER,
  type RunnerdExecEvent,
  type RunnerdExecRequest,
  type RunnerdStdinWriteRequest,
} from './protocol.ts';
let stageRequests = 0;
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
// Every exec first brings the built-in skill links in line with the
// workspace, so the repository's own copy of a skill decides each turn.
const execManager = new ExecManager(envStore, touch, () =>
  reconcileBakedSkills(),
);
const activity = new ActivityGate(
  () => execManager.liveCount(),
  () => lastActivityAtMs,
);

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
  // A 413 needs no `Connection: close`: `readJsonBody` drains the refused
  // body before the route answers, so the keep-alive connection is clean
  // for the next request (closing it under a half-sent upload hangs Bun
  // 1.3.12's fetch — the spawner — on its next call).
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(payload);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Validate a POST /env body without a cast. `set` (if present) must be a
 * Record<string,string>; `unset` (if present) must be string[]. Returns null on
 * any malformed shape so the handler answers 400 before reaching envStore.patch
 * (which re-enforces the deny-list + caps but assumes well-typed entries). */
function parseEnvPatch(
  v: unknown,
): { set?: Record<string, string>; unset?: string[] } | null {
  if (!isObject(v)) return null;
  let set: Record<string, string> | undefined;
  if (v.set !== undefined) {
    if (!isObject(v.set)) return null;
    const out: Record<string, string> = {};
    for (const [k, val] of Object.entries(v.set)) {
      if (typeof val !== 'string') return null;
      out[k] = val;
    }
    set = out;
  }
  let unset: string[] | undefined;
  if (v.unset !== undefined) {
    if (!Array.isArray(v.unset)) return null;
    // Type-predicate filter mirrors validate-session's command parsing — a
    // clean string[] with no assertion. Reject if any entry was non-string.
    const strings = v.unset.filter((e): e is string => typeof e === 'string');
    if (strings.length !== v.unset.length) return null;
    unset = strings;
  }
  return { set, unset };
}

/** One HTTP consumer of an exec. A slow reader must lose its connection,
 * buffered writes and subscription together; the detached exec and its replay
 * ring remain available to this reader's next attach. */
function execConsumer(
  req: IncomingMessage,
  res: ServerResponse,
  label: string,
) {
  const consumer = new AbortController();
  const closed = new Promise<void>((settleClosed) => {
    consumer.signal.addEventListener('abort', () => settleClosed(), {
      once: true,
    });
  });
  const gone = () => consumer.abort();
  // IncomingMessage 'close' also means a completely received request under
  // Node. The response's close is the consumer's lifetime; aborted covers an
  // incomplete request without mistaking normal receipt for a disconnect.
  req.once('aborted', gone);
  res.once('close', gone);
  const emit = (event: RunnerdExecEvent) => {
    if (consumer.signal.aborted || res.destroyed || res.writableEnded) return;
    const line = `${JSON.stringify(event)}\n`;
    if (
      res.writableLength + Buffer.byteLength(line) >
      RUNNERD_CONSUMER_BUFFER_MAX_BYTES
    ) {
      console.warn(
        `[runnerd] ${label} consumer backpressured past ${RUNNERD_CONSUMER_BUFFER_MAX_BYTES}B — disconnecting it (reconnect via /attach)`,
      );
      gone();
      // end() would leave the queued bytes waiting on the stalled reader.
      // Destroying just this response releases its socket and write queue.
      res.destroy();
      return;
    }
    try {
      res.write(line);
    } catch (err) {
      console.warn(`[runnerd] ${label} write failed:`, err);
      gone();
      res.destroy();
    }
  };
  return {
    signal: consumer.signal,
    closed,
    emit,
    async replay(this: void, event: RunnerdExecEvent) {
      emit(event);
      if (!consumer.signal.aborted && res.writableNeedDrain) {
        const stalled = setTimeout(() => {
          gone();
          res.destroy();
        }, 2_000);
        try {
          await once(res, 'drain', { signal: consumer.signal });
        } finally {
          clearTimeout(stalled);
        }
      }
    },
    end() {
      gone();
      req.removeListener('aborted', gone);
      res.removeListener('close', gone);
      if (!res.destroyed && !res.writableEnded) res.end();
    },
  };
}

async function handleExec(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  // Shape is re-validated field-by-field inside execManager.run (execId,
  // command/shell, cwd); this is trust-then-validate at the boundary.
  const body = await readJsonBody(req);
  if (!body.ok) {
    sendJson(res, body.status, { error: body.error });
    return;
  }
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
  const parsed = body.value as RunnerdExecRequest;
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
  const consumer = execConsumer(req, res, 'exec stream');
  // Consumer disconnect: do NOT touch the exec. The child runs detached and is
  // kept alive by its SLIDING deadline (re-armed on every /attach), so a
  // platform action that lost its SSE can reconnect via /attach?sinceSeq= for
  // as long as the window allows — an orphaned exec (no reconnect for the whole
  // window) is the only thing the deadline reaps. We just stop writing here.
  try {
    // The request's activity ends with its consumer. The exec keeps running,
    // protected by liveCount and its orphan deadline, with any late failure
    // observed even after the consumer left.
    const run = execManager.run(parsed, consumer.emit).catch((err: unknown) => {
      consumer.emit({
        t: 'fail',
        code: 'BAD_REQUEST',
        message: err instanceof Error ? err.message : String(err),
      });
    });
    await Promise.race([run, consumer.closed]);
  } finally {
    consumer.end();
  }
}

const EXEC_CANCEL_RE = /^\/execs\/([a-zA-Z0-9_-]{1,64})\/cancel$/;
const EXEC_ATTACH_RE = /^\/execs\/([a-zA-Z0-9_-]{1,64})\/attach$/;
const EXEC_STDIN_RE = /^\/execs\/([a-zA-Z0-9_-]{1,64})\/stdin$/;
const EXEC_STATUS_RE = /^\/execs\/([a-zA-Z0-9_-]{1,64})$/;

async function handleAttach(
  req: IncomingMessage,
  res: ServerResponse,
  execId: string,
  sinceSeq: number,
): Promise<void> {
  if (!execManager.canAttach(execId)) {
    sendJson(res, 404, { error: 'not_found' });
    return;
  }
  if (!execManager.hasAttachCapacity) {
    sendJson(res, 503, { error: 'busy' });
    return;
  }
  res.writeHead(200, {
    'content-type': 'application/x-ndjson',
    'cache-control': 'no-cache, no-transform',
    'x-accel-buffering': 'no',
  });
  const consumer = execConsumer(req, res, 'attach');
  // This attach consumer dropping leaves the exec to its sliding deadline; a
  // further reattach re-arms it. No grace kill here (see handleExec). The
  // attach itself ends with its consumer, so it stops counting as work.
  try {
    const stream = execManager.attach(
      execId,
      consumer.replay,
      sinceSeq,
      consumer.signal,
    );
    if (stream) await stream;
  } finally {
    consumer.end();
  }
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
    const body: Record<string, unknown> = {
      ok: true,
      bootedAtMs,
      lastActivityAtMs,
      liveExecs: execManager.liveCount(),
      activity: activity.snapshot(),
    };
    sendJson(res, 200, body);
    return;
  }
  if (req.method === 'GET' && path === '/release') {
    sendJson(res, 200, { generation: activity.snapshot().generation });
    return;
  }
  if (req.method === 'POST' && path === '/acquire') {
    const generation = activity.acquire();
    sendJson(
      res,
      generation === null ? 503 : 200,
      generation === null ? { error: 'reclaiming' } : { generation },
    );
    return;
  }
  if (
    req.method === 'POST' &&
    ['/release', '/reclaim', '/pin'].includes(path)
  ) {
    const body = await readJsonBody(req);
    if (!body.ok) {
      sendJson(res, body.status, { error: body.error });
      return;
    }
    if (!isObject(body.value)) {
      sendJson(res, 400, { error: 'bad_request' });
      return;
    }
    if (path === '/pin') {
      if (typeof body.value.pinned !== 'boolean') {
        sendJson(res, 400, { error: 'bad_request' });
        return;
      }
      const applied = activity.setPinned(body.value.pinned);
      sendJson(
        res,
        applied ? 200 : 503,
        applied ? { ok: true } : { error: 'reclaiming' },
      );
      return;
    }
    const token =
      path === '/release' ? body.value.generation : body.value.claimId;
    if (typeof token !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(token)) {
      sendJson(res, 400, { error: 'bad_request' });
      return;
    }
    if (
      path === '/reclaim' &&
      (typeof body.value.generation !== 'string' ||
        !/^[a-zA-Z0-9_-]{1,128}$/.test(body.value.generation))
    ) {
      sendJson(res, 400, { error: 'bad_request' });
      return;
    }
    const idleBeforeMs = body.value.idleBeforeMs;
    if (
      path === '/reclaim' &&
      idleBeforeMs !== undefined &&
      (typeof idleBeforeMs !== 'number' ||
        !Number.isSafeInteger(idleBeforeMs) ||
        idleBeforeMs < 0)
    ) {
      sendJson(res, 400, { error: 'bad_request' });
      return;
    }
    sendJson(
      res,
      200,
      path === '/release'
        ? { released: activity.release(token) }
        : {
            claimed: activity.claim(
              token,
              String(body.value.generation),
              typeof idleBeforeMs === 'number' ? idleBeforeMs : undefined,
            ),
          },
    );
    return;
  }
  // Passive status/file reads protect their I/O while it runs without turning
  // an idle workspace back into an indefinitely allocated workload.
  const observation =
    req.method === 'GET' &&
    (EXEC_STATUS_RE.test(path) || path.startsWith('/fs/'));
  const leave = activity.enter(!observation);
  if (leave === null) {
    sendJson(res, 503, { error: 'reclaiming' });
    return;
  }
  try {
    await handleOperation(req, res, url);
  } finally {
    leave();
  }
}

/** The activity gate is entered before this function can await body intake,
 * staging fetches, filesystem I/O, exec creation or stream completion. */
async function handleOperation(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<void> {
  const path = url.pathname;
  if (req.method === 'POST' && path === '/execs') {
    await handleExec(req, res);
    return;
  }
  const cancelMatch = path.match(EXEC_CANCEL_RE);
  if (req.method === 'POST' && cancelMatch) {
    touch();
    // `?leftovers=keep`: a rotation, which hands what the exec left outside
    // its group to the exec that takes over (ExecManager.cancel).
    const keepLeftovers = url.searchParams.get('leftovers') === 'keep';
    sendJson(res, 200, {
      killed: execManager.cancel(cancelMatch[1] ?? '', { keepLeftovers }),
    });
    return;
  }
  const attachMatch = path.match(EXEC_ATTACH_RE);
  if (req.method === 'GET' && attachMatch) {
    const sinceSeq = Number(url.searchParams.get('sinceSeq') ?? '0');
    await handleAttach(req, res, attachMatch[1] ?? '', sinceSeq);
    return;
  }
  const stdinMatch = path.match(EXEC_STDIN_RE);
  if (req.method === 'POST' && stdinMatch) {
    const stdinBody = await readJsonBody(req);
    if (!stdinBody.ok) {
      sendJson(res, stdinBody.status, { error: stdinBody.error });
      return;
    }
    // writeStdin validates the payload (single NDJSON line, size cap).
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
    const body = stdinBody.value as RunnerdStdinWriteRequest;
    // 200 with a structured body in every reachable case (mirrors /cancel's
    // killed:false) — the caller branches on `reason`, not the status code.
    sendJson(res, 200, execManager.writeStdin(stdinMatch[1] ?? '', body));
    return;
  }
  const statusMatch = path.match(EXEC_STATUS_RE);
  if (req.method === 'GET' && statusMatch) {
    const id = statusMatch[1] ?? '';
    const st = execManager.status(id);
    if (st === null) {
      // Neither live nor recently-retained → gone (evicted past the recent
      // window, or never existed). 404 so the platform reads it as 'gone'.
      sendJson(res, 404, { execId: id, state: 'gone' });
      return;
    }
    sendJson(res, 200, {
      execId: id,
      state: st.state,
      ...(st.state === 'running'
        ? { startedAtMs: st.startedAtMs }
        : { exitCode: st.exitCode }),
    });
    return;
  }
  if (req.method === 'POST' && path === '/env') {
    const envBody = await readJsonBody(req);
    if (!envBody.ok) {
      sendJson(res, envBody.status, { error: envBody.error });
      return;
    }
    const patch = parseEnvPatch(envBody.value);
    if (patch === null) {
      sendJson(res, 400, { error: 'bad_request' });
      return;
    }
    touch();
    const denied = envStore.patch(patch.set, patch.unset);
    sendJson(res, 200, { ok: true, denied });
    return;
  }
  if (req.method === 'POST' && path === '/files/stage') {
    // Bound JSON intake as well as downloads. Refused bodies are drained
    // without retaining bytes, preserving the keep-alive framing contract.
    if (stageRequests >= 2) {
      await readJsonBody(req, 0);
      sendJson(res, 503, { error: 'busy' });
      return;
    }
    stageRequests += 1;
    try {
      const stageBody = await readJsonBody(req);
      if (!stageBody.ok) {
        sendJson(res, stageBody.status, { error: stageBody.error });
        return;
      }
      const body = stageBody.value;
      if (!isObject(body)) {
        sendJson(res, 400, { error: 'bad_request' });
        return;
      }
      const incomingFiles = body.files ?? [];
      if (!Array.isArray(incomingFiles) || incomingFiles.length > 512) {
        sendJson(res, 400, { error: 'bad_request' });
        return;
      }
      const files: StageItem[] = [];
      for (const item of incomingFiles) {
        if (
          !isObject(item) ||
          typeof item.path !== 'string' ||
          (item.url !== undefined && typeof item.url !== 'string') ||
          (item.contentBase64 !== undefined &&
            typeof item.contentBase64 !== 'string') ||
          (item.sourceId !== undefined &&
            (typeof item.sourceId !== 'string' ||
              item.sourceId.length > 2048)) ||
          (item.url !== undefined && item.contentBase64 !== undefined)
        ) {
          sendJson(res, 400, { error: 'bad_request' });
          return;
        }
        files.push({
          path: item.path,
          url: item.url,
          contentBase64: item.contentBase64,
          sourceId: item.sourceId,
        });
      }
      const options: StageOptions = {};
      for (const key of ['replaceRoots', 'keepPaths'] as const) {
        const value = body[key];
        if (value !== undefined) {
          if (
            !Array.isArray(value) ||
            !value.every((entry): entry is string => typeof entry === 'string')
          ) {
            sendJson(res, 400, { error: 'bad_request' });
            return;
          }
          options[key] = value;
        }
      }
      const transfer = new AbortController();
      const abort = () => transfer.abort();
      req.once('aborted', abort);
      res.once('close', abort);
      touch();
      try {
        const result = await stageFiles(files, {
          ...options,
          signal: transfer.signal,
        });
        if (!res.destroyed) sendJson(res, 200, result);
      } finally {
        req.removeListener('aborted', abort);
        res.removeListener('close', abort);
      }
      return;
    } finally {
      stageRequests -= 1;
    }
  }
  if (req.method === 'POST' && path === '/files/delete') {
    const deleteBody = await readJsonBody(req);
    if (!deleteBody.ok) {
      sendJson(res, deleteBody.status, { error: deleteBody.error });
      return;
    }
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
    const body = deleteBody.value as { paths?: string[] };
    touch();
    const result = await deletePaths(body.paths ?? []);
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
    const stream = await streamWorkspaceFile(
      url.searchParams.get('path') ?? '',
      FILE_READ_MAX_BYTES,
    );
    if (stream === null) {
      sendJson(res, 404, { error: 'not_found' });
      return;
    }
    res.writeHead(200, { 'content-type': 'application/octet-stream' });
    await pipeline(stream, res);
    return;
  }
  sendJson(res, 404, { error: 'not_found' });
}

export const server = createServer((req, res) => {
  router(req, res).catch((err) => {
    console.error('[runnerd] handler error:', err);
    try {
      sendJson(res, 500, { error: 'internal' });
    } catch {
      // headers already sent on a streaming response
    }
  });
});

server.once('close', () => execManager[Symbol.dispose]());

// Bound how long a client may take to send a request (headers + body) so a
// slow/stalled client can't pin a connection for Node's 5-min default. These
// cap request RECEIPT only — not the response, so long-lived exec NDJSON
// streams are unaffected (their bodies are small JSON, read up front).
server.requestTimeout = 30_000;
server.headersTimeout = 10_000;

// Use the Node entry-file check: Bun's node-target bundler rewrites
// import.meta.main into a CommonJS check that is also true on ESM imports.
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  // SIGTERM → graceful close (the container is being torn down). The init's
  // signal reaches only this daemon's process group, never the execs (each
  // runs in a group of its own), so pass it on: a harness gets to write its
  // transcript and a wrapper to remove what it staged before the teardown.
  // Either exit ends the daemon even past a /proc read that never returns
  // (daemon-exit.ts).
  for (const sig of ['SIGTERM', 'SIGINT'] as const) {
    process.on(sig, () => {
      setTimeout(() => exitDaemon(0), 2_000);
      void execManager
        .terminateAll()
        .catch((error: unknown) => {
          console.warn('[runnerd] passing the stop on failed:', error);
        })
        .finally(() => server.close(() => exitDaemon(0)));
    });
  }

  // Every harness finds the image's built-in skills among its own from the
  // session's first moment, not only after its first exec.
  reconcileBakedSkills();

  server.listen(RUNNERD_PORT, '0.0.0.0', () => {
    console.log(
      `[runnerd] listening on :${RUNNERD_PORT}; tokenAuth=${TOKEN === '' ? 'OFF (dev)' : 'on'}; execShim=${execManager.execShim ?? 'off'}`,
    );
  });
}
