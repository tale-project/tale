import { execFile } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  RENDER_CRASH_ERROR_PATTERN,
  RENDER_PROXY_ERROR_PATTERN,
  RENDER_UNFINISHED_REASON,
  type RenderLaneHalt,
} from '../../../../lib/knowledge/crawl-parse';
import { functionRefName } from '../../../../lib/shared/handlers/function-refs';
import type { ActionCtx } from '../../lib/ctx';
import { sessionIdForRender } from '../../sandbox/session_naming';
import { SessionDuplicateError } from './helpers/session_client';
import {
  parseRenderResults,
  RENDER_WORKER_SOURCE,
  RenderCapacityError,
  renderUrlsInSandbox,
} from './render_fetch';

// The spawner verbs the render lane calls. The worker tests below use none
// of them, so replacing them for the whole file changes nothing there.
const spawner = vi.hoisted(() => ({
  sessionCreate: vi.fn(),
  sessionDestroy: vi.fn(),
  sessionDestroyIfIdle: vi.fn(),
  sessionIsAlive: vi.fn(),
  sessionStageFiles: vi.fn(),
  sessionReadFile: vi.fn(),
  runStepsInSession: vi.fn(),
}));
vi.mock('./helpers/session_client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./helpers/session_client')>()),
  sessionCreate: spawner.sessionCreate,
  sessionDestroy: spawner.sessionDestroy,
  sessionDestroyIfIdle: spawner.sessionDestroyIfIdle,
  sessionIsAlive: spawner.sessionIsAlive,
  sessionStageFiles: spawner.sessionStageFiles,
  sessionReadFile: spawner.sessionReadFile,
}));
vi.mock('./session_exec', () => ({
  runStepsInSession: spawner.runStepsInSession,
}));

/**
 * The worker↔engine protocol, pinned: what the crawl engine does with a page
 * hinges on this mapping — `ok` stores content, `failed` charges the page's
 * fail_count, `not_attempted` leaves the row due for the next link. A
 * malformed record must never look like a success.
 */

const URLS = ['https://a.ch/x', 'https://a.ch/y'] as const;

describe('parseRenderResults', () => {
  it('maps rendered pages, failures, and untouched URLs', () => {
    const { outcomes, halted } = parseRenderResults(
      {
        pages: [
          {
            url: 'https://a.ch/x',
            attempted: true,
            status: 200,
            finalUrl: 'https://a.ch/x2',
            html: '<html>ok</html>',
          },
          { url: 'https://a.ch/y', attempted: true, error: 'nav timeout' },
        ],
      },
      URLS,
    );
    expect(outcomes.get('https://a.ch/x')).toEqual({
      kind: 'ok',
      status: 200,
      finalUrl: 'https://a.ch/x2',
      html: '<html>ok</html>',
    });
    expect(outcomes.get('https://a.ch/y')).toEqual({
      kind: 'failed',
      reason: 'nav timeout',
      transient: false,
    });
    expect(halted).toBeNull();
  });

  it('treats a URL the worker never reached as not attempted', () => {
    const { outcomes } = parseRenderResults(
      { pages: [{ url: 'https://a.ch/x', attempted: false }] },
      URLS,
    );
    expect(outcomes.get('https://a.ch/x')).toEqual({ kind: 'not_attempted' });
    expect(outcomes.get('https://a.ch/y')).toEqual({ kind: 'not_attempted' });
  });

  it('never turns a malformed record into a success', () => {
    const { outcomes } = parseRenderResults(
      {
        pages: [
          // Attempted but no html and no error: failed with a stock reason.
          { url: 'https://a.ch/x', attempted: true, status: 200 },
          // Unknown URL and junk entries: ignored.
          { url: 'https://other.ch/z', attempted: true, html: '<p>' },
          null,
          'garbage',
        ],
      },
      URLS,
    );
    expect(outcomes.get('https://a.ch/x')).toEqual({
      kind: 'failed',
      reason: 'render produced no content',
      transient: false,
    });
    expect(outcomes.get('https://a.ch/y')).toEqual({ kind: 'not_attempted' });
    expect(outcomes.size).toBe(2);
  });

  it('survives a payload that is not an object at all', () => {
    for (const payload of [null, 42, 'nope', { pages: 'nope' }]) {
      const { outcomes, halted } = parseRenderResults(payload, URLS);
      expect(outcomes.get('https://a.ch/x')).toEqual({ kind: 'not_attempted' });
      expect(halted).toBeNull();
    }
  });

  // A navigation the browser lost twice reads `transient`: the engine
  // records the reason without a strike. The worker's halt marker rides
  // beside the pages; a malformed one is no halt.
  it('hands on the transient flag and the halt marker, and drops a malformed halt', () => {
    const transient = parseRenderResults(
      {
        pages: [
          {
            url: 'https://a.ch/x',
            attempted: true,
            error: 'page.goto: net::ERR_ABORTED; maybe frame was detached?',
            transient: true,
          },
          { url: 'https://a.ch/y', attempted: false },
        ],
        halted: {
          reason: 'egress_proxy',
          error:
            'page.goto: net::ERR_TUNNEL_CONNECTION_FAILED at https://a.ch/y',
        },
      },
      URLS,
    );
    expect(transient.outcomes.get('https://a.ch/x')).toEqual({
      kind: 'failed',
      reason: 'page.goto: net::ERR_ABORTED; maybe frame was detached?',
      transient: true,
    });
    expect(transient.outcomes.get('https://a.ch/y')).toEqual({
      kind: 'not_attempted',
    });
    expect(transient.halted).toEqual({
      reason: 'egress_proxy',
      error: 'page.goto: net::ERR_TUNNEL_CONNECTION_FAILED at https://a.ch/y',
    });

    const malformed = parseRenderResults(
      { pages: [], halted: { reason: 'weather', error: 'rain' } },
      URLS,
    );
    expect(malformed.halted).toBeNull();
    expect(malformed.outcomes.get('https://a.ch/x')).toEqual({
      kind: 'not_attempted',
    });
  });
});

