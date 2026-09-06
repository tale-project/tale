// @vitest-environment node

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  reachableHandlerNames,
  unansweredHandlerNames,
} from '../../lib/ctx-shim-reachability.ts';
import { crawlHandlers, SCHEDULED_CRAWL_REFS } from './service.ts';

/**
 * The EXHAUSTIVENESS gate for the crawl host's ctx dispatch — the websites
 * twin of `domains/chat/shim.test.ts` and `domains/sandbox/shim.test.ts`,
 * on the same shared walk.
 *
 * The websites service hands the reused crawl engine (`scanWebsiteImpl`,
 * `scanDueWebsitesImpl`) a ctx built from `crawlHandlers` plus a scheduler
 * that maps two scheduled refs onto pg-boss jobs. The shim fails LOUD on a
 * name it has no handler for, at the call, in production. This surface had
 * no gate, which is how six `internal.knowledge.crawl_ops.*` names and the
 * wrappers dispatching them outlived the 0.4 crawler they addressed: no
 * table ever answered them, and nothing said so.
 */

/**
 * The one module the walk excludes: `core/node_only/sandbox/session_exec.ts`.
 * The render lane (`render_fetch.ts`) imports ONLY `runStepsInSession` from
 * it, which dispatches nothing; the module's `internal.*` writes (the
 * harvest's lease bump and file-metadata row) belong to `harvestSessionOutput`,
 * which no crawl path calls. The walk is per module, so the exclusion is a
 * hole in this gate — the test below asserts both halves of the reason.
 */
const SESSION_EXEC = 'core/node_only/sandbox/session_exec.ts';

const CRAWL_DISPATCH = {
  entryPoints: ['core/knowledge/crawl_action.ts'],
  replacedModules: [SESSION_EXEC],
};

const BACKEND = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);

describe('crawlHandlers', () => {
  // The factory only closes over `sql`; no handler runs until it is called.
  const handlers = crawlHandlers({} as never);
  const answered = {
    ...handlers,
    // Scheduled, not dispatched: `crawlScheduler` maps these onto jobs.
    ...Object.fromEntries(
      Object.values(SCHEDULED_CRAWL_REFS).map((ref) => [ref, true]),
    ),
  };

  it('answers every internal function the crawl engine can reach', () => {
    expect(unansweredHandlerNames(answered, CRAWL_DISPATCH)).toEqual([]);
  });

  it('still reaches session_exec only through a function that dispatches nothing', () => {
    const renderFetch = readFileSync(
      path.join(BACKEND, 'core/node_only/sandbox/render_fetch.ts'),
      'utf8',
    );
    const imports = [
      ...renderFetch.matchAll(/import \{([^}]*)\} from '\.\/session_exec'/g),
    ]
      .flatMap((match) => (match[1] ?? '').split(','))
      .map((name) => name.trim())
      .filter((name) => name.length > 0);
    expect(imports).toEqual(['runStepsInSession']);

    const sessionExec = readFileSync(path.join(BACKEND, SESSION_EXEC), 'utf8');
    const start = sessionExec.indexOf(
      'export async function runStepsInSession(',
    );
    const end = sessionExec.indexOf('export async function', start + 1);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    // The excluded module's dispatches all live OUTSIDE the one function the
    // render lane calls; a ctx write added to it would make the exclusion
    // a real hole, and this is what says so.
    expect(sessionExec.slice(start, end)).not.toMatch(/internal\./);
  });

  it('reaches the embedder and the failure bookkeeping, not just the scan', () => {
    // A guard on the guard: if the walk stopped following the engine's
    // imports, the assertion above would pass vacuously.
    const reachable = reachableHandlerNames(CRAWL_DISPATCH);
    expect([...reachable.keys()]).toEqual(
      expect.arrayContaining([
        'websites/internal_mutations:recordScanFailure',
        'websites/internal_mutations:clearScanFailures',
        SCHEDULED_CRAWL_REFS.scanWebsite,
        SCHEDULED_CRAWL_REFS.syncWebsiteRow,
      ]),
    );
  });
});
