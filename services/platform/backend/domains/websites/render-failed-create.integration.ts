/**
 * The crawler render lane's failed creates, over real Postgres: a batch whose
 * sandbox create fails runs through the crawl host's own ctx shim
 * (`crawlHandlers`) against a stub spawner, and its row must end where the
 * sandbox watchdog's COLLECT pass reaches it — `failed`, `destroyed_at_ms`
 * unset — instead of `destroyed`, which hid it from every pass. An outright
 * failure asks the spawner for an idle-only destroy first; a duplicate (409)
 * destroys nothing. The COLLECT pass then settles both rows.
 */
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';

import type { Sql } from 'postgres';

import type { ActionCtx } from '../../core/lib/ctx.ts';
import { renderUrlsInSandbox } from '../../core/node_only/sandbox/render_fetch.ts';
import { sessionIdForRender } from '../../core/sandbox/session_naming.ts';
import { createCtxShim } from '../../lib/ctx-shim.ts';
import { runSandboxWatchdog } from '../sandbox/watchdogs.ts';
import { crawlHandlers } from './service.ts';

function overrideEnv(vars: Record<string, string>): () => void {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(vars)) {
    previous.set(key, process.env[key]);
    process.env[key] = value;
  }
  return () => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

interface SessionRow {
  sessionId: string;
  status: string;
  destroyedAt: number | null;
}

export async function checkRenderFailedCreate(
  sql: Sql,
  ctx: { orgId: string },
  record: (name: string, ok: boolean, detail: string) => void,
): Promise<void> {
  // A private org scope: the render budget and the rows are this probe's.
  const orgId = `${ctx.orgId}:render:${randomUUID()}`;
  const failedKey = `itest-render-failed-${randomUUID()}`;
  const duplicateKey = `itest-render-duplicate-${randomUUID()}`;
  const failedId = sessionIdForRender(failedKey);
  const duplicateId = sessionIdForRender(duplicateKey);
  let createStatus = 500;
  const deletes: string[] = [];
  const spawner = createServer((req, res) => {
    req.resume();
    res.setHeader('content-type', 'application/json');
    const url = new URL(req.url ?? '/', 'http://spawner');
    if (req.method === 'POST' && url.pathname === '/v1/sessions') {
      res.statusCode = createStatus;
      res.end(
        JSON.stringify({
          error: createStatus === 409 ? 'duplicate' : 'runnerd not ready',
        }),
      );
      return;
    }
    const session = /^\/v1\/sessions\/([^/]+)$/.exec(url.pathname);
    if (req.method === 'DELETE' && session?.[1]) {
      deletes.push(`${decodeURIComponent(session[1])}${url.search}`);
      res.end(JSON.stringify({ destroyed: true, busy: false }));
      return;
    }
    res.statusCode = 404;
    res.end('{"error":"not_found"}');
  });
  await new Promise<void>((resolve) => {
    spawner.listen(0, '127.0.0.1', resolve);
  });
  const address = spawner.address();
  const port =
    address !== null && typeof address === 'object' ? address.port : 0;
  const restoreEnv = overrideEnv({
    SANDBOX_URL: `http://127.0.0.1:${port}`,
    SANDBOX_TOKEN: `itest-render-${randomUUID()}`,
  });

  try {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the crawl host hands the render lane exactly this shim (`crawlCtx`)
    const crawlCtx = createCtxShim(crawlHandlers(sql)) as unknown as ActionCtx;
    const render = (batchKey: string): Promise<string> =>
      renderUrlsInSandbox(crawlCtx, {
        organizationId: orgId,
        urls: ['https://render.example/a'],
        batchKey,
        execTimeoutMs: 120_000,
      }).then(
        () => 'resolved',
        (error: unknown) => (error instanceof Error ? error.name : 'thrown'),
      );
    const readRows = () => sql<SessionRow[]>`
      SELECT session_id AS "sessionId", status,
             destroyed_at_ms::float8 AS "destroyedAt"
      FROM app.sandbox_sessions
      WHERE org_id = ${orgId}
      ORDER BY session_id
    `;
    const describeRows = (rows: readonly SessionRow[]) =>
      rows
        .map(
          (r) =>
            `${r.sessionId === failedId ? 'failed-create' : 'duplicate'}=${r.status}/${r.destroyedAt === null ? 'unstamped' : 'stamped'}`,
        )
        .join(' ');
    const unstampedFailed = (rows: readonly SessionRow[], sessionId: string) =>
      rows.some(
        (r) =>
          r.sessionId === sessionId &&
          r.status === 'failed' &&
          r.destroyedAt === null,
      );

    createStatus = 500;
    const failedOutcome = await render(failedKey);
    createStatus = 409;
    const duplicateOutcome = await render(duplicateKey);
    const settled = await readRows();
    record(
      'render lane: a failed create destroys what the spawner holds, idle only, and a duplicate destroys nothing — both rows read failed, unstamped',
      failedOutcome === 'Error' &&
        duplicateOutcome === 'SessionDuplicateError' &&
        deletes.length === 1 &&
        deletes[0] === `${failedId}?if_idle=1` &&
        settled.length === 2 &&
        unstampedFailed(settled, failedId) &&
        unstampedFailed(settled, duplicateId),
      `outcomes=${failedOutcome},${duplicateOutcome} deletes=${deletes.join(',') || 'none'} rows=${describeRows(settled)}`,
    );

    // The COLLECT pass reaches both rows. Its scripted spawner answers busy
    // for every other session, so rows other lanes left are not disturbed.
    const asked: string[] = [];
    const collectSpawner = {
      isAlive: (): Promise<boolean> => Promise.resolve(true),
      destroyIfIdle: (
        sessionId: string,
      ): Promise<{ destroyed: boolean; busy: boolean }> => {
        asked.push(sessionId);
        return Promise.resolve(
          sessionId === failedId || sessionId === duplicateId
            ? { destroyed: sessionId === duplicateId, busy: false }
            : { destroyed: false, busy: true },
        );
      },
    };
    let collected = await readRows();
    let passes = 0;
    while (collected.some((r) => r.destroyedAt === null) && passes < 8) {
      await runSandboxWatchdog(sql, {
        collectGraceMs: 0,
        collectBatch: 50,
        spawner: collectSpawner,
      });
      passes += 1;
      collected = await readRows();
    }
    record(
      'render lane: the watchdog COLLECT pass settles a failed render create and a duplicate, keeping failed',
      asked.includes(failedId) &&
        asked.includes(duplicateId) &&
        collected.length === 2 &&
        collected.every((r) => r.status === 'failed' && r.destroyedAt !== null),
      `passes=${passes} asked=${[...new Set(asked)].filter((id) => id === failedId || id === duplicateId).length}/2 rows=${describeRows(collected)}`,
    );
  } finally {
    restoreEnv();
    await new Promise<void>((resolve) => {
      spawner.close(() => resolve());
    });
  }
}
