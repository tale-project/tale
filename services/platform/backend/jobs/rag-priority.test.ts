// @vitest-environment node

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { PRIORITY_ATTACHMENT, PRIORITY_INTERACTIVE } from './enqueue.ts';

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
 * level with an upload again. An attachment a person is still writing a
 * message or a task around is read for the assistant first, in a queue of
 * its own (`rag.read_file`), at the attachment level; the read hands the
 * file's index run on, at the attachment level when the message waits for
 * that index (a document too large to read before it) and at the
 * interactive level otherwise — and no other door takes the attachment
 * level. A read an assistant asks for while it works goes below a person's
 * attachments, and the re-read a policy save queues in the background.
 */

const BACKEND = new URL('..', import.meta.url).pathname;

/** Files a person is waiting behind, by the door they came through. */
const INTERACTIVE = new Set([
  'domains/documents/service.ts', // upload, hub create, retry
  'domains/documents/replacement.ts', // replacing a version
  'rest/v1-core.ts', // the REST retry-indexing door
  'domains/knowledge/read-text.ts', // a chat or task upload, once read
]);

/** The enqueues of an attachment a person is composing around, by the
 * function that holds them. */
const ATTACHMENT_DOORS = [
  'domains/knowledge/read-text.ts', // a read that left the file to its index
];

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
    attachment: match[0].includes('PRIORITY_ATTACHMENT'),
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

  it('ranks an attachment above every other upload [KNOW-R21]', () => {
    expect(PRIORITY_ATTACHMENT).toBeGreaterThan(PRIORITY_INTERACTIVE);
  });

  it('gives the attachment level to the attachment doors and nobody else [KNOW-R21]', () => {
    const attachmentSites = sites
      .filter((site) => site.attachment)
      .map((site) => site.file)
      .sort();

    expect(attachmentSites).toEqual([...ATTACHMENT_DOORS].sort());
  });

  it('prioritizes every door a person waits at [KNOW-R21]', () => {
    const missing = sites
      .filter((site) => INTERACTIVE.has(site.file) && !site.prioritized)
      .map((site) => site.file);

    expect(
      missing,
      `interactive enqueue(s) with no priority — an upload here queues behind any sync backlog:\n  ${missing.join('\n  ')}`,
    ).toEqual([]);
  });

  it('leaves every background source unprioritized [KNOW-R21]', () => {
    const raised = sites
      .filter((site) => !INTERACTIVE.has(site.file) && site.prioritized)
      .map((site) => site.file);

    expect(
      raised,
      `background enqueue(s) claiming interactive priority — this puts a backlog level with a person's upload again:\n  ${raised.join('\n  ')}`,
    ).toEqual([]);
  });
});

/** Every `rag.read_file` enqueue, with the level it asks for. */
const readSites = walk(BACKEND).flatMap((file) => {
  const source = readFileSync(file, 'utf8');
  return [
    ...source.matchAll(
      /addJobInTx\(\s*tx,\s*'rag\.read_file'[\s\S]{0,300}?\);/g,
    ),
  ].map((match) => ({
    file: file.slice(BACKEND.length),
    level: match[0].includes('PRIORITY_ATTACHMENT')
      ? 'attachment'
      : match[0].includes('PRIORITY_INTERACTIVE')
        ? 'interactive'
        : 'background',
  }));
});

describe('rag.read_file fetch priority', () => {
  it('reads an upload first, then what an assistant asks for, then a policy save’s re-reads [KNOW-R21]', () => {
    const levels = readSites.map((site) => `${site.level} ${site.file}`).sort();
    expect(levels).toEqual([
      // The upload door's read: a person is writing around the file.
      'attachment domains/knowledge/read-text.ts',
      // The re-read a save of the PII policy queues.
      'background domains/knowledge/service.ts',
      // A read the assistant asks for while it works.
      'interactive domains/knowledge/read-text.ts',
    ]);
  });
});
