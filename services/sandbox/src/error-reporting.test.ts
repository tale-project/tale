import { describe, expect, test } from 'bun:test';

const reporting = new URL('./error-reporting.ts', import.meta.url).href;
const source = import.meta.dir;

async function child(script: string, dsn = '') {
  const subprocess = Bun.spawn([process.execPath, '-e', script], {
    env: {
      ...process.env,
      SENTRY_DSN: dsn,
      SENTRY_ENVIRONMENT: 'example-pr',
      TALE_VERSION: 'revision-proof',
      SANDBOX_TOKEN: 'synthetic-sandbox-secret',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [exit, stdout, stderr] = await Promise.all([
    subprocess.exited,
    new Response(subprocess.stdout).text(),
    new Response(subprocess.stderr).text(),
  ]);
  return { exit, stdout, stderr };
}

describe('sandbox runtime error reporting', () => {
  test('without a DSN no SDK or process listener starts', async () => {
    const result = await child(`
      const before = process.listenerCount('uncaughtException');
      const reporting = await import(${JSON.stringify(reporting)});
      reporting.reportSandboxError(new Error('disabled'), 'test');
      await reporting.flushSandboxErrorReporting();
      console.log(JSON.stringify({enabled: reporting.initSandboxErrorReporting(), added: process.listenerCount('uncaughtException') - before}));
    `);
    expect(result.exit).toBe(0);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toEqual({ enabled: false, added: 0 });
  });

  test('real envelopes preserve outcomes, omit credentials and filter only proven client disconnects', async () => {
    const envelopes: string[] = [];
    const ingest = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      async fetch(request) {
        envelopes.push(await request.text());
        return Response.json({});
      },
    });
    try {
      const result = await child(
        `
        const reporting = await import(${JSON.stringify(reporting)});
        reporting.initSandboxErrorReporting();
        const {makeSweepTick} = await import(${JSON.stringify(source + '/cleanup.ts')});
        const {sseResponse} = await import(${JSON.stringify(source + '/sse.ts')});
        const server = Bun.serve({port:0,hostname:'127.0.0.1',
          fetch(req) {
            if (new URL(req.url).pathname === '/server-error') throw new Error('server-boom');
            return reporting.handleSandboxRequest(req, async request => {
              await request.text();
              throw new Error('handler-boom');
            });
          }, error:reporting.sandboxServerError});
        const response = await fetch(server.url + 'api/automations/webhook/whk_synthetic?code=synthetic-grant', {
          method:'POST',headers:{authorization:'Bearer synthetic-api-key',cookie:'session=synthetic-cookie','x-tale-signature':'synthetic-signature'},body:'synthetic-body-secret'});
        const handlerStatus = response.status;
        const handlerBody = await response.json();
        const serverStatus = (await fetch(server.url + 'server-error')).status;
        const abort = new AbortController(); abort.abort();
        const disconnected = new Request('http://sandbox/disconnected', {signal:abort.signal});
        const abortStatus = (await reporting.handleSandboxRequest(disconnected, async () => {throw abort.signal.reason})).status;
        const closedStatus = (await reporting.handleSandboxRequest(disconnected, async () => {throw new TypeError('Invalid state: Controller is already closed')})).status;
        const afterLeaveStatus = (await reporting.handleSandboxRequest(disconnected, async () => {throw new Error('boom-after-departure')})).status;
        const aliveClosedStatus = (await reporting.handleSandboxRequest(new Request('http://sandbox/alive'), async () => {throw new TypeError('Invalid state: Controller is already closed')})).status;
        const sweep = makeSweepTick({sweepOrphans:async () => {throw new Error('sweep-boom')}},{maxTimeoutMs:1});
        await sweep();
        const broken = sseResponse(async () => {throw new Error('producer-boom')});
        await broken.text().catch(() => undefined);
        const cancelled = sseResponse(async ({signal}) => {
          await new Promise(resolve => signal.addEventListener('abort', resolve, {once:true}));
          throw new TypeError('Invalid state: Controller is already closed');
        });
        await cancelled.body.cancel();
        await Bun.sleep(10);
        await import(${JSON.stringify(source + '/server.ts')});
        Promise.reject(new Error('unhandled-boom'));
        await Bun.sleep(20);
        await reporting.flushSandboxErrorReporting();
        server.stop(true);
        console.log(JSON.stringify({handlerStatus,handlerBody,serverStatus,abortStatus,closedStatus,afterLeaveStatus,aliveClosedStatus,survived:true}));
      `,
        `http://public@127.0.0.1:${ingest.port}/1`,
      );
      expect(result.exit).toBe(0);
      const outcome = JSON.parse(
        result.stdout.trim().split('\n').at(-1) ?? '{}',
      );
      expect(outcome).toEqual({
        handlerStatus: 500,
        handlerBody: { error: 'internal', message: 'Error: handler-boom' },
        serverStatus: 500,
        abortStatus: 499,
        closedStatus: 499,
        afterLeaveStatus: 500,
        aliveClosedStatus: 500,
        survived: true,
      });
      const events = envelopes.flatMap((envelope) =>
        envelope.split('\n').flatMap((line) => {
          try {
            const parsed = JSON.parse(line);
            return parsed.exception ? [parsed] : [];
          } catch {
            return [];
          }
        }),
      );
      expect(events).toHaveLength(7);
      const messages = events.flatMap((event) =>
        event.exception.values.map((value: { value: string }) => value.value),
      );
      for (const message of [
        'handler-boom',
        'server-boom',
        'boom-after-departure',
        'Invalid state: Controller is already closed',
        'sweep-boom',
        'producer-boom',
        'unhandled-boom',
      ])
        expect(messages).toContain(message);
      for (const event of events) {
        expect(event.environment).toBe('example-pr');
        expect(event.release).toBe('revision-proof');
        expect(event.tags['tale.role']).toBe('sandbox');
      }
      const sent = envelopes.join('\n');
      for (const secret of [
        'whk_synthetic',
        'synthetic-grant',
        'synthetic-api-key',
        'synthetic-cookie',
        'synthetic-signature',
        'synthetic-body-secret',
        'synthetic-sandbox-secret',
      ])
        expect(sent).not.toContain(secret);
    } finally {
      await ingest.stop(true);
    }
  });

  test('uncaught errors are flushed through the SDK and remain fatal', async () => {
    const envelopes: string[] = [];
    const ingest = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      async fetch(request) {
        envelopes.push(await request.text());
        return Response.json({});
      },
    });
    try {
      const result = await child(
        `
        const reporting = await import(${JSON.stringify(reporting)});
        reporting.initSandboxErrorReporting();
        setTimeout(() => {throw new Error('fatal-boom')}, 0);
      `,
        `http://public@127.0.0.1:${ingest.port}/1`,
      );
      expect(result.exit).toBe(1);
      expect(envelopes.join('\n')).toContain('fatal-boom');
    } finally {
      await ingest.stop(true);
    }
  });
});
