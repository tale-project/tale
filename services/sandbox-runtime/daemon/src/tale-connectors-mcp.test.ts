// The in-sandbox platform bridge bounds each platform call. A long-running
// workspace tool (image generation) gets its own, longer bound and reports
// MCP progress while it runs, so the agent's MCP client — which times a call
// out on its own clock — keeps waiting instead of giving up on a call the
// platform is still finishing. Timeouts are shrunk through the bridge's
// environment knobs so the test runs in about a second.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { resolve } from 'node:path';

const shim = resolve(import.meta.dir, '../../tale-connectors-mcp');

let server: ReturnType<typeof Bun.serve>;
let bridge: ChildProcessWithoutNullStreams;
const lines: Array<Record<string, unknown>> = [];
const bodies: unknown[] = [];

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    async fetch(request) {
      bodies.push(await request.json());
      // Slower than the ordinary bound, faster than the long one.
      await Bun.sleep(600);
      return Response.json({ status: 'ok', output: { saved: true } });
    },
  });
  bridge = spawn(process.execPath, [shim], {
    env: {
      ...process.env,
      TALE_CONNECTORS_URL: `http://127.0.0.1:${server.port}/api/connectors`,
      TALE_CONNECTORS_TOKEN: 'session-key',
      TALE_CONNECTORS_REQUEST_TIMEOUT_MS: '200',
      TALE_CONNECTORS_LONG_REQUEST_TIMEOUT_MS: '5000',
      TALE_CONNECTORS_PROGRESS_INTERVAL_MS: '100',
    },
  });
  let buffer = '';
  bridge.stdout.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8');
    let newline = buffer.indexOf('\n');
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line !== '') lines.push(asRecord(JSON.parse(line)));
      newline = buffer.indexOf('\n');
    }
  });
});

afterAll(() => {
  bridge.kill();
  void server.stop(true);
});

function send(message: Record<string, unknown>): void {
  bridge.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
}

async function responseTo(id: number): Promise<Record<string, unknown>> {
  for (let waited = 0; waited < 8000; waited += 25) {
    const found = lines.find((line) => line.id === id);
    if (found !== undefined) return found;
    await Bun.sleep(25);
  }
  throw new Error(`no response to request ${id}`);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`expected a JSON object, got ${JSON.stringify(value)}`);
  }
  return Object.fromEntries(Object.entries(value));
}

/** The text of a tools/call result: `result.content[0].text`. */
function textOf(response: Record<string, unknown>): string {
  const content = asRecord(response.result).content;
  if (!Array.isArray(content) || content.length === 0) return '';
  const text = asRecord(content[0]).text;
  return typeof text === 'string' ? text : '';
}

describe('the platform bridge’s call bounds', () => {
  test('an ordinary workspace tool keeps the short bound', async () => {
    send({
      id: 1,
      method: 'tools/call',
      params: {
        name: 'workspace_tool',
        arguments: { tool: 'rag_search', args: { query: 'x' } },
      },
    });
    const response = await responseTo(1);
    expect(textOf(response)).toContain('timed out after 200ms');
  });

  test('image generation waits longer and reports progress on the caller’s token', async () => {
    send({
      id: 2,
      method: 'tools/call',
      params: {
        name: 'workspace_tool',
        arguments: { tool: 'generate_image', args: { prompt: 'a cat' } },
        _meta: { progressToken: 'call-2' },
      },
    });
    const response = await responseTo(2);
    expect(JSON.parse(textOf(response))).toEqual({
      status: 'ok',
      output: { saved: true },
    });
    const progress = lines.filter(
      (line) => line.method === 'notifications/progress',
    );
    expect(progress.length).toBeGreaterThan(0);
    for (const line of progress) {
      expect(line).not.toHaveProperty('id');
      expect(line.params).toMatchObject({ progressToken: 'call-2' });
    }
    expect(bodies).toContainEqual({
      tool: 'generate_image',
      args: { prompt: 'a cat' },
    });
  });

  test('a long call without a progress token reports nothing', async () => {
    const before = lines.filter(
      (line) => line.method === 'notifications/progress',
    ).length;
    send({
      id: 3,
      method: 'tools/call',
      params: {
        name: 'workspace_tool',
        arguments: { tool: 'generate_image', args: { prompt: 'a dog' } },
      },
    });
    const response = await responseTo(3);
    expect(textOf(response)).toContain('"saved":true');
    expect(
      lines.filter((line) => line.method === 'notifications/progress').length,
    ).toBe(before);
  });
});