/**
 * The render session's lifecycle against a scripted spawner. What is pinned:
 * a batch tears down only the session it created; a failed create's row reads
 * `failed` and is NEVER settled `destroyed` (the sandbox watchdog's COLLECT
 * pass reaches only unstamped `failed` rows); a create that failed outright
 * destroys what the spawner holds, idle only; and a create refused as a
 * duplicate destroys nothing, because the id may be the session another run
 * of the same batch is rendering in.
 */
const BATCH = {
  organizationId: 'org_1',
  urls: ['https://a.ch/x'],
  batchKey: 'a.ch:2026-09-27T00:00:00.000Z:1:1',
  execTimeoutMs: 120_000,
};

function renderRun(rowId: string) {
  const events: string[] = [];
  const runMutation = vi.fn(
    async (ref: unknown, _args: unknown): Promise<string | null> => {
      const name = functionRefName(ref).split(':')[1] ?? 'unknown';
      events.push(name);
      return name === 'reserveSessionSlotAndInsert' ? rowId : null;
    },
  );
  const ctx = { runMutation } as unknown as ActionCtx;
  return {
    events,
    runMutation,
    render: () => renderUrlsInSandbox(ctx, BATCH),
    mutationArgs: (name: string) =>
      runMutation.mock.calls
        .filter(([ref]) => functionRefName(ref).split(':')[1] === name)
        .map(([, args]) => args),
  };
}

/** Every spawner verb records itself in `events` and succeeds. */
function scriptSpawner(events: string[]): void {
  spawner.sessionCreate.mockImplementation(async () => {
    events.push('create');
    return { session: {} };
  });
  spawner.sessionDestroy.mockImplementation(async () => {
    events.push('destroy');
    return true;
  });
  spawner.sessionDestroyIfIdle.mockImplementation(async () => {
    events.push('destroyIfIdle');
    return { destroyed: true, busy: false };
  });
  spawner.sessionStageFiles.mockImplementation(async () => {
    events.push('stage');
  });
  spawner.runStepsInSession.mockImplementation(async () => {
    events.push('exec');
    return { status: 'completed', exitCode: 0, stdout: '', stderr: '' };
  });
  spawner.sessionReadFile.mockImplementation(async () => {
    events.push('read');
    const payload = JSON.stringify({
      pages: [
        {
          url: 'https://a.ch/x',
          attempted: true,
          status: 200,
          html: '<html>ok</html>',
        },
      ],
    });
    return {
      bytes: new TextEncoder().encode(payload).buffer,
      contentType: 'application/json',
    };
  });
}

