// @vitest-environment node

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { PRIORITY_INTERACTIVE } from './enqueue.ts';

/**
 * `rag.index_file` is one queue for every source. pg-boss fetches
 * `priority DESC, created_on`, so a background source that mints rows faster
 * than they drain sits ahead of a person's upload for as long as it runs —
 * the 0.5 shape of the starvation #2985 caused on 0.4 through a shared cap.
 *
 * The fix is one field per call site, which makes it exactly the kind of
 * thing a new call site forgets. So the split is asserted from the source:
 * the doors a person waits at carry the priority, and the background sources
 * carry none — a background enqueue that took it would put a sync backlog
 * level with an upload again.
 */

const BACKEND = new URL('..', import.meta.url).pathname;

/** Files a person is waiting behind, by the door they came through. */
const INTERACTIVE = new Set([
  'domains/documents/service.ts', // upload, hub create, retry
  'domains/documents/replacement.ts', // replacing a version
  'rest/v1-core.ts', // the REST retry-indexing door
]);

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.isFile() && full.endsWith('.ts') && !full.includes('.test.')
      ? [full]
      : [];
  });
}

/** Every `rag.index_file` enqueue, with whether it asks for priority. */
const sites = walk(BACKEND).flatMap((file) => {
  const source = readFileSync(file, 'utf8');
  return [
    ...source.matchAll(
      /addJobInTx\(\s*tx,\s*'rag\.index_file'[\s\S]{0,200}?\);/g,
    ),
  ].map((match) => ({
    file: file.slice(BACKEND.length),
    prioritized: match[0].includes('PRIORITY_INTERACTIVE'),
  }));
});

describe('rag.index_file fetch priority', () => {
  // A pattern that stops matching would make every assertion below vacuous.
  it('finds the enqueue sites', () => {
    expect(sites.length).toBeGreaterThanOrEqual(10);
  });

  it('is a positive level, so it outranks an unset background job', () => {
    // pg-boss defaults an unset priority to 0 and orders DESC.
    expect(PRIORITY_INTERACTIVE).toBeGreaterThan(0);
  });

  it('prioritizes every door a person waits at', () => {
    const missing = sites
      .filter((site) => INTERACTIVE.has(site.file) && !site.prioritized)
      .map((site) => site.file);

    expect(
      missing,
      `interactive enqueue(s) with no priority — an upload here queues behind any sync backlog:\n  ${missing.join('\n  ')}`,
    ).toEqual([]);
  });

  it('leaves every background source unprioritized', () => {
    const raised = sites
      .filter((site) => !INTERACTIVE.has(site.file) && site.prioritized)
      .map((site) => site.file);

    expect(
      raised,
      `background enqueue(s) claiming interactive priority — this puts a backlog level with a person's upload again:\n  ${raised.join('\n  ')}`,
    ).toEqual([]);
  });
});
