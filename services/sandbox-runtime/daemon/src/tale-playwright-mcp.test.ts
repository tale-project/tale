// The Playwright MCP launcher: it bridges the sandbox proxy into Playwright's
// flags, and it answers the start of a turn from a manifest of the real
// server's answers, starting the server only when the turn first uses it. A
// stand-in server on PATH records what reached it.
import { afterAll, describe, expect, test } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'tale-playwright-mcp-'));
const launcher = resolve(import.meta.dir, '../../tale-playwright-mcp');
const python = Bun.which('python3') ?? 'python3';
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('headless Playwright MCP launcher', () => {
  const bin = join(dir, 'echo-bin');
  mkdirSync(bin);
  writeFileSync(
    join(bin, 'mcp-server-playwright'),
    '#!/bin/sh\nprintf "%s\\n" "$PLAYWRIGHT_DISABLE_FORCED_CHROMIUM_PROXIED_LOOPBACK" "$@"\n',
    { mode: 0o755 },
  );

  function launch(proxy: string, bypass: string): string[] {
    const result = spawnSync(
      python,
      ['-Es', launcher, '--headless', '--browser', 'chromium'],
      {
        env: {
          ...process.env,
          PATH: bin,
          HTTPS_PROXY: proxy,
          NO_PROXY: bypass,
          TALE_PLAYWRIGHT_MCP_MANIFESTS: join(dir, 'no-manifests'),
        },
        encoding: 'utf8',
      },
    );
    expect(result.status).toBe(0);
    return result.stdout.trim().split('\n');
  }

  test('preserves headless launch flags and appends the sandbox proxy', () => {
    expect(launch('http://sandbox-egress:3128', '127.0.0.1,localhost')).toEqual(
      [
        '1',
        '--headless',
        '--browser',
        'chromium',
        '--proxy-server',
        'http://sandbox-egress:3128',
        '--proxy-bypass',
        '127.0.0.1,localhost',
      ],
    );
  });

  test('does not invent proxy arguments when no proxy is configured', () => {
    expect(launch('', '')).toEqual([
      '1',
      '--headless',
      '--browser',
      'chromium',
    ]);
  });

  test('runs through its own interpreter line', () => {
    const result = spawnSync(launcher, ['--headless'], {
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH ?? ''}`,
        TALE_PLAYWRIGHT_MCP_MANIFESTS: join(dir, 'no-manifests'),
      },
      encoding: 'utf8',
    });
    expect(result.status).toBe(0);
    expect(result.stdout.trim().split('\n')).toEqual(['1', '--headless']);
  });
});

// A stand-in MCP server: it speaks two protocol versions, lists one tool,
// asks the client for its roots on a tool call when the client offered them,
// and writes every message it receives to its log, behind a `started` line.
const STAND_IN = String.raw`#!/usr/bin/env python3
import json, os, sys
log = open(os.environ['STAND_IN_LOG'], 'a')
log.write('started ' + ' '.join(sys.argv[1:]) + '\n'); log.flush()
SUPPORTED = ['2025-06-18', '2024-11-05']
def send(obj):
    sys.stdout.write(json.dumps(obj) + '\n'); sys.stdout.flush()
roots = False
for line in sys.stdin:
    msg = json.loads(line)
    log.write(json.dumps(msg) + '\n'); log.flush()
    method, id_ = msg.get('method'), msg.get('id')
    if method == 'initialize':
        asked = msg['params']['protocolVersion']
        roots = 'roots' in msg['params'].get('capabilities', {})
        send({'jsonrpc': '2.0', 'id': id_, 'result': {
            'protocolVersion': asked if asked in SUPPORTED else SUPPORTED[0],
            'capabilities': {'tools': {}},
            'serverInfo': {'name': 'Playwright', 'version': '0.0.41'}}})
    elif method == 'tools/list':
        send({'jsonrpc': '2.0', 'id': id_, 'result': {'tools': [
            {'name': 'browser_navigate', 'inputSchema': {'type': 'object'}}]}})
    elif method == 'tools/call':
        found = None
        if roots:
            send({'jsonrpc': '2.0', 'id': 'srv-roots', 'method': 'roots/list'})
            found = json.loads(sys.stdin.readline())
            log.write(json.dumps(found) + '\n'); log.flush()
        text = 'navigated' if found is None else 'navigated with %d roots' % len(found['result']['roots'])
        send({'jsonrpc': '2.0', 'id': id_, 'result': {'content': [{'type': 'text', 'text': text}]}})
    elif method == 'ping':
        send({'jsonrpc': '2.0', 'id': id_, 'result': {}})
sys.exit(int(os.environ.get('STAND_IN_EXIT', '0')))
`;

const ARGS = ['--headless', '--browser', 'chromium', '--isolated'];

describe('the start of a turn without the server', () => {
  const bin = join(dir, 'stand-in-bin');
  const manifests = join(dir, 'manifests');
  const standInLog = join(dir, 'stand-in.log');
  mkdirSync(bin);
  writeFileSync(join(bin, 'mcp-server-playwright'), STAND_IN, {
    mode: 0o755,
  });
  const baseEnv = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH ?? ''}`,
    TALE_PLAYWRIGHT_MCP_MANIFESTS: manifests,
    STAND_IN_LOG: standInLog,
    HTTPS_PROXY: '',
    NO_PROXY: '',
  };

  // The image build records the manifest.
  const argSets = join(dir, 'arg-sets.json');
  writeFileSync(argSets, JSON.stringify([ARGS]));
  const written = spawnSync(
    python,
    ['-Es', launcher, '--write-manifests', argSets],
    { env: baseEnv, encoding: 'utf8' },
  );

  const received = (): string[] =>
    existsSync(standInLog)
      ? readFileSync(standInLog, 'utf8').trim().split('\n')
      : [];

  /** A client of the launcher: send lines, await answers by id. */
  function client(env: Record<string, string | undefined> = {}) {
    rmSync(standInLog, { force: true });
    const proc = spawn(python, ['-Es', launcher, ...ARGS], {
      env: { ...baseEnv, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const lines: Array<Record<string, unknown>> = [];
    const waiters: Array<() => void> = [];
    let buffer = '';
    proc.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      for (
        let end = buffer.indexOf('\n');
        end !== -1;
        end = buffer.indexOf('\n')
      ) {
        lines.push(JSON.parse(buffer.slice(0, end)));
        buffer = buffer.slice(end + 1);
      }
      for (const wake of waiters.splice(0)) wake();
    });
    const exited = new Promise<number | null>((done) => {
      proc.on('exit', (code) => done(code));
    });
    return {
      send(obj: Record<string, unknown>) {
        proc.stdin.write(`${JSON.stringify(obj)}\n`);
      },
      async answer(id: unknown): Promise<Record<string, unknown>> {
        const until = Date.now() + 10_000;
        for (;;) {
          const found = lines.find((line) => line.id === id);
          if (found !== undefined) return found;
          if (Date.now() > until)
            throw new Error(`no answer for ${String(id)}`);
          await new Promise<void>((wake) => {
            waiters.push(wake);
            setTimeout(wake, 50);
          });
        }
      },
      lines,
      async close(): Promise<number | null> {
        proc.stdin.end();
        return exited;
      },
    };
  }

  const initialize = (protocolVersion: string, capabilities = {}) => ({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion,
      capabilities,
      clientInfo: { name: 'test-client', version: '1' },
    },
  });

  test('the image build records the server’s answer to each protocol version', () => {
    expect(written.status).toBe(0);
    const files = readdirSync(manifests).filter((name) =>
      name.endsWith('.json'),
    );
    expect(files).toHaveLength(1);
    const manifest = JSON.parse(
      readFileSync(join(manifests, files[0] ?? ''), 'utf8'),
    );
    expect(manifest.args).toEqual(ARGS);
    const spoken = Object.fromEntries(
      Object.entries(manifest.initialize).map(([asked, result]) => [
        asked,
        typeof result === 'object' &&
        result !== null &&
        'protocolVersion' in result
          ? result.protocolVersion
          : undefined,
      ]),
    );
    // A version it speaks is answered with itself, any other with its latest.
    expect(spoken).toEqual({
      '2025-11-25': '2025-06-18',
      '2025-06-18': '2025-06-18',
      '2025-03-26': '2025-06-18',
      '2024-11-05': '2024-11-05',
      '2024-10-07': '2025-06-18',
    });
    expect(manifest.tools['2025-06-18'].tools[0].name).toBe('browser_navigate');
  });

  test('a known version the server does not speak is answered as the server would, still without it', async () => {
    const mcp = client();
    mcp.send(initialize('2025-11-25'));
    expect(await mcp.answer(1)).toMatchObject({
      result: { protocolVersion: '2025-06-18' },
    });
    mcp.send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    await mcp.answer(2);
    expect(await mcp.close()).toBe(0);
    expect(received()).toEqual([]);
  });

  test('answers initialize, tools/list and ping without starting the server', async () => {
    const mcp = client();
    mcp.send(initialize('2025-06-18'));
    expect(await mcp.answer(1)).toMatchObject({
      result: {
        protocolVersion: '2025-06-18',
        serverInfo: { name: 'Playwright' },
      },
    });
    mcp.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    mcp.send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    expect(await mcp.answer(2)).toMatchObject({
      result: { tools: [{ name: 'browser_navigate' }] },
    });
    mcp.send({ jsonrpc: '2.0', id: 3, method: 'ping' });
    expect(await mcp.answer(3)).toMatchObject({ result: {} });
    expect(await mcp.close()).toBe(0);
    expect(received()).toEqual([]);
  });

  test('starts the server on the first tool call, replaying the start to it', async () => {
    const mcp = client();
    mcp.send(initialize('2024-11-05'));
    await mcp.answer(1);
    mcp.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    mcp.send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    await mcp.answer(2);
    mcp.send({
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: { name: 'browser_navigate', arguments: { url: 'about:blank' } },
    });
    expect(await mcp.answer(7)).toMatchObject({
      result: { content: [{ text: 'navigated' }] },
    });
    expect(await mcp.close()).toBe(0);
    const log = received();
    expect(log[0]).toBe(`started ${ARGS.join(' ')}`);
    const seen = log.slice(1).map((line) => JSON.parse(line));
    expect(seen.map((msg) => msg.method)).toEqual([
      'initialize',
      'notifications/initialized',
      'tools/call',
    ]);
    // The client's own start, under an id of the launcher's.
    expect(seen[0].params.protocolVersion).toBe('2024-11-05');
    expect(seen[0].params.clientInfo.name).toBe('test-client');
    expect(seen[0].id).not.toBe(1);
    // Only the client's answers reach the client: one per request it sent.
    expect(mcp.lines.map((line) => line.id)).toEqual([1, 2, 7]);
  });

  test('a request of the server and the client’s answer pass through', async () => {
    const mcp = client();
    mcp.send(initialize('2025-06-18', { roots: { listChanged: false } }));
    await mcp.answer(1);
    mcp.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    mcp.send({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'browser_navigate', arguments: {} },
    });
    const asked = await mcp.answer('srv-roots');
    expect(asked.method).toBe('roots/list');
    mcp.send({
      jsonrpc: '2.0',
      id: 'srv-roots',
      result: { roots: [{ uri: 'file:///agent/workspace' }] },
    });
    expect(await mcp.answer(4)).toMatchObject({
      result: { content: [{ text: 'navigated with 1 roots' }] },
    });
    await mcp.close();
  });

  test('a protocol version the manifest has no answer for gets the server at once', async () => {
    const mcp = client();
    mcp.send(initialize('2099-01-01'));
    expect(await mcp.answer(1)).toMatchObject({
      result: { protocolVersion: '2025-06-18' },
    });
    await mcp.close();
    expect(received()[0]).toBe(`started ${ARGS.join(' ')}`);
    expect(JSON.parse(received()[1] ?? '{}').id).toBe(1);
  });

  test('TALE_PLAYWRIGHT_MCP_EAGER=1 starts the server at once', async () => {
    const mcp = client({ TALE_PLAYWRIGHT_MCP_EAGER: '1' });
    mcp.send(initialize('2025-06-18'));
    await mcp.answer(1);
    await mcp.close();
    expect(received()[0]).toBe(`started ${ARGS.join(' ')}`);
  });

  test('once started, the launcher exits with the server’s status', async () => {
    const mcp = client({ STAND_IN_EXIT: '7' });
    mcp.send(initialize('2025-06-18'));
    await mcp.answer(1);
    mcp.send({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'browser_navigate', arguments: {} },
    });
    await mcp.answer(2);
    expect(await mcp.close()).toBe(7);
  });
});