describe('renderUrlsInSandbox — the session lifecycle', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  it('tears down the session it created and settles its row after the batch', async () => {
    const run = renderRun('row_1');
    scriptSpawner(run.events);

    const results = await run.render();

    expect(results.outcomes.get('https://a.ch/x')).toMatchObject({
      kind: 'ok',
      status: 200,
    });
    expect(results.halted).toBeNull();
    expect(run.events).toEqual([
      'reserveSessionSlotAndInsert',
      'create',
      'setSessionStatus',
      'stage',
      'exec',
      'read',
      'destroy',
      'markSessionRowDestroyed',
    ]);
    expect(spawner.sessionDestroyIfIdle).not.toHaveBeenCalled();
  });

  it('a failure after the create still tears the session down', async () => {
    const run = renderRun('row_1');
    scriptSpawner(run.events);
    const error = new Error('stage failed (502)');
    spawner.sessionStageFiles.mockRejectedValue(error);

    await expect(run.render()).rejects.toBe(error);

    expect(run.events).toEqual([
      'reserveSessionSlotAndInsert',
      'create',
      'setSessionStatus',
      'destroy',
      'markSessionRowDestroyed',
    ]);
  });

  // The regression: a failed destroy still settled the row `destroyed`,
  // which hid it from the watchdog's release pass while its container ran
  // on, outside the render budget.
  it('a session whose destroy failed keeps its live row for the watchdog', async () => {
    const run = renderRun('row_1');
    scriptSpawner(run.events);
    spawner.sessionDestroy.mockImplementation(async () => {
      run.events.push('destroy');
      throw new Error('spawner unreachable');
    });
    spawner.sessionIsAlive.mockRejectedValue(new Error('spawner unreachable'));

    await run.render();

    expect(run.events.at(-1)).toBe('destroy');
    expect(run.events).not.toContain('markSessionRowDestroyed');
  });

  it('a failed destroy whose session is gone after all frees the render slot at once', async () => {
    const run = renderRun('row_1');
    scriptSpawner(run.events);
    spawner.sessionDestroy.mockImplementation(async () => {
      run.events.push('destroy');
      throw new Error('sandbox session destroy failed (504)');
    });
    spawner.sessionIsAlive.mockResolvedValue(false);

    await run.render();

    expect(run.events.slice(-2)).toEqual([
      'destroy',
      'markSessionRowDestroyed',
    ]);
  });

  it('a sandbox host at capacity is a wait for room, not a failed batch', async () => {
    const run = renderRun('row_1');
    scriptSpawner(run.events);
    const { SpawnerBusyError } = await import('./helpers/session_client');
    spawner.sessionCreate.mockImplementation(async () => {
      run.events.push('create');
      throw new SpawnerBusyError(15_000);
    });

    await expect(run.render()).rejects.toBeInstanceOf(RenderCapacityError);
    // The failed create is settled as any other: its leftovers destroyed
    // while the row holds the slot, then the row reads failed.
    expect(run.events).toEqual([
      'reserveSessionSlotAndInsert',
      'create',
      'destroyIfIdle',
      'setSessionStatus',
    ]);
  });

  it('hands a halt on with every page untouched instead of calling it a worker that never started', async () => {
    const run = renderRun('row_1');
    scriptSpawner(run.events);
    const halted = {
      reason: 'egress_proxy',
      error: 'page.goto: net::ERR_TUNNEL_CONNECTION_FAILED',
    };
    spawner.sessionReadFile.mockImplementation(async () => {
      run.events.push('read');
      const payload = JSON.stringify({
        pages: [{ url: 'https://a.ch/x', attempted: false }],
        halted,
      });
      return {
        bytes: new TextEncoder().encode(payload).buffer,
        contentType: 'application/json',
      };
    });

    const results = await run.render();

    expect(results.halted).toEqual(halted);
    expect(results.outcomes.get('https://a.ch/x')).toEqual({
      kind: 'not_attempted',
    });
  });

  // Regression: the worker writes its output before it launches the browser,
  // so a Chromium that would not start left a file with every URL not
  // attempted — handed back as such, the crawl re-rendered the same batch
  // round after round, a session each, for up to 200 continuation links.
  it('a worker that stopped before its first page fails the batch with its own words, and tears the session down', async () => {
    const run = renderRun('row_1');
    scriptSpawner(run.events);
    spawner.runStepsInSession.mockImplementation(async () => {
      run.events.push('exec');
      return {
        status: 'failed',
        exitCode: 1,
        stdout: '',
        stderr:
          'browserType.launch: Target page, context or browser has been closed',
      };
    });
    spawner.sessionReadFile.mockImplementation(async () => {
      run.events.push('read');
      const payload = JSON.stringify({
        pages: [{ url: 'https://a.ch/x', attempted: false }],
      });
      return {
        bytes: new TextEncoder().encode(payload).buffer,
        contentType: 'application/json',
      };
    });

    await expect(run.render()).rejects.toThrow(
      /rendered no page.*status failed.*browserType\.launch/,
    );

    expect(run.events).toEqual([
      'reserveSessionSlotAndInsert',
      'create',
      'setSessionStatus',
      'stage',
      'exec',
      'read',
      'destroy',
      'markSessionRowDestroyed',
    ]);
  });

  it('a reservation the quota refuses creates, destroys and settles nothing', async () => {
    const run = renderRun('row_1');
    scriptSpawner(run.events);
    run.runMutation.mockRejectedValueOnce(
      Object.assign(new Error('At most 2 render sandbox sessions'), {
        code: 'QUOTA_EXCEEDED',
      }),
    );

    await expect(run.render()).rejects.toBeInstanceOf(RenderCapacityError);

    expect(spawner.sessionCreate).not.toHaveBeenCalled();
    expect(spawner.sessionDestroy).not.toHaveBeenCalled();
    expect(spawner.sessionDestroyIfIdle).not.toHaveBeenCalled();
    expect(run.runMutation).toHaveBeenCalledTimes(1);
  });

  // The regression: the failed create's row was settled `destroyed` in the
  // `finally` and the spawner was never asked, so a container the create cut
  // short (Docker state `created`) had no owner and no pass that reached it.
  it('destroys what a failed create left, idle only, before its row reads failed — and leaves the row to the watchdog', async () => {
    const run = renderRun('row_1');
    scriptSpawner(run.events);
    const error = new Error('runnerd did not become ready');
    spawner.sessionCreate.mockImplementation(async () => {
      run.events.push('create');
      throw error;
    });

    await expect(run.render()).rejects.toBe(error);

    expect(spawner.sessionDestroyIfIdle).toHaveBeenCalledTimes(1);
    expect(spawner.sessionDestroyIfIdle).toHaveBeenCalledWith(
      sessionIdForRender(BATCH.batchKey),
    );
    // The destroy runs while the still-`creating` row holds the batch's slot.
    expect(run.events).toEqual([
      'reserveSessionSlotAndInsert',
      'create',
      'destroyIfIdle',
      'setSessionStatus',
    ]);
    expect(run.mutationArgs('setSessionStatus')).toEqual([
      { rowId: 'row_1', status: 'failed' },
    ]);
    // Never settled `destroyed`: that stamps `destroyed_at_ms` on every row
    // under the id, and the COLLECT pass would never see this one.
    expect(run.mutationArgs('markSessionRowDestroyed')).toEqual([]);
    expect(spawner.sessionDestroy).not.toHaveBeenCalled();
  });

  it.each([
    [
      'fails',
      () =>
        spawner.sessionDestroyIfIdle.mockRejectedValue(
          new Error('sandbox session destroy failed (502)'),
        ),
      'destroy after failed create',
    ],
    [
      'answers busy',
      () =>
        spawner.sessionDestroyIfIdle.mockResolvedValue({
          destroyed: false,
          busy: true,
        }),
      'runs an exec after this failed create',
    ],
  ])(
    'a destroy that %s is logged, never thrown: the row reads failed and the create error survives',
    async (_label, script, logged) => {
      const run = renderRun('row_1');
      scriptSpawner(run.events);
      const error = new Error('sandbox session create failed (500)');
      spawner.sessionCreate.mockRejectedValue(error);
      script();

      await expect(run.render()).rejects.toBe(error);

      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining(logged),
        ...(logged.startsWith('destroy') ? [expect.anything()] : []),
      );
      expect(run.mutationArgs('setSessionStatus')).toEqual([
        { rowId: 'row_1', status: 'failed' },
      ]);
      expect(run.mutationArgs('markSessionRowDestroyed')).toEqual([]);
    },
  );

  it('a duplicate create destroys nothing and leaves its failed row to the watchdog', async () => {
    const run = renderRun('row_2');
    scriptSpawner(run.events);
    spawner.sessionCreate.mockImplementation(
      async (body: { sessionId: string }) => {
        run.events.push('create');
        throw new SessionDuplicateError(body.sessionId);
      },
    );

    await expect(run.render()).rejects.toBeInstanceOf(SessionDuplicateError);

    expect(run.events).toEqual([
      'reserveSessionSlotAndInsert',
      'create',
      'setSessionStatus',
    ]);
    expect(run.mutationArgs('setSessionStatus')).toEqual([
      { rowId: 'row_2', status: 'failed' },
    ]);
    expect(run.mutationArgs('markSessionRowDestroyed')).toEqual([]);
    expect(spawner.sessionDestroyIfIdle).not.toHaveBeenCalled();
    expect(spawner.sessionDestroy).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('already exists spawner-side'),
    );
  });

  // The batch key is deterministic, so a link that runs twice asks for the
  // same session id. The second run's create is refused while the first run
  // holds the session — between its create and its exec, where the session
  // is idle and an `if_idle` destroy would not spare it.
  it('a retried batch refused as a duplicate never destroys the session the first run renders in', async () => {
    const first = renderRun('row_1');
    const retry = renderRun('row_2');
    const events: string[] = [];
    scriptSpawner(events);
    let creates = 0;
    spawner.sessionCreate.mockImplementation(
      async (body: { sessionId: string }) => {
        creates += 1;
        events.push(creates === 1 ? 'first:create' : 'retry:create');
        if (creates > 1) throw new SessionDuplicateError(body.sessionId);
        return { session: {} };
      },
    );
    // The first run pauses between its create and its exec.
    const staging = Promise.withResolvers<void>();
    const resume = Promise.withResolvers<void>();
    spawner.sessionStageFiles.mockImplementation(async () => {
      events.push('first:stage');
      staging.resolve();
      await resume.promise;
    });

    const firstResult = first.render();
    await staging.promise;
    await expect(retry.render()).rejects.toBeInstanceOf(SessionDuplicateError);
    resume.resolve();
    await expect(firstResult).resolves.toMatchObject({ halted: null });

    const sessionId = sessionIdForRender(BATCH.batchKey);
    expect(spawner.sessionCreate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ sessionId }),
    );
    // The retry destroyed nothing; the only destroy is the first run's own
    // teardown, after its exec and read.
    expect(spawner.sessionDestroyIfIdle).not.toHaveBeenCalled();
    expect(events).toEqual([
      'first:create',
      'first:stage',
      'retry:create',
      'exec',
      'read',
      'destroy',
    ]);
    expect(retry.mutationArgs('setSessionStatus')).toEqual([
      { rowId: 'row_2', status: 'failed' },
    ]);
    expect(retry.mutationArgs('markSessionRowDestroyed')).toEqual([]);
  });
});

