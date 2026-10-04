// Production Node owns child-process buffers and closure lifetimes. Run the
// bundled manager there so Bun's different stream implementation cannot hide
// retained requests or an unbounded held-stdin queue.
import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

async function runInNode(body: string, withHttpServer = false): Promise<void> {
  const root = realpathSync(mkdtempSync(`${tmpdir()}/runnerd-memory-`));
  roots.push(root);
  writeFileSync(
    `${root}/entry.ts`,
    `import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { ExecManager } from ${JSON.stringify(`${import.meta.dir}/exec-manager.ts`)};
import { ExecReplay } from ${JSON.stringify(`${import.meta.dir}/exec-replay.ts`)};
import { EnvStore } from ${JSON.stringify(`${import.meta.dir}/env-store.ts`)};
import { RUNNERD_MAX_REQUEST_BODY_BYTES } from ${JSON.stringify(`${import.meta.dir}/protocol.ts`)};
process.env.TALE_WORKSPACE_ROOT = ${JSON.stringify(root)};
const root = ${JSON.stringify(root)};
const base = { timeoutMs: 30000, stdoutMaxBytes: 0, stderrMaxBytes: 0 };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
${body}`,
  );
  const built = await Bun.build({
    // Keep main separate so its entry-file check does not listen on import.
    entrypoints: [
      `${root}/entry.ts`,
      ...(withHttpServer ? [`${import.meta.dir}/main.ts`] : []),
    ],
    outdir: `${root}/dist`,
    target: 'node',
    naming: '[name].js',
  });
  expect(built.success).toBe(true);
  const result = spawnSync('node', ['--expose-gc', `${root}/dist/entry.js`], {
    encoding: 'utf8',
    timeout: 15_000,
  });
  expect({
    status: result.status,
    error: result.error,
    stderr: result.stderr,
  }).toEqual({
    status: 0,
    error: undefined,
    stderr: '',
  });
}

