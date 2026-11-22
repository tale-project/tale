import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ServerResponse } from 'node:http';
import { gzipSync } from 'node:zlib';

import {
  AGENT_TASK_DESCRIPTION,
  RUN_CODE_PROMPT,
  WORKLOAD_USERS,
  WorkloadSetupError,
  castWorkload,
  httpErrorsBetween,
  prepareWorkload,
  runCodeResult,
  runWorkload,
} from '../../src/budget/workload.ts';
import type {
  WorkloadFigures,
  WorkloadIntervals,
} from '../../src/budget/workload.ts';
import type { ReferenceFile } from '../../src/data/reference-files.ts';
import { userEmail } from '../../src/plan.ts';
import {
  type FakePlatform,
  type SeenRequest,
  fakePlan,
  startFakePlatform,
} from '../scenario/fake-platform.ts';

function file(
  fileName: string,
  contentType: string,
  size: number,
): ReferenceFile {
  return {
    fileName,
    contentType,
    bytes: new Uint8Array(size).fill(7),
    description: `${fileName} for the test`,
  };
}

const FILES = {
  spreadsheet: file(
    'reference-200x10.xlsx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    4_096,
  ),
  pdf: file('reference-report-3-pages.pdf', 'application/pdf', 2_048),
  recording: file('reference-recording-1-minutes.wav', 'audio/wav', 8_192),
};

const FAST: WorkloadIntervals = {
  pollMs: 10,
  firstTurnMs: [1, 5],
  betweenTurnsMs: [1, 5],
  turnTimeoutMs: 5_000,
  uploadTimeoutMs: 5_000,
  signInAttempts: 3,
  signInRetryMs: 5,
};

/** The app's document as the platform renders it: its `<base>` first. */
const DOCUMENT = `<!doctype html>
<html lang="en">
  <head>
    <base href="/">
    <link rel="icon" href="./favicon.ico" sizes="any" />
    <link rel="alternate" type="text/plain" href="/llms.txt" title="llms.txt" />
    <script>window.__theme = 'light';</script>
    <script type="module" crossorigin src="./assets/app-1.js"></script>
    <link rel="stylesheet" crossorigin href="./assets/app-1.css">
    <link rel="manifest" href="./manifest.webmanifest">
  </head>
  <body><div id="root"></div></body>
</html>`;

/** The app's files: the entry imports a chunk statically and a screen on
 * demand. */
const FILES_SERVED: Record<string, { type: string; body: string }> = {
  '/assets/app-1.js': {
    type: 'text/javascript',
    body: `import{a as b}from"./chunk-2.js";const s=()=>import("./screen-3.js");console.log(b,s,${'"padding",'.repeat(200)});`,
  },
  '/assets/chunk-2.js': {
    type: 'text/javascript',
    body: 'export const a=1;',
  },
  '/assets/screen-3.js': {
    type: 'text/javascript',
    body: 'export default 1;',
  },
  '/assets/app-1.css': { type: 'text/css', body: 'body{margin:0}' },
  '/favicon.ico': { type: 'image/x-icon', body: 'ico' },
  '/manifest.webmanifest': {
    type: 'application/manifest+json',
    body: '{"name":"Tale"}',
  },
};

/** An answer, gzip-coded when the request accepts it, as the edge codes
 * one: a client that does not decode it reads no JSON and no imports. */
function send(
  seen: SeenRequest,
  res: ServerResponse,
  status: number,
  type: string,
  body: string,
): true {
  res.statusCode = status;
  res.setHeader('content-type', type);
  if (String(seen.headers['accept-encoding'] ?? '').includes('gzip')) {
    res.setHeader('content-encoding', 'gzip');
    res.end(gzipSync(body));
  } else {
    res.end(body);
  }
  return true;
}

function json(
  seen: SeenRequest,
  res: ServerResponse,
  status: number,
  body: unknown,
): true {
  return send(seen, res, status, 'application/json', JSON.stringify(body));
}