/**
 * The staged worker, run for real under node against a fake `playwright-core`
 * that answers every navigation with the same multibyte page — or, per URL,
 * with the failures `FAKE_SCRIPT` lines up (a thrown navigation error, a
 * document whose download broke off, a non-2xx). What is pinned: the output
 * file the host reads back is bounded in BYTES, decided before a page is
 * admitted — a page that does not fit is handed back for the next batch
 * instead of being written past the cap; and the lane's faults are the
 * lane's — a proxy refusal halts the batch, a lost navigation earns one
 * retry in a fresh context, a browser that opens no page halts too.
 */
const FAKE_PLAYWRIGHT = `
const fs = require('node:fs');
const chars = Number(process.env.FAKE_HTML_CHARS || '100');
// 'é' is one UTF-16 code unit but two UTF-8 bytes.
const html = '<html><body>' + 'é'.repeat(chars) + '</body></html>';
// The layout script's answer: unset, the page answers it like any other
// expression (not markup); 'throw', the page refuses it.
const layout = process.env.FAKE_LAYOUT_HTML;
// A page that holds the browser for good: its navigation never settles,
// and the process lives on until the exec budget kills it.
const hangUrl = process.env.FAKE_HANG_URL;
// Per URL, the outcome of each successive goto; a rendered page once the
// script runs out.
const script = JSON.parse(process.env.FAKE_SCRIPT || '{}');
const newPageFailsAfter = Number(process.env.FAKE_NEWPAGE_FAILS_AFTER || '0');
let pagesOpened = 0;
function nextStep(url) {
  const steps = script[url];
  return Array.isArray(steps) && steps.length > 0 ? steps.shift() : {};
}
function makePage() {
  let current = '';
  return {
    async goto(url) {
      current = url;
      if (url === hangUrl) await new Promise(() => setInterval(() => {}, 1000));
      const step = nextStep(url);
      if (step.throw) throw new Error(step.throw);
      const failure = step.bodyCut ? { errorText: step.bodyCut } : null;
      return {
        status: () => step.status || 200,
        request: () => ({ failure: () => failure }),
        async finished() { return null; },
      };
    },
    async waitForLoadState() {},
    async evaluate(expression) {
      if (String(expression).includes('renderedLayoutHtml') && layout) {
        if (layout === 'throw') throw new Error('the page refused the script');
        return layout;
      }
      return 42;
    },
    url() { return current; },
    async content() { return html; },
    async close() {},
  };
}
module.exports = {
  chromium: {
    async launch() {
      if (process.env.FAKE_LAUNCH_FAILS) {
        throw new Error('browserType.launch: Failed to launch the browser process');
      }
      return {
        async newContext(options) {
          const file = process.env.FAKE_CONTEXT_OPTIONS_FILE;
          if (file) fs.appendFileSync(file, JSON.stringify(options || {}) + '\\n');
          return {
            async newPage() {
              pagesOpened += 1;
              if (newPageFailsAfter > 0 && pagesOpened > newPageFailsAfter) {
                throw new Error('Target page, context or browser has been closed');
              }
              return makePage();
            },
            async close() {},
          };
        },
        async close() {},
      };
    },
  },
};
`;

