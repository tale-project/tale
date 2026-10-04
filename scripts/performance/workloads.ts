import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../../', import.meta.url));

export interface Workload {
  /** One sample runs the complete batch, including its correctness checks. */
  run: () => void | Promise<void>;
  operations: number;
  unit: string;
  description: string;
  cleanup?: () => void | Promise<void>;
  details?: () => Record<string, unknown>;
}

export const workloadRuntimes = {
  'shared.lines': 'bun',
  'shared.long-line': 'bun',
  'platform.schema-cold': 'node',
  'platform.schema-hot': 'node',
  'platform.telemetry-disabled': 'node',
  'platform.telemetry-enabled': 'node',
  'platform.agent-progress': 'node',
  'platform.projection-fragmented': 'node',
  'platform.projection-bursts': 'node',
  'sandbox.validation': 'bun',
  'sandbox.sse': 'bun',
  'daemon.exec-replay': 'node',
  'daemon.journal-write': 'node',
  'daemon.journal-reconnect': 'node',
  'gateway.store': 'bun',
  'ui.static-http': 'bun',
  'ui.seo-cold': 'bun',
  'ui.seo-hot': 'bun',
  'ui.render': 'bun',
  'cli.help': 'bun',
  'tools.manual-parse': 'bun',
  'tools.link-scan': 'bun',
  'tools.plop-scaffold': 'bun',
  'tools.opengrep': 'bun',
  'e2e.config': 'bun',
  'visual.pixels': 'bun',
} as const;
export type WorkloadId = keyof typeof workloadRuntimes;

/** Explicit selection only: requires the already-cached pinned scanner. */
export const optionalWorkloads: ReadonlySet<string> = new Set([
  'tools.opengrep',
]);