/** The platform as the workload meets it: every door answers as it would. */
function answerTheWorkload(
  platform: FakePlatform,
  options: {
    documentsEnd?: string;
    runCodeStatus?: string;
    runEnds?: string;
    runHarness?: string;
    runEngine?: string;
    transcriptionEnds?: string;
    refuseFirstSignInOf?: string;
    refuseEvents?: boolean;
  } = {},
): void {
  let threads = 0;
  let uploads = 0;
  let runPolls = 0;
  let documentPolls = 0;
  let recordingPolls = 0;
  const documents: { id: string; name: string }[] = [];
  let refused = false;
  platform.overrides.push((seen: SeenRequest, res) => {
    const route = `${seen.method} ${seen.path}`;
    if (route === 'GET /') {
      res.statusCode = 302;
      res.setHeader('location', '/dashboard');
      res.end();
      return true;
    }
    if (route === 'GET /dashboard' || route === 'GET /dashboard/org-0') {
      return send(seen, res, 200, 'text/html; charset=utf-8', DOCUMENT);
    }
    const served = FILES_SERVED[seen.path];
    if (seen.method === 'GET' && served !== undefined) {
      return send(seen, res, 200, served.type, served.body);
    }
    if (route === 'GET /events' && options.refuseEvents === true) {
      return json(seen, res, 401, { error: 'unauthorized' });
    }
    if (
      route === 'POST /api/auth/sign-in/email' &&
      options.refuseFirstSignInOf !== undefined &&
      !refused &&
      seen.body.includes(options.refuseFirstSignInOf)
    ) {
      refused = true;
      res.setHeader('retry-after', '0');
      return json(seen, res, 429, { code: 'TOO_MANY_REQUESTS' });
    }
    if (route === 'POST /api/app/projects/project-0/standard-agent') {
      return json(seen, res, 200, { agentId: 'agent-standard', created: true });
    }
    if (route === 'POST /api/app/chat/threads') {
      threads += 1;
      return json(seen, res, 200, { id: `thread-${threads}` });
    }
    if (/^POST \/api\/app\/chat\/threads\/[^/]+\/messages$/.test(route)) {
      setTimeout(() => json(seen, res, 200, { status: 'completed' }), 5);
      return true;
    }
    if (/^GET \/api\/app\/chat\/threads\/[^/]+\/messages$/.test(route)) {
      return json(seen, res, 200, {
        messages: [
          { id: 'u', role: 'user', parts: [{ type: 'text', text: 'chart' }] },
          {
            id: 'a',
            role: 'assistant',
            parts: [
              {
                type: 'tool-call',
                callId: 'c1',
                capabilityId: 'run_code',
                input: {},
              },
              {
                type: 'tool-result',
                callId: 'c1',
                capabilityId: 'run_code',
                output: { status: options.runCodeStatus ?? 'ok', exitCode: 0 },
                structured: true,
              },
            ],
          },
        ],
      });
    }
    if (route === 'POST /api/app/tasks') {
      return json(seen, res, 200, { taskId: 'task-1' });
    }
    if (route === 'GET /api/app/tasks/task-1/agent-runs') {
      runPolls += 1;
      const status = runPolls < 3 ? 'running' : (options.runEnds ?? 'settled');
      return json(seen, res, 200, {
        runs: [
          {
            id: 'run-1',
            status,
            harness: options.runHarness ?? 'pi',
            engine: options.runEngine ?? 'harness',
            startedAt: Date.now() - 1000,
          },
        ],
      });
    }
    if (route === 'GET /api/app/tasks/task-1/agent-runs/latest') {
      return json(seen, res, 200, { run: { retryPending: false } });
    }
    if (route === 'POST /api/app/files/blob-upload') {
      uploads += 1;
      return json(seen, res, 200, {
        url: `${platform.url}/blob/${uploads}`,
        method: 'PUT',
        s3Ref: `s3:ref-${uploads}`,
      });
    }
    if (seen.method === 'PUT' && seen.path.startsWith('/blob/')) {
      return json(seen, res, 200, {});
    }
    if (route === 'POST /api/app/documents/from-blob-upload') {
      const body = JSON.parse(seen.body) as { fileName: string };
      const id = `doc-${documents.length + 1}`;
      documents.push({ id, name: body.fileName });
      return json(seen, res, 200, { documentId: id });
    }
    if (route === 'GET /api/app/documents/paginated') {
      documentPolls += 1;
      return json(seen, res, 200, {
        page: documents.map((document) => ({
          id: document.id,
          name: document.name,
          ragStatus:
            documentPolls < 3
              ? 'running'
              : (options.documentsEnd ?? 'completed'),
        })),
      });
    }
    if (route === 'POST /api/app/files/register') {
      return json(seen, res, 200, { fileId: 'file-1', size: 8_192 });
    }
    if (route === 'POST /api/app/files/statuses') {
      recordingPolls += 1;
      const { storageIds } = JSON.parse(seen.body) as { storageIds: string[] };
      return json(seen, res, 200, {
        statuses: storageIds.map((storageId) => ({
          storageId,
          transcriptionStatus:
            recordingPolls < 2
              ? 'running'
              : (options.transcriptionEnds ?? 'completed'),
        })),
      });
    }
    return false;
  });
}

