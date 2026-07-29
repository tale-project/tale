// Full-fidelity coverage of the PORTABLE live convention: the composed
// program (façade prelude + connector body) runs in a REAL `node -e` child —
// exactly what the production session transport does — and its `ctx.http`
// round-trips to a local HTTP server standing in for the host-call endpoint.
// What this locks: the wire shape between the prelude and the endpoint, the
// façade's response object (`status`/`headers`/`text()`/`json()`), secrets
// and base64 semantics, and that a hostcall-reported error surfaces as the
// body's own throw.

import { spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createSandboxExecRunner,
  createSessionTransport,
  type SandboxProgramRunner,
} from '../engine/runners/sandbox-exec';
import {
  buildPortableLiveCode,
  type PortableLiveCtxData,
} from './portable-live';

/** Run the assembled program in a real node child — the production shape. */
const nodeProgramRunner: SandboxProgramRunner = (program, timeoutMs) =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, ['-e', program], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code, timedOut });
    });
  });

const runner = createSandboxExecRunner(
  createSessionTransport(nodeProgramRunner),
);

interface SeenRequest {
  authorization: string | undefined;
  body: unknown;
}

let server: Server;
let hostcallUrl: string;
const seen: SeenRequest[] = [];
/** What the fake endpoint answers next. */
let nextAnswer: unknown = {};

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => (raw += chunk.toString()));
    req.on('end', () => {
      seen.push({
        authorization: req.headers.authorization,
        body: JSON.parse(raw),
      });
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(nextAnswer));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  hostcallUrl = `http://127.0.0.1:${port}/api/connectors/hostcall`;
});

afterAll(() => {
  server.close();
});

function ctxData(): PortableLiveCtxData {
  return {
    secrets: { apiKey: 'sk-secret-1' },
    config: { region: 'eu' },
    idempotencyKey: 'idem-1',
    hostCall: { url: hostcallUrl, token: 'one-run-token' },
  };
}

describe('the portable live convention, end to end in a real node child', () => {
  it('rebuilds the façade: secrets, config, base64, and a mediated http call', async () => {
    nextAnswer = {
      status: 200,
      headers: { 'x-vendor': 'yes' },
      bodyText: JSON.stringify({ results: [{ title: 'hit' }] }),
    };
    const body = `
      const payload = { api_key: ctx.secrets.get('apiKey'), missing: ctx.secrets.get('nope'), region: ctx.config.region };
      const r = await ctx.http.post('https://api.vendor.test/search', {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (r.status >= 400) throw new Error('vendor said ' + r.status);
      const data = r.json();
      return {
        first: data.results[0].title,
        vendorHeader: r.headers['x-vendor'],
        again: r.json().results.length,
        b64: ctx.base64Decode(ctx.base64Encode('round-trip')),
        idem: ctx.idempotencyKey,
      };
    `;
    seen.length = 0;

    const output = await runner.runBody(
      buildPortableLiveCode(body),
      { input: {}, ctx: ctxData() },
      { timeoutMs: 15_000 },
      { async: true },
    );

    expect(output).toEqual({
      first: 'hit',
      vendorHeader: 'yes',
      again: 1,
      b64: 'round-trip',
      idem: 'idem-1',
    });
    // The wire shape the real endpoint implements, authed by the one-run token.
    expect(seen).toHaveLength(1);
    expect(seen[0]?.authorization).toBe('Bearer one-run-token');
    expect(seen[0]?.body).toMatchObject({
      kind: 'http',
      method: 'POST',
      url: 'https://api.vendor.test/search',
      req: {
        body: JSON.stringify({
          api_key: 'sk-secret-1',
          missing: '',
          region: 'eu',
        }),
      },
    });
  });

  it("surfaces a hostcall refusal as the body's own throw", async () => {
    nextAnswer = {
      error: {
        code: 'HOST_NOT_ALLOWED',
        message: 'evil.test is not on the connector allowlist',
      },
    };
    const body = `
      const r = await ctx.http.get('https://evil.test/');
      return r.status;
    `;

    await expect(
      runner.runBody(
        buildPortableLiveCode(body),
        { input: {}, ctx: ctxData() },
        { timeoutMs: 15_000 },
        { async: true },
      ),
    ).rejects.toThrow(/evil\.test is not on the connector allowlist/);
  });

  it('refuses ctx.files with a clear message instead of a TypeError', async () => {
    const body = `
      await ctx.files.download('https://api.vendor.test/file', { fileName: 'a.bin' });
      return 'unreachable';
    `;

    await expect(
      runner.runBody(
        buildPortableLiveCode(body),
        { input: {}, ctx: ctxData() },
        { timeoutMs: 15_000 },
        { async: true },
      ),
    ).rejects.toThrow(/ctx\.files is not available/);
  });
});