export async function prepareWorkload(
  id: string,
  fixtureRoot: string,
): Promise<Workload> {
  if (id === 'platform.agent-progress') {
    const { HarnessProjection } =
      await import('../../services/platform/lib/harnesses/projection.ts');
    const payload = 'x'.repeat(100_000);
    let retainedBytes = 0;
    return {
      operations: 4000,
      unit: 'events',
      description:
        '1000 tool cycles with 100 KB payloads, raw events and text deltas, projected into a bounded resumable checkpoint',
      run() {
        const projection = new HarnessProjection();
        for (let i = 0; i < 1000; i++) {
          projection.accept({ type: 'raw', harness: 'claude-code', payload });
          projection.accept({
            type: 'text-delta',
            text: 'Completed a step.\n',
          });
          projection.accept({
            type: 'tool-use',
            toolName: 'Read',
            toolUseId: String(i),
            input: { payload },
          });
          projection.accept({
            type: 'tool-result',
            toolUseId: String(i),
            output: payload,
          });
        }
        retainedBytes = Buffer.byteLength(
          JSON.stringify(projection.snapshot()),
        );
        assert.ok(retainedBytes < 400_000);
        assert.ok(projection.timeline().length <= 400);
        assert.equal(projection.timeline().at(-1)?.toolCallId, '999');
      },
      details: () => ({
        retainedCheckpointBytes: retainedBytes,
        rawPayloadBytesPerSample: 300_000_000,
      }),
    };
  }
  if (
    id === 'platform.projection-fragmented' ||
    id === 'platform.projection-bursts'
  ) {
    const { prepareProjectionWorkload } = await import('./projection.ts');
    return prepareProjectionWorkload(id);
  }
  if (id === 'daemon.journal-write' || id === 'daemon.journal-reconnect') {
    const { prepareJournalWorkload } = await import('./journal.ts');
    return prepareJournalWorkload(id, fixtureRoot);
  }
  if (id === 'tools.plop-scaffold' || id === 'tools.opengrep') {
    const { prepareToolWorkload } = await import('./tooling.ts');
    return prepareToolWorkload(id, root, fixtureRoot);
  }

  if (id === 'shared.lines' || id === 'shared.long-line') {
    const { pipeLines } =
      await import('../../packages/shared/src/process/pipe-lines.ts');
    const { RingBuffer } =
      await import('../../packages/shared/src/process/ring-buffer.ts');
    const longLine = id === 'shared.long-line';
    const chunk = new TextEncoder().encode(
      longLine ? 'x'.repeat(4096) : 'ordinary log line\n'.repeat(100),
    );
    const chunks = longLine ? 4096 : 1000;
    return {
      operations: longLine ? chunk.length * chunks : 100_000,
      unit: longLine ? 'bytes' : 'lines',
      description: longLine
        ? '16 MiB unterminated line in 4 KiB chunks, 8192-character cap'
        : '100,000 lines retained in a 256-entry log ring',
      async run() {
        const ring = new RingBuffer<string>(256);
        let count = 0;
        let emitted = 0;
        await pipeLines(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              if (emitted++ < chunks) controller.enqueue(chunk);
              else controller.close();
            },
          }),
          (line) => {
            count++;
            ring.push(line);
          },
        );
        assert.equal(count, longLine ? 1 : 100_000);
        assert.equal(ring.size, longLine ? 1 : 256);
        if (longLine) assert.ok((ring.tail(1)[0]?.length ?? Infinity) < 8300);
      },
    };
  }

  if (id === 'platform.schema-cold' || id === 'platform.schema-hot') {
    const { compileSchema, compileSchemaCached } =
      await import('../../services/platform/lib/engine/core/validate/schema.ts');
    const schema = {
      type: 'object',
      required: ['title', 'items'],
      additionalProperties: false,
      properties: {
        title: { type: 'string', maxLength: 200 },
        items: {
          type: 'array',
          maxItems: 1000,
          items: {
            type: 'object',
            required: ['amount'],
            properties: { amount: { type: 'number', minimum: 0 } },
          },
        },
      },
    };
    const input = {
      title: 'Synthetic automation input',
      items: Array.from({ length: 100 }, (_, amount) => ({ amount })),
    };
    const cold = id === 'platform.schema-cold';
    const operations = cold ? 25 : 5000;
    return {
      operations,
      unit: 'validations',
      description: `${operations} ${cold ? 'compile + validate' : 'cached compile lookup + validate'} operations over 100 items, production Node runtime`,
      run() {
        for (let i = 0; i < operations; i++) {
          const validate = cold
            ? compileSchema(schema)
            : compileSchemaCached('performance/synthetic@1', schema);
          assert.equal(validate(input), true);
        }
      },
    };
  }

  if (
    id === 'platform.telemetry-disabled' ||
    id === 'platform.telemetry-enabled'
  ) {
    const { prepareTelemetryWorkload } =
      await import('../../services/platform/scripts/performance-telemetry.ts');
    return prepareTelemetryWorkload(id === 'platform.telemetry-enabled');
  }

  if (id === 'sandbox.validation') {
    const { loadConfig } = await import('../../services/sandbox/src/config.ts');
    const { validateExecSession } =
      await import('../../services/sandbox/src/session/validate-session.ts');
    const directory = await mkdtemp(
      join(fixtureRoot, 'tale-performance-sandbox-'),
    );
    process.env.TALE_PLATFORM_SHARED_CONFIG_DIR = directory;
    process.env.SANDBOX_TOKEN = randomBytes(32).toString('hex');
    const config = loadConfig();
    const request = {
      execId: 'performance-exec',
      command: ['printf', 'performance'],
      env: Object.fromEntries(
        Array.from({ length: 128 }, (_, i) => [`PERF_${i}`, 'x'.repeat(256)]),
      ),
    };
    return {
      operations: 1000,
      unit: 'requests',
      description:
        '1000 exec requests with 128 environment values of 256 characters',
      run() {
        for (let i = 0; i < 1000; i++)
          assert.equal(validateExecSession(request, config).ok, true);
      },
      cleanup: () => rm(directory, { recursive: true, force: true }),
    };
  }

  if (id === 'sandbox.sse') {
    const { sseResponse } = await import('../../services/sandbox/src/sse.ts');
    const payload = { text: 'x'.repeat(256) };
    return {
      operations: 1000,
      unit: 'events',
      description:
        'Encode and fully consume a 1000-event SSE burst with 256-character payloads',
      async run() {
        const response = sseResponse(async ({ send, signal }) => {
          for (let i = 0; i < 1000; i++) send('stdout', payload);
          assert.equal(signal.aborted, false);
        });
        const text = await response.text();
        assert.equal(text.split('event: stdout').length - 1, 1000);
      },
    };
  }

  if (id === 'daemon.exec-replay') {
    const { ExecManager } =
      await import('../../services/sandbox-runtime/daemon/src/exec-manager.ts');
    const { EnvStore } =
      await import('../../services/sandbox-runtime/daemon/src/env-store.ts');
    const directory = await realpath(
      await mkdtemp(join(fixtureRoot, 'tale-performance-runnerd-')),
    );
    process.env.TALE_WORKSPACE_ROOT = directory;
    const manager = new ExecManager(new EnvStore(), () => {});
    let sequence = 0;
    return {
      operations: 1,
      unit: 'execs',
      description:
        'Real Node child outputs 1 MiB through runnerd then replays every byte from its bounded disk journal; host process reaping, no container',
      async run() {
        const execId = `performance-${sequence++}`;
        let exited = false;
        await manager.run(
          {
            execId,
            command: [
              process.execPath,
              '-e',
              'process.stdout.write("x".repeat(1048576))',
            ],
            timeoutMs: 10000,
            stdoutMaxBytes: 0,
            stderrMaxBytes: 0,
          },
          (event) => {
            assert.notEqual(event.t, 'fail');
            if (event.t === 'exit') {
              assert.equal(event.exitCode, 0);
              exited = true;
            }
          },
        );
        assert.equal(exited, true);
        let replayedBytes = 0;
        let replayedExit = false;
        let replayComplete = false;
        const replay = manager.attach(execId, (event) => {
          assert.notEqual(event.t, 'fail');
          if (event.t === 'stdout')
            replayedBytes += Buffer.byteLength(event.b64, 'base64');
          if (event.t === 'exit') replayedExit = true;
          if (event.t === 'replay-complete') replayComplete = true;
        });
        assert.ok(replay);
        await replay;
        assert.equal(replayedBytes, 1048576);
        assert.equal(replayedExit, true);
        assert.equal(replayComplete, true);
        assert.equal(manager.liveCount(), 0);
      },
      async cleanup() {
        await manager.terminateAll();
        await rm(directory, { recursive: true, force: true });
      },
    };
  }

  if (id === 'gateway.store') {
    const { createFileAccountStore } =
      await import('../../services/ai-gateway/backend/store.ts');
    const { createTokenCipher } =
      await import('../../services/ai-gateway/backend/crypto.ts');
    const directory = await mkdtemp(
      join(fixtureRoot, 'tale-performance-gateway-'),
    );
    const cipher = createTokenCipher(randomBytes(32));
    const store = createFileAccountStore({ dataDir: directory });
    for (let i = 0; i < 100; i++) {
      await store.putAccount({
        id: `account-${i}`,
        provider: 'anthropic',
        label: 'Synthetic account',
        accountEmail: null,
        accountId: null,
        plan: null,
        subscription: null,
        identityCheckedAt: null,
        accessToken: cipher.seal('synthetic-token'),
        refreshToken: cipher.seal('synthetic-refresh'),
        expiresAt: null,
        scopes: null,
        status: 'active',
        createdAt: '2026-01-01T00:00:00.000Z',
        lastRefreshedAt: null,
        usage: null,
        usageAttemptedAt: null,
      });
    }
    return {
      operations: 100,
      unit: 'accounts',
      description:
        'Read/validate 100 encrypted file-backed accounts, decrypt each, atomically update one; no vendor calls',
      async run() {
        const accounts = await store.listAccounts();
        assert.equal(accounts.length, 100);
        for (const account of accounts)
          assert.equal(cipher.open(account.accessToken), 'synthetic-token');
        assert.ok(
          await store.updateAccount('account-0', (account) => {
            account.label = 'Synthetic refreshed account';
          }),
        );
      },
      cleanup: () => rm(directory, { recursive: true, force: true }),
    };
  }

  if (id === 'ui.static-http') {
    const { startReactServer, defaultReactServerSecurityHeaders } =
      await import('../../packages/ui/src/server/index.ts');
    const directory = await mkdtemp(
      join(fixtureRoot, 'tale-performance-site-'),
    );
    await writeFile(
      join(directory, 'index.html'),
      `<!doctype html><html><head></head><body>${'static page '.repeat(8000)}</body></html>`,
    );
    const server = startReactServer({
      port: 0,
      hostname: '127.0.0.1',
      distDir: directory,
      logPrefix: 'performance',
      localeRouting: 'none',
      securityHeaders: defaultReactServerSecurityHeaders,
    });
    const url = `http://127.0.0.1:${server.port}/`;
    return {
      operations: 100,
      unit: 'requests',
      description:
        '100 real loopback HTTP GETs in batches of 10, 96 KiB HTML and security headers; client + server share worker memory',
      async run() {
        for (let batch = 0; batch < 10; batch++) {
          await Promise.all(
            Array.from({ length: 10 }, async () => {
              const response = await fetch(url, {
                signal: AbortSignal.timeout(10000),
              });
              assert.equal(response.status, 200);
              assert.ok((await response.arrayBuffer()).byteLength > 96000);
            }),
          );
        }
      },
      async cleanup() {
        await server.stop(true);
        await rm(directory, { recursive: true, force: true });
      },
    };
  }

  if (id === 'ui.seo-cold' || id === 'ui.seo-hot') {
    const { createOnDemandServer } =
      await import('../../packages/ui/src/seo/runtime/on-demand-server.ts');
    const routes = Array.from({ length: 250 }, (_, i) => ({
      url: `/page-${i}`,
      title: `Page ${i}`,
    }));
    const server = createOnDemandServer({
      siteUrl: 'https://performance.invalid',
      siteTitle: 'Performance',
      siteDescription: 'Synthetic fixture',
      loadRoutes: async () => ({ sections: [{ heading: 'Pages', routes }] }),
      loadBody: async (url) => `# ${url}\n\n${'Page body. '.repeat(400)}`,
    });
    const cold = id === 'ui.seo-cold';
    return {
      operations: 20,
      unit: 'requests',
      description: `20 concurrent ${cold ? 'cold' : 'cached'} full-text artifact requests over 250 pages of 4 KiB each`,
      async run() {
        if (cold) server.invalidate();
        await Promise.all(
          Array.from({ length: 20 }, async () => {
            const response = await server.handle(
              new Request('https://performance.invalid/llms-full.txt'),
            );
            assert.equal(response?.status, 200);
            assert.ok((await response?.text())?.includes('Page body.'));
          }),
        );
      },
    };
  }

  if (id === 'ui.render') {
    const { createElement } = await import('react');
    const { renderToString } = await import('react-dom/server');
    const { Button } =
      await import('../../packages/ui/src/components/primitives/button.tsx');
    const { MarketingButton } =
      await import('../../packages/marketing-ui/src/components/marketing/button.tsx');
    // createElement needs explicit children props for these components' required-children types.
    /* oxlint-disable react/no-children-prop */
    const element = createElement(
      'main',
      null,
      ...Array.from({ length: 100 }, (_, i) =>
        i % 2
          ? createElement(Button, { key: i, children: `Action ${i}` })
          : createElement(MarketingButton, { key: i, children: `Action ${i}` }),
      ),
    );
    /* oxlint-enable react/no-children-prop */
    return {
      operations: 100,
      unit: 'buttons',
      description:
        'React SSR of 50 shared UI and 50 marketing buttons; excludes browser layout and hydration',
      run() {
        assert.ok(renderToString(element).includes('Action 99'));
      },
    };
  }

  if (id === 'cli.help') {
    let childPeakRssBytes = 0;
    let activeChild: ReturnType<typeof Bun.spawn> | undefined;
    return {
      operations: 1,
      unit: 'startups',
      description:
        'Cold CLI process startup and --help; subprocess memory excluded from worker heap',
      async run() {
        const child = Bun.spawn(
          [process.execPath, resolve(root, 'tools/cli/src/index.ts'), '--help'],
          { cwd: root, stdout: 'pipe', stderr: 'pipe' },
        );
        activeChild = child;
        const [stdout, stderr, exitCode] = await Promise.all([
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
          child.exited,
        ]);
        activeChild = undefined;
        assert.equal(exitCode, 0, stderr);
        assert.ok(stdout.includes('Usage: tale'));
        childPeakRssBytes = Math.max(
          childPeakRssBytes,
          child.resourceUsage()?.maxRSS ?? 0,
        );
      },
      details: () => ({ childPeakRssBytes }),
      async cleanup() {
        if (activeChild && activeChild.exitCode === null) {
          activeChild.kill('SIGKILL');
          await activeChild.exited;
        }
      },
    };
  }

  if (id === 'tools.manual-parse') {
    const { parseSuite } = await import('../../tools/lint-manual/src/parse.ts');
    const text = await readFile(
      resolve(root, 'services/platform/tests/manual/suites/performance.md'),
      'utf8',
    );
    return {
      operations: 1000,
      unit: 'documents',
      description:
        'Parse the real platform performance manual suite 1000 times',
      run() {
        for (let i = 0; i < 1000; i++)
          assert.ok(
            parseSuite('performance', 'performance.md', text).boxes.length > 0,
          );
      },
    };
  }

  if (id === 'tools.link-scan') {
    const { originReferences } =
      await import('../../tools/lint-links/src/references.ts');
    const text = Array.from(
      { length: 1000 },
      (_, i) => `[Page ${i}](https://docs.tale.dev/page-${i})`,
    ).join('\n');
    return {
      operations: 1000,
      unit: 'links',
      description:
        'Extract 1000 documentation links and their source positions from one Markdown document',
      run() {
        assert.equal(
          originReferences(text, ['https://docs.tale.dev']).length,
          1000,
        );
      },
    };
  }

  if (id === 'e2e.config') {
    const { createPlaywrightConfig } =
      await import('../../packages/e2e/src/config.ts');
    return {
      operations: 1000,
      unit: 'configs',
      description:
        'Construct 1000 real shared Playwright configurations; excludes browser execution',
      run() {
        for (let i = 0; i < 1000; i++)
          assert.equal(
            createPlaywrightConfig({ port: 3000, testDir: '/synthetic' })
              .workers,
            1,
          );
      },
    };
  }

  if (id === 'visual.pixels') {
    const { noiseEnergy, cropRGBA } =
      await import('../../configs/platform/custom/skills/visual-aspect-analyzer/src/pixels.ts');
    const data = new Uint8Array(1920 * 1080 * 4).fill(128);
    const changed = new Uint8Array(data.length).fill(129);
    return {
      operations: 1920 * 1080,
      unit: 'pixels',
      description:
        'Compare two 1080p RGBA frames and crop a 640x480 element; excludes browser capture and external model analysis',
      run() {
        assert.equal(noiseEnergy(data, changed), 1 / 255);
        assert.equal(
          cropRGBA(
            { data, width: 1920, height: 1080 },
            { x: 10, y: 10, width: 640, height: 480 },
          )?.length,
          640 * 480 * 4,
        );
      },
    };
  }
  throw new Error(`Unknown workload: ${id}`);
}