describe('ExecManager memory under Node', () => {
  test('disposed replay releases opaque checkpoint state while a descendant still retains its spool', async () => {
    await runInNode(String.raw`
const replay = new ExecReplay();
let reference;
async function checkpoint() {
  const state = { payload: 'x'.repeat(1024 * 1024 - 100) };
  reference = new WeakRef(state);
  await replay.saveCheckpoint({ seq: 0, state });
}
await checkpoint();
await replay.dispose();
let retained = true;
for (let round = 0; round < 30; round++) {
  await wait(10);
  global.gc();
  retained = reference.deref() !== undefined;
  if (!retained) break;
}
assert.equal(retained, false, 'disposed replay must release its opaque parser state');
// Keep the spool object live, just as a deferred descendant's callback does.
assert.throws(() => replay.assertAvailable(), /unavailable/);
`);
  }, 20_000);

  test('completed execs retain journal history without a second in-memory output copy', async () => {
    await runInNode(String.raw`
const manager = new ExecManager(new EnvStore(), () => {});
const expected = Buffer.from('é🌍\n'.repeat(50000));
let latest = [];
const outputBytes = events => Buffer.concat(events.filter(event => event.t === 'stdout').map(event => Buffer.from(event.b64, 'base64')));
try {
  // Fill and exceed the existing retained-exec window. No consumer keeps a
  // previous exec's output: the only history owner must be its journal.
  for (let index = 0; index < 17; index++) {
    latest = [];
    await manager.run({ ...base, execId: 'history-' + index, command: [process.execPath, '-e', "process.stdout.write('é🌍\\n'.repeat(50000))"] }, event => latest.push(event));
    assert.deepEqual(outputBytes(latest), expected);
  }
  assert.equal(manager.liveCount(), 0);
  assert.equal(manager.canAttach('history-0'), false);
  assert.equal(manager.status('history-0'), null);
  assert.deepEqual(manager.status('history-1'), { state: 'exited', exitCode: 0 });
  const retained = Reflect.get(manager, 'recent');
  assert.equal(retained.size, 16);
  // Count actual payload strings reachable through completed-record arrays,
  // not a source-code pattern or a heap/RSS estimate. Previously every record
  // held a duplicate encoded output tail here despite journal-only attach.
  let retainedOutputBytes = 0;
  for (const record of retained.values()) {
    for (const value of Object.values(record)) {
      if (Array.isArray(value)) {
        for (const item of value) if (typeof item === 'string') retainedOutputBytes += Buffer.byteLength(item);
      }
    }
  }
  assert.equal(retainedOutputBytes, 0, 'completed records must not retain duplicate output strings');
  for (const execId of ['history-1', 'history-16']) {
    const replayed = [];
    await manager.attach(execId, event => replayed.push(event));
    assert.deepEqual(outputBytes(replayed), expected);
    assert.equal(replayed[0].t, 'replay-start');
    assert.equal(replayed.at(-2).t, 'replay-complete');
    assert.equal(replayed.at(-1).t, 'exit');
  }
  const cursor = latest.find(event => event.t === 'stdout').seq;
  const suffix = [];
  await manager.attach('history-16', event => suffix.push(event), cursor);
  assert.deepEqual(suffix.filter(event => event.seq !== undefined), latest.filter(event => event.seq > cursor));
} finally {
  manager[Symbol.dispose]();
}
`);
  }, 20_000);

  for (const consumerMode of ['exec', 'attach'] as const) {
    test(`a disconnected HTTP ${consumerMode} consumer is collected while its exec keeps running`, async () => {
      await runInNode(
        String.raw`
const consumerMode = ${JSON.stringify(consumerMode)};
process.env.TALE_RUNNERD_TOKEN = '';
const { request } = await import('node:http');
const mainUrl = new URL('./main.js', import.meta.url);
const { server } = await import(mainUrl.href);
const refs = [];
server.prependListener('request', (req, res) => {
  if (refs.length === 0 && (consumerMode === 'exec' ? req.method === 'POST' && req.url === '/execs' : req.url === '/execs/http-consumer/attach')) {
    refs.push(new WeakRef(req), new WeakRef(res));
    // Keep replay waiting on its real Node drain/abort promise until the
    // client disconnects, even when loopback would otherwise drain at once.
    if (consumerMode === 'attach') Object.defineProperty(res, 'writableNeedDrain', { value: true });
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = 'http://127.0.0.1:' + server.address().port;
const execId = 'http-consumer';
async function disconnect() {
  await new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      ...base, execId,
      command: [process.execPath, '-e', "process.stdin.resume(); process.stdin.on('end', () => { process.stdout.write('ready\\n'); setTimeout(() => {}, 30000); })"],
      stdinBase64: Buffer.alloc(1024 * 1024, 120).toString('base64'),
    });
    const client = request(url + '/execs', {
      method: 'POST', agent: false,
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) },
    });
    client.once('error', reject);
    client.once('response', response => {
      let received = '';
      response.setEncoding('utf8');
      response.on('data', chunk => {
        received += chunk;
        if (!received.includes('"t":"stdout"')) return;
        response.removeAllListeners('data');
        response.destroy();
        client.destroy();
        resolve();
      });
    });
    client.end(payload);
  });
}
async function disconnectReplay() {
  await new Promise((resolve, reject) => {
    const client = request(url + '/execs/' + execId + '/attach', { agent: false });
    client.once('error', reject);
    client.once('response', response => {
      response.once('data', () => {
        assert(refs[1].deref()?.listenerCount('drain') > 0, 'replay must be waiting for drain before disconnect');
        response.destroy();
        client.destroy();
        resolve();
      });
    });
    client.end();
  });
}
const status = async () => (await fetch(url + '/execs/' + execId)).json();
try {
  await disconnect();
  if (consumerMode === 'attach') await disconnectReplay();
  assert.equal(refs.length, 2);
  let retained = refs.length;
  for (let round = 0; round < 30; round++) {
    // A dereference roots its target until this job ends: await BEFORE GC.
    await wait(10);
    global.gc();
    retained = refs.filter(ref => ref.deref() !== undefined).length;
    if (retained === 0) break;
  }
  assert.equal(retained, 0, 'detached request/response must not survive through the abort reason stack');
  assert.equal((await status()).state, 'running');
  const health = await (await fetch(url + '/healthz')).json();
  assert.equal(health.activity.activeOperations, 0);
  // Only the first attach is stalled; the next consumer must replay normally.
  const response = await fetch(url + '/execs/' + execId + '/attach');
  assert.equal(response.status, 200);
  const output = response.text();
  const cancellation = await (await fetch(url + '/execs/' + execId + '/cancel', { method: 'POST' })).json();
  assert.equal(cancellation.killed, true);
  const events = (await output).trim().split('\n').map(line => JSON.parse(line));
  assert(events.some(event => event.t === 'stdout' && Buffer.from(event.b64, 'base64').toString().includes('ready')));
  assert(events.some(event => event.t === 'exit' && event.cancelled));
  assert.equal((await status()).state, 'exited');
} finally {
  await fetch(url + '/execs/' + execId + '/cancel', { method: 'POST' }).then(response => response.json());
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
`,
        true,
      );
    }, 20_000);
  }

  test('completed requests and consumers are released while sibling and shim pipes remain live', async () => {
    await runInNode(String.raw`
const shim = root + '/shim';
writeFileSync(shim, '#!/bin/sh\nshift\nprintf "pid %s\\n" "$$" >&3\n"$@"\ncode=$?\nprintf "exit %s\\n" "$code" >&3\nif [ "$TALE_EXEC_ID" = background ]; then printf partial >&3; sleep 30; fi\nexit "$code"\n', { mode: 0o755 });
const manager = new ExecManager(new EnvStore(), () => {}, undefined, {}, { execShim: shim });
const running = manager.run({ ...base, execId: 'sibling', command: ['sleep', '30'] }, () => {});
const refs = [];
let shimPid;
async function complete(execId) {
  const request = { ...base, execId, command: ['/bin/sh', '-c', 'cat >/dev/null; echo "$PPID"'], stdinBase64: Buffer.alloc(1024 * 1024, 120).toString('base64') };
  const emit = event => {
    if (execId === 'background' && event.t === 'stdout') shimPid = Number(Buffer.from(event.b64, 'base64').toString().trim());
  };
  refs.push(new WeakRef(request), new WeakRef(emit));
  await manager.run(request, emit);
}
try {
  // Exceed the recent replay window; the completed shim targets stay deferred.
  for (let i = 0; i < 20; i++) await complete('done-' + i);
  await complete('background');
  assert.equal(manager.liveCount(), 1);
  assert.equal(manager.leftoverCount(), 21);
  assert.equal(manager.canAttach('done-0'), false);
  process.kill(shimPid, 0);
  let retained = refs.length;
  for (let i = 0; i < 20; i++) {
    await wait(10);
    global.gc();
    retained = refs.filter(ref => ref.deref() !== undefined).length;
    if (retained === 0) break;
  }
  assert.equal(retained, 0, 'completed requests/consumers must not be retained by leftovers or open pipes');
} finally {
  if (shimPid > 1) process.kill(-shimPid, 'SIGKILL');
  manager.cancel('sibling');
  await running;
  manager[Symbol.dispose]();
}
`);
  }, 20_000);

  test('held stdin refuses excess input before queuing it and accepts again after draining', async () => {
    await runInNode(String.raw`
const manager = new ExecManager(new EnvStore(), () => {});
const ready = root + '/ready';
let outputBytes = 0;
const running = manager.run({ ...base, execId: 'input', stdinMode: 'hold', command: ['/bin/sh', '-c', 'while [ ! -f "$1" ]; do sleep 0.01; done; exec cat', 'sh', ready] }, event => {
  if (event.t === 'stdout') outputBytes += Buffer.from(event.b64, 'base64').length;
});
try {
  const line = JSON.stringify({ message: 'x'.repeat(60000) }) + '\n';
  const b64 = Buffer.from(line).toString('base64');
  let accepted = 0;
  for (let i = 0; i < 1000; i++) {
    const response = manager.writeStdin('input', { b64 });
    if (response.ok) accepted++;
    else assert.equal(response.reason, 'WRITE_FAILED');
  }
  assert(accepted > 0);
  assert(accepted <= Math.ceil(RUNNERD_MAX_REQUEST_BODY_BYTES / Buffer.byteLength(line)) + 1, 'stdin accepted an unbounded queue');
  assert.deepEqual(manager.writeStdin('input', { b64, eof: true }), { ok: false, reason: 'WRITE_FAILED' });
  writeFileSync(ready, 'ready');
  const expected = accepted * Buffer.byteLength(line);
  for (let i = 0; i < 500 && outputBytes !== expected; i++) await wait(10);
  assert.equal(outputBytes, expected, 'refused bytes must not enter the pipe');
  const tail = Buffer.from('{"tail":true}\n');
  assert.deepEqual(manager.writeStdin('input', { b64: tail.toString('base64'), eof: true }), { ok: true });
  await running;
  assert.equal(outputBytes, expected + tail.length);
} finally {
  manager.cancel('input');
  await running;
  manager[Symbol.dispose]();
}
`);
  }, 20_000);
});