describe('castWorkload', () => {
  test('the owner, six who chat, one who asks for a chart, ten who sign in', () => {
    const cast = castWorkload(
      fakePlan('http://127.0.0.1:1', { users: WORKLOAD_USERS }),
    );
    expect(WORKLOAD_USERS).toBe(18);
    expect(cast.owner).toBe(0);
    expect(cast.chatters).toEqual([1, 2, 3, 4, 5, 6]);
    expect(cast.charter).toBe(7);
    expect(cast.signIns).toEqual([8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);
  });

  test('an organization too small for the workload is refused, saying how to seed one', () => {
    expect(() =>
      castWorkload(fakePlan('http://127.0.0.1:1', { users: 12 })),
    ).toThrow(
      new WorkloadSetupError(
        'organization load-testrun1-o0 has 12 members; the workload needs 18 (seed --users 18 --org-size 18)',
      ),
    );
  });
});

describe('runCodeResult', () => {
  test('the run_code result a turn left, or null without one', () => {
    expect(
      runCodeResult([
        { role: 'assistant', parts: [{ type: 'text', text: 'hi' }] },
        {
          role: 'assistant',
          parts: [
            {
              type: 'tool-result',
              capabilityId: 'run_code',
              output: { status: 'error', message: 'exit code 1' },
            },
          ],
        },
      ]),
    ).toEqual({ status: 'error', message: 'exit code 1' });
    expect(runCodeResult([{ role: 'assistant', parts: [] }])).toBeNull();
  });
});

describe('httpErrorsBetween', () => {
  test('the errors recorded since the first snapshot, the most frequent first', () => {
    expect(
      httpErrorsBetween(
        { 'GET /a': { http_500: { count: 2, samples: ['old'] } } },
        {
          'GET /a': { http_500: { count: 3, samples: ['old', 'new'] } },
          'sse.events.connect': {
            http_401: { count: 4, samples: ['GET /events -> 401'] },
          },
          'GET /b': { net_ECONNRESET: { count: 1, samples: [] } },
        },
      ),
    ).toEqual([
      {
        name: 'sse.events.connect',
        kind: 'http_401',
        count: 4,
        sample: 'GET /events -> 401',
      },
      { name: 'GET /a', kind: 'http_500', count: 1, sample: 'new' },
      { name: 'GET /b', kind: 'net_ECONNRESET', count: 1, sample: null },
    ]);
  });
});

describe('the reference workload', () => {
  let platform: FakePlatform;
  let clock: number;

  beforeEach(async () => {
    platform = await startFakePlatform({ orgId: 'org-0' });
    clock = 0;
  });
  afterEach(async () => {
    await platform.close();
  });

  const prepare = () =>
    prepareWorkload({
      plan: fakePlan(platform.url, { users: WORKLOAD_USERS }),
      target: platform.url,
      harness: 'pi',
      files: FILES,
      log: () => {},
    });

  const requestsTo = (pattern: RegExp): SeenRequest[] =>
    platform.requests.filter((seen) =>
      pattern.test(`${seen.method} ${seen.path}`),
    );

  /** Run the whole workload against the fake platform. */
  const run = async (
    intervals: Partial<WorkloadIntervals> = {},
    deadlineMs = 20_000,
  ): Promise<WorkloadFigures> => {
    const prepared = await prepare();
    try {
      return await runWorkload(prepared, {
        clock: () => {
          clock += 1;
          return clock;
        },
        deadlineMs,
        intervals: { ...FAST, ...intervals },
        log: () => {},
      });
    } finally {
      await prepared.close();
    }
  };

  const byKey = (figures: WorkloadFigures) =>
    new Map(figures.parts.map((part) => [part.key, part]));

  test('the setup pins the standard agent to pi and signs in the seven who chat', async () => {
    answerTheWorkload(platform);
    const prepared = await prepare();
    try {
      const pin = requestsTo(
        /^POST \/api\/app\/governance\/policies\/standard_agent$/,
      );
      expect(pin).toHaveLength(1);
      expect(JSON.parse(pin[0]?.body ?? '{}')).toEqual({
        config: {
          enabled: true,
          harness: 'pi',
          providerSlug: 'loadmock',
          modelId: 'load-chat-fast',
        },
      });
      expect(prepared.agentId).toBe('agent-standard');
      // The owner and the seven: no one of the ten has signed in yet.
      expect(requestsTo(/^POST \/api\/auth\/sign-in\/email$/)).toHaveLength(8);
    } finally {
      await prepared.close();
    }
  });

  test('every part runs at once and ends; the ten sign in once the documents are handed over', async () => {
    const plan = fakePlan(platform.url, { users: WORKLOAD_USERS });
    answerTheWorkload(platform, { refuseFirstSignInOf: userEmail(plan, 12) });
    const figures = await run();
    expect(figures.timedOut).toBe(false);
    expect(
      figures.parts.map((part) => [
        part.key,
        part.completed,
        part.expected,
        part.outcome,
      ]),
    ).toEqual([
      ['chat', 24, 24, 'completed'],
      ['run-code', 1, 1, 'completed'],
      ['agent-task', 1, 1, 'completed'],
      ['documents', 2, 2, 'completed'],
      ['transcription', 1, 1, 'completed'],
      ['sign-ins', 10, 10, 'completed'],
    ]);
    for (const part of figures.parts) {
      expect(part.startedAtMs).not.toBeNull();
      expect(part.endedAtMs).toBeGreaterThanOrEqual(part.startedAtMs ?? 0);
    }

    // Six conversations of four turns, and the chart's own turn.
    expect(requestsTo(/^POST \/api\/app\/chat\/threads$/)).toHaveLength(7);
    const sends = requestsTo(
      /^POST \/api\/app\/chat\/threads\/[^/]+\/messages$/,
    );
    expect(sends).toHaveLength(25);
    expect(
      sends.filter((seen) => seen.body.includes('[[mock:run-code]]')),
    ).toHaveLength(1);
    expect(
      JSON.parse(
        sends.find((seen) => seen.body.includes('run-code'))?.body ?? '{}',
      ).text,
    ).toBe(RUN_CODE_PROMPT);
    // The task went to the standard agent, in progress, with its directive.
    const task = JSON.parse(
      requestsTo(/^POST \/api\/app\/tasks$/)[0]?.body ?? '{}',
    );
    expect(task).toMatchObject({
      projectId: 'project-0',
      status: 'in_progress',
      assigneeType: 'agent',
      assigneeId: 'agent-standard',
      description: AGENT_TASK_DESCRIPTION,
    });
    expect(
      figures.facts.some((fact) =>
        fact.includes('the last settled on pi (harness engine)'),
      ),
    ).toBe(true);
    // Three uploads: both documents, then their binding, and the recording.
    const puts = requestsTo(/^PUT \/blob\//);
    expect(puts.map((seen) => seen.headers['content-type']).sort()).toEqual([
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'audio/wav',
    ]);
    expect(puts.map((seen) => seen.body.length).sort((a, b) => a - b)).toEqual([
      2_048, 4_096, 8_192,
    ]);
    const register = JSON.parse(
      requestsTo(/^POST \/api\/app\/files\/register$/)[0]?.body ?? '{}',
    );
    expect(register.contentType).toBe('audio/wav');
    expect(register.fileName).toEndWith('-reference-recording-1-minutes.wav');
    // The ten sign in after both documents were bound; one was asked again.
    const signIns = platform.requests
      .map((seen, index) => ({ seen, index }))
      .filter(({ seen }) => seen.path === '/api/auth/sign-in/email')
      .slice(8);
    expect(signIns).toHaveLength(11);
    const lastBind = platform.requests.findLastIndex(
      (seen) => seen.path === '/api/app/documents/from-blob-upload',
    );
    expect(signIns.every(({ index }) => index > lastBind)).toBe(true);
    expect(
      figures.facts.some((fact) => fact.includes('after 1 refusal for load')),
    ).toBe(true);
    // Every person held the app's event stream; all are closed at the end.
    expect(requestsTo(/^GET \/events$/)).toHaveLength(7);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(platform.openStreams()).toBe(0);
    // The one refusal for load is the run's only HTTP error.
    expect(figures.httpErrors).toEqual([
      {
        name: 'POST /api/auth/sign-in/email',
        kind: 'http_429',
        count: 1,
        sample:
          'POST /api/auth/sign-in/email -> 429: {"code":"TOO_MANY_REQUESTS"}',
      },
    ]);
  });

  test('each person opens the app as a browser does before chatting', async () => {
    answerTheWorkload(platform);
    const figures = await run();
    // The six and the person asking for a chart: the start page (sent on to
    // the dashboard), their organization's dashboard, and each file the
    // document names once, the entry's static import included, the screen
    // it imports on demand and the alternate link left out.
    const count = (path: string): number =>
      platform.requests.filter((seen) => seen.path === path).length;
    expect(count('/')).toBe(7);
    expect(count('/dashboard')).toBe(7);
    expect(count('/dashboard/org-0')).toBe(7);
    for (const path of [
      '/assets/app-1.js',
      '/assets/chunk-2.js',
      '/assets/app-1.css',
      '/favicon.ico',
      '/manifest.webmanifest',
    ]) {
      expect([path, count(path)]).toEqual([path, 7]);
    }
    expect(count('/assets/screen-3.js')).toBe(0);
    expect(count('/llms.txt')).toBe(0);
    // The dashboard's reads and Home's, once for each of them.
    for (const path of [
      '/api/app/two-factor/status',
      '/api/app/users/password-expiry',
      '/api/app/users/me',
      '/api/app/organizations',
      '/api/app/users/last-active-org',
      '/api/app/members/me',
      '/api/app/teams/mine',
      '/api/app/user-preferences',
      '/api/app/automations/listing',
      '/api/app/chat/composer/models',
      '/api/app/conversations/api-sources',
    ]) {
      expect([path, count(path)]).toEqual([path, 7]);
    }
    // A person reads Home before starting their conversation.
    const firstThread = platform.requests.findIndex(
      (seen) => seen.method === 'POST' && seen.path === '/api/app/chat/threads',
    );
    const firstHomeRead = platform.requests.findIndex(
      (seen) => seen.path === '/api/app/chat/composer/models',
    );
    expect(firstHomeRead).toBeGreaterThan(-1);
    expect(firstHomeRead).toBeLessThan(firstThread);
    // Each: `/` and where it sends them, five files, their dashboard's page.
    expect(
      figures.facts.some((fact) =>
        fact.startsWith('7 people opened the app: 56 pages and files'),
      ),
    ).toBe(true);
    expect(figures.parts.every((part) => part.outcome === 'completed')).toBe(
      true,
    );
  });

  test('every request and every event stream carries a browser’s Accept-Encoding', async () => {
    answerTheWorkload(platform);
    await run();
    const browser = 'gzip, deflate, br, zstd';
    const without = platform.requests.filter(
      (seen) => seen.headers['accept-encoding'] !== browser,
    );
    expect(without.map((seen) => `${seen.method} ${seen.path}`)).toEqual([]);
    const streams = requestsTo(
      /^GET (\/events|\/api\/app\/chat\/threads\/[^/]+\/stream)$/,
    );
    expect(streams.length).toBeGreaterThanOrEqual(14);
    expect(
      streams.every(
        (seen) =>
          seen.headers['accept-encoding'] === browser &&
          seen.headers.accept === 'text/event-stream',
      ),
    ).toBe(true);
  });

  test('the six converse at the same time, and both documents are on their way before either is bound', async () => {
    answerTheWorkload(platform);
    await run({ betweenTurnsMs: [20, 30] });
    // Every conversation's first turn is sent before any conversation's
    // last: all six are under way at one moment.
    const turns = new Map<string, number[]>();
    for (const [index, seen] of platform.requests.entries()) {
      const thread = /^\/api\/app\/chat\/threads\/([^/]+)\/messages$/.exec(
        seen.path,
      )?.[1];
      if (
        seen.method !== 'POST' ||
        thread === undefined ||
        seen.body.includes('[[mock:run-code]]')
      ) {
        continue;
      }
      turns.set(thread, [...(turns.get(thread) ?? []), index]);
    }
    expect(turns.size).toBe(6);
    const firsts = [...turns.values()].map((indexes) => Math.min(...indexes));
    const lasts = [...turns.values()].map((indexes) => Math.max(...indexes));
    expect(Math.max(...firsts)).toBeLessThan(Math.min(...lasts));
    // Both documents' uploads begin before the first is bound.
    const firstBind = platform.requests.findIndex(
      (seen) => seen.path === '/api/app/documents/from-blob-upload',
    );
    const documentTickets = platform.requests
      .slice(0, firstBind)
      .filter(
        (seen) =>
          seen.path === '/api/app/files/blob-upload' &&
          !seen.body.includes('audio/wav'),
      );
    expect(documentTickets).toHaveLength(2);
  });

  test('a part that falls short says why; one still open at the deadline timed out', async () => {
    answerTheWorkload(platform, {
      documentsEnd: 'running',
      runCodeStatus: 'error',
      runEnds: 'failed',
    });
    // Long enough for the six to chat to their end, not for an index that
    // never finishes.
    const figures = await run({}, 4_000);
    expect(figures.timedOut).toBe(true);
    const parts = byKey(figures);
    expect(parts.get('documents')?.outcome).toBe('timed-out');
    // In the order the two uploads, under way together, were bound.
    expect(parts.get('documents')?.details.toSorted()).toEqual([
      'reference-200x10.xlsx was still being indexed at the deadline',
      'reference-report-3-pages.pdf was still being indexed at the deadline',
    ]);
    expect(parts.get('run-code')?.outcome).toBe('failed');
    expect(parts.get('run-code')?.details).toEqual([
      'run_code answered error: no message',
    ]);
    expect(parts.get('agent-task')?.details).toEqual(['the run ended failed']);
    expect(parts.get('chat')?.outcome).toBe('completed');
  });

  test('a transcription that ends skipped did not transcribe', async () => {
    answerTheWorkload(platform, { transcriptionEnds: 'skipped' });
    const part = byKey(await run()).get('transcription');
    expect(part?.completed).toBe(0);
    expect(part?.outcome).toBe('failed');
    expect(part?.details).toEqual(['the transcription ended skipped']);
  });

  test('a standard-agent run on another runtime, or on the native engine, is not the task the workload names', async () => {
    answerTheWorkload(platform, { runHarness: 'claude-code' });
    const other = byKey(await run()).get('agent-task');
    expect(other?.completed).toBe(0);
    expect(other?.outcome).toBe('failed');
    expect(other?.details).toEqual([
      'the run settled on claude-code with the harness engine, not on pi with the harness engine',
    ]);
  });

  test('a run of the native engine fails the task too', async () => {
    answerTheWorkload(platform, { runEngine: 'native' });
    const native = byKey(await run()).get('agent-task');
    expect(native?.outcome).toBe('failed');
    expect(native?.details).toEqual([
      'the run settled on pi with the native engine, not on pi with the harness engine',
    ]);
  });

  test('an event stream the deployment refuses fails the chat, and the HTTP errors count it', async () => {
    answerTheWorkload(platform, { refuseEvents: true });
    const figures = await run();
    const chat = byKey(figures).get('chat');
    // Every turn went through, yet the people never held the app's stream.
    expect(chat?.completed).toBe(24);
    expect(chat?.outcome).toBe('failed');
    expect(chat?.details).toHaveLength(6);
    expect(chat?.details[0]).toMatch(
      /^person \d: the app's event stream ended for good: refused_401$/,
    );
    expect(byKey(figures).get('run-code')?.outcome).toBe('failed');
    expect(figures.httpErrors).toContainEqual(
      expect.objectContaining({
        name: 'sse.events.connect',
        kind: 'http_401',
        count: 7,
      }),
    );
  });
});