const NODE_BIN = path.basename(process.execPath).startsWith('node')
  ? process.execPath
  : 'node';
const execFileAsync = promisify(execFile);

describe('render worker — output budget in bytes', () => {
  let root: string;
  let agent: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'render-worker-'));
    agent = path.join(root, 'agent');
    const fakeDir = path.join(agent, 'code', 'node_modules', 'playwright-core');
    mkdirSync(fakeDir, { recursive: true });
    writeFileSync(
      path.join(fakeDir, 'package.json'),
      JSON.stringify({ name: 'playwright-core', main: 'index.js' }),
    );
    writeFileSync(path.join(fakeDir, 'index.js'), FAKE_PLAYWRIGHT);
    // The worker's paths are fixed to /agent inside the sandbox; point them
    // at the temp root here.
    writeFileSync(
      path.join(agent, 'code', 'render.mjs'),
      RENDER_WORKER_SOURCE.replaceAll("'/agent/", `'${agent}/`),
    );
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  /** The contexts the worker opened, one options object per line. */
  function contextsOpened(): Record<string, unknown>[] {
    return readFileSync(path.join(root, 'context-options.json'), 'utf8')
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  }

  async function runWorker(
    urls: readonly string[],
    caps: { maxHtmlBytes: number; maxTotalBytes: number },
    htmlChars: number,
    extraInput: Record<string, unknown> = {},
    fakeEnv: Record<string, string> = {},
  ): Promise<{
    bytes: number;
    results: Map<string, unknown>;
    halted: RenderLaneHalt | null;
  }> {
    writeFileSync(
      path.join(agent, 'code', 'urls.json'),
      JSON.stringify({
        urls,
        perPageTimeoutMs: 10,
        idleTimeoutMs: 10,
        softBudgetMs: 60_000,
        proxyErrorPattern: RENDER_PROXY_ERROR_PATTERN.source,
        crashErrorPattern: RENDER_CRASH_ERROR_PATTERN.source,
        ...caps,
        ...extraInput,
      }),
    );
    rmSync(path.join(root, 'context-options.json'), { force: true });
    await execFileAsync(NODE_BIN, [path.join(agent, 'code', 'render.mjs')], {
      env: {
        ...process.env,
        FAKE_HTML_CHARS: String(htmlChars),
        FAKE_CONTEXT_OPTIONS_FILE: path.join(root, 'context-options.json'),
        ...fakeEnv,
      },
      timeout: 25_000,
    });
    const raw = readFileSync(path.join(agent, 'output', 'pages.json'));
    const payload: unknown = JSON.parse(raw.toString('utf8'));
    const { outcomes, halted } = parseRenderResults(payload, urls);
    return { bytes: raw.byteLength, results: outcomes, halted };
  }

  /** Run the worker until it fails or is killed, and read what it left. */
  async function workerLeftBehind(
    urls: readonly string[],
    env: Record<string, string>,
    killAfterMs: number,
    extraInput: Record<string, unknown> = {},
  ): Promise<Map<string, unknown>> {
    writeFileSync(
      path.join(agent, 'code', 'urls.json'),
      JSON.stringify({
        urls,
        perPageTimeoutMs: 10,
        idleTimeoutMs: 10,
        softBudgetMs: 60_000,
        maxHtmlBytes: 1_000_000,
        maxTotalBytes: 2_000_000,
        proxyErrorPattern: RENDER_PROXY_ERROR_PATTERN.source,
        crashErrorPattern: RENDER_CRASH_ERROR_PATTERN.source,
        ...extraInput,
      }),
    );
    await expect(
      execFileAsync(NODE_BIN, [path.join(agent, 'code', 'render.mjs')], {
        env: { ...process.env, FAKE_HTML_CHARS: '10', ...env },
        timeout: killAfterMs,
      }),
    ).rejects.toBeDefined();
    const raw = readFileSync(path.join(agent, 'output', 'pages.json'), 'utf8');
    const payload: unknown = JSON.parse(raw);
    return parseRenderResults(payload, urls).outcomes;
  }

  it('a browser that will not launch leaves every URL not attempted — the host fails that batch', async () => {
    const urls = ['https://site.example/a', 'https://site.example/b'];
    const results = await workerLeftBehind(
      urls,
      { FAKE_LAUNCH_FAILS: '1' },
      25_000,
    );
    expect([...results.values()]).toEqual([
      { kind: 'not_attempted' },
      { kind: 'not_attempted' },
    ]);
  }, 30_000);

  // Regression: a page that held the browser past the exec budget was never
  // written, so it came back `not_attempted`, led the next batch (never
  // crawled sorts first) and stalled the site's scan for good.
  it('a page the worker is cut off in is left on file as unfinished, the page before it as rendered', async () => {
    const urls = ['a', 'b', 'c'].map((p) => `https://site.example/${p}`);
    const results = await workerLeftBehind(
      urls,
      { FAKE_HANG_URL: urls[1] ?? '' },
      6_000,
    );
    expect(results.get(urls[0] ?? '')).toMatchObject({ kind: 'ok' });
    expect(results.get(urls[1] ?? '')).toEqual({
      kind: 'failed',
      reason: RENDER_UNFINISHED_REASON,
      transient: false,
    });
    expect(results.get(urls[2] ?? '')).toEqual({ kind: 'not_attempted' });
  }, 30_000);

  // The same cut, under a page that was started with less than its own time
  // left in the batch: the batch's doing, recorded without a strike. The
  // page is still stamped, so it does not come back within the scan.
  it('a page started too close to the batch end to finish is recorded without a strike', async () => {
    const urls = ['a', 'b'].map((p) => `https://site.example/${p}`);
    const results = await workerLeftBehind(
      urls,
      { FAKE_HANG_URL: urls[1] ?? '' },
      6_000,
      { hardBudgetMs: 50 },
    );
    expect(results.get(urls[1] ?? '')).toEqual({
      kind: 'failed',
      reason: RENDER_UNFINISHED_REASON,
      transient: true,
    });
  }, 30_000);

  // The pause a site asks for between two pages was slept through before
  // the budget was looked at, so a page could start after it — and be cut.
  it('does not start a page whose Crawl-delay would carry it past the budget', async () => {
    const urls = ['a', 'b'].map((p) => `https://site.example/${p}`);
    const startedAt = Date.now();
    const { results } = await runWorker(
      urls,
      { maxHtmlBytes: 1_000_000, maxTotalBytes: 2_000_000 },
      10,
      { softBudgetMs: 2_000, crawlDelayMs: 20_000 },
    );
    expect(results.get(urls[0] ?? '')).toMatchObject({ kind: 'ok' });
    expect(results.get(urls[1] ?? '')).toEqual({ kind: 'not_attempted' });
    expect(Date.now() - startedAt).toBeLessThan(15_000);
  }, 30_000);

  // Regression: the batch total was `html.length` summed AFTER storing each
  // page and checked only before the NEXT one, so pages.json could exceed the
  // host's read cap (and by more with multibyte text) — the host then saw no
  // output and the crawl retried the same batch forever.
  it('keeps pages.json under maxTotalBytes and hands back the page that would not fit', async () => {
    const urls = ['a', 'b', 'c', 'd'].map((p) => `https://site.example/${p}`);
    // 1700 chars = 3400 UTF-8 bytes per page: two fit under 10 000, the third
    // would not.
    const { bytes, results } = await runWorker(
      urls,
      { maxHtmlBytes: 4_000, maxTotalBytes: 10_000 },
      1_700,
    );
    expect(bytes).toBeLessThanOrEqual(10_000);
    expect(results.get(urls[0] ?? '')).toMatchObject({
      kind: 'ok',
      status: 200,
    });
    expect(results.get(urls[1] ?? '')).toMatchObject({
      kind: 'ok',
      status: 200,
    });
    // Not written past the cap, not charged as a failure: due next batch.
    expect(results.get(urls[2] ?? '')).toEqual({ kind: 'not_attempted' });
    expect(results.get(urls[3] ?? '')).toEqual({ kind: 'not_attempted' });
  }, 30_000);

  // A page that fits no batch was handed back every time: it led the next
  // batch, was rendered and handed back again, round after round.
  it('charges a page that does not fit an empty batch instead of handing it back', async () => {
    const urls = ['a', 'b'].map((p) => `https://site.example/${p}`);
    // 1700 chars = 3400 bytes: under the per-page bound, over the batch's.
    const { results } = await runWorker(
      urls,
      { maxHtmlBytes: 4_000, maxTotalBytes: 3_000 },
      1_700,
    );
    for (const url of urls) {
      expect(results.get(url)).toEqual({
        kind: 'failed',
        reason: 'rendered HTML exceeds the batch output bound',
        transient: false,
      });
    }
  }, 30_000);

  it('opens the browser context under the User-Agent the host hands in, and under none otherwise', async () => {
    // The render leg browsed as a stock HeadlessChrome: the host now hands
    // the crawler's own identity in with the batch (2026-09-15 evaluation,
    // i6) and the worker applies it to the context it opens.
    const caps = { maxHtmlBytes: 1_000_000, maxTotalBytes: 2_000_000 };
    await runWorker(['https://site.example/a'], caps, 10);
    expect(contextsOpened()).toEqual([{}]);
    const userAgent =
      'TaleBot/1.2.3 (+https://docs.tale.dev/platform/knowledge/crawling)';
    await runWorker(['https://site.example/a'], caps, 10, { userAgent });
    expect(contextsOpened()).toEqual([{ userAgent }]);
  });

  it('hands back the markup with the layout written in, and the plain serialization when the page refuses the script', async () => {
    const caps = { maxHtmlBytes: 1_000_000, maxTotalBytes: 2_000_000 };
    const url = 'https://site.example/a';
    const laidOut = '<html><body>\n<span>Price</span>\n</body></html>';
    const withLayout = await runWorker(
      [url],
      caps,
      10,
      {},
      {
        FAKE_LAYOUT_HTML: laidOut,
      },
    );
    expect(withLayout.results.get(url)).toMatchObject({
      kind: 'ok',
      html: laidOut,
    });
    const refused = await runWorker(
      [url],
      caps,
      10,
      {},
      {
        FAKE_LAYOUT_HTML: 'throw',
      },
    );
    expect(refused.results.get(url)).toMatchObject({
      kind: 'ok',
      html: `<html><body>${'é'.repeat(10)}</body></html>`,
    });
  }, 30_000);

  it('applies the per-page bound in bytes, not UTF-16 code units', async () => {
    const urls = ['https://site.example/big'];
    // 1700 code units pass a 3000 "length" check but are 3400 bytes.
    const { results } = await runWorker(
      urls,
      { maxHtmlBytes: 3_000, maxTotalBytes: 100_000 },
      1_700,
    );
    expect(results.get(urls[0] ?? '')).toEqual({
      kind: 'failed',
      reason: 'rendered HTML exceeds the per-page bound',
      transient: false,
    });
  }, 30_000);

  /**
   * The lane's faults, as the worker tells them apart. Regression: a proxy
   * that refused every tunnel (`SANDBOX_EGRESS_ALLOWLIST` without the host)
   * was charged to each page and benched a whole site in five scans; a
   * navigation the browser lost (its network service killed under the host)
   * was charged too, in runs to the end of the batch (2026-09-30).
   */
  const CAPS = { maxHtmlBytes: 1_000_000, maxTotalBytes: 2_000_000 };
  const A = 'https://site.example/a';
  const B = 'https://site.example/b';
  const C = 'https://site.example/c';
  const ABORTED = 'page.goto: net::ERR_ABORTED; maybe frame was detached?';

  it('a proxy refusal halts the batch: the page and the rest go back untouched, with the reason', async () => {
    const { results, halted } = await runWorker(
      [A, B],
      CAPS,
      10,
      {},
      {
        FAKE_SCRIPT: JSON.stringify({
          [A]: [
            { throw: `page.goto: net::ERR_TUNNEL_CONNECTION_FAILED at ${A}` },
          ],
        }),
      },
    );
    expect(halted).toEqual({
      reason: 'egress_proxy',
      error: `page.goto: net::ERR_TUNNEL_CONNECTION_FAILED at ${A}`,
    });
    expect(results.get(A)).toEqual({ kind: 'not_attempted' });
    expect(results.get(B)).toEqual({ kind: 'not_attempted' });
    expect(contextsOpened()).toHaveLength(1);
  }, 30_000);

  it('a lost navigation is retried once in a fresh context, and the page renders', async () => {
    const { results, halted } = await runWorker(
      [A, B],
      CAPS,
      10,
      {},
      {
        FAKE_SCRIPT: JSON.stringify({ [A]: [{ throw: ABORTED }] }),
      },
    );
    expect(halted).toBeNull();
    expect(results.get(A)).toMatchObject({ kind: 'ok', status: 200 });
    expect(results.get(B)).toMatchObject({ kind: 'ok', status: 200 });
    // The crashed context was replaced before the retry; B rendered in the
    // fresh one.
    expect(contextsOpened()).toHaveLength(2);
  }, 30_000);

  it('a navigation lost twice is a transient failure — recorded, not charged — and the batch goes on', async () => {
    const { results, halted } = await runWorker(
      [A, B],
      CAPS,
      10,
      {},
      {
        FAKE_SCRIPT: JSON.stringify({
          [A]: [{ throw: ABORTED }, { throw: 'page.goto: Page crashed' }],
        }),
      },
    );
    expect(halted).toBeNull();
    expect(results.get(A)).toEqual({
      kind: 'failed',
      reason: 'page.goto: Page crashed',
      transient: true,
    });
    expect(results.get(B)).toMatchObject({ kind: 'ok', status: 200 });
  }, 30_000);

  it("a page's own failure after a retry is charged as before", async () => {
    const { results } = await runWorker(
      [A],
      CAPS,
      10,
      {},
      {
        FAKE_SCRIPT: JSON.stringify({
          [A]: [{ throw: ABORTED }, { status: 500 }],
        }),
      },
    );
    expect(results.get(A)).toEqual({
      kind: 'failed',
      reason: 'HTTP 500 at render time',
      transient: false,
    });
  }, 30_000);

  it('a document whose download broke off is never stored as the page: retried like a crash', async () => {
    const { results } = await runWorker(
      [A],
      CAPS,
      10,
      {},
      {
        FAKE_SCRIPT: JSON.stringify({
          [A]: [{ bodyCut: 'net::ERR_ABORTED' }],
        }),
      },
    );
    expect(results.get(A)).toMatchObject({ kind: 'ok', status: 200 });
    expect(contextsOpened()).toHaveLength(2);
  }, 30_000);

  it('a browser that opens no page halts the batch after what rendered', async () => {
    const { results, halted } = await runWorker(
      [A, B, C],
      CAPS,
      10,
      {},
      {
        FAKE_NEWPAGE_FAILS_AFTER: '1',
      },
    );
    expect(results.get(A)).toMatchObject({ kind: 'ok', status: 200 });
    expect(halted).toEqual({
      reason: 'browser',
      error: 'Target page, context or browser has been closed',
    });
    expect(results.get(B)).toEqual({ kind: 'not_attempted' });
    expect(results.get(C)).toEqual({ kind: 'not_attempted' });
  }, 30_000);
});
