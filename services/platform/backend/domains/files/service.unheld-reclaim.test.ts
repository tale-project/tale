// @vitest-environment node

import type { Sql } from 'postgres';
import { afterEach, expect, it, vi } from 'vitest';

import { deleteOrgObject } from '../../lib/object-store.ts';
import { deleteUnheldOrgBlobRefs } from './service.ts';

/**
 * The reclaim for a lane whose ref another row may have come to name (a
 * video link's transcript, which its paster can attach to a task or take
 * over as a document): one statement asks the ONE holder rule
 * (`blobRefHeld`) for every ref, and only the bytes nothing holds go (#4110).
 */

const { blobRefHeld } = vi.hoisted(() => ({ blobRefHeld: vi.fn() }));

// The real rule, watched: the reclaim asks it rather than a copy.
vi.mock('./blob-holders.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./blob-holders.ts')>();
  blobRefHeld.mockImplementation(actual.blobRefHeld);
  return { blobRefHeld };
});
vi.mock(import('../../lib/object-store.ts'), async (importOriginal) => ({
  ...(await importOriginal()),
  deleteOrgObject: vi.fn(() => Promise.resolve()),
}));
vi.mock('../../lib/org-config.ts', () => ({
  resolveOrgSlug: vi.fn(() => Promise.resolve('acme')),
}));

interface Statement {
  text: string;
  values: unknown[];
}

/** A recording tag that answers the holder query with `unheld`. */
function fakeSql(unheld: readonly string[]): {
  sql: Sql;
  statements: Statement[];
} {
  const statements: Statement[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    statements.push({ text, values });
    return Promise.resolve(
      text.startsWith('SELECT r.ref FROM unnest')
        ? unheld.map((ref) => ({ ref }))
        : [],
    );
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double for the postgres.js tag
  return { sql: tag as unknown as Sql, statements };
}

afterEach(() => {
  vi.clearAllMocks();
});

it('deletes only the bytes nothing holds, asking the shared rule once for every ref [FILE-R9]', async () => {
  const fake = fakeSql(['s3:blobs/acme/loose']);

  const deleted = await deleteUnheldOrgBlobRefs(fake.sql, 'org_1', [
    's3:blobs/acme/loose',
    's3:blobs/acme/held',
  ]);

  expect(deleted).toEqual(['s3:blobs/acme/loose']);
  expect(blobRefHeld).toHaveBeenCalledTimes(1);
  expect(blobRefHeld).toHaveBeenCalledWith(
    fake.sql,
    'org_1',
    expect.anything(),
  );
  const question = fake.statements.find((s) =>
    s.text.startsWith('SELECT r.ref FROM unnest'),
  );
  expect(question?.text).toContain('WHERE NOT ?');
  expect(question?.values[0]).toEqual([
    's3:blobs/acme/loose',
    's3:blobs/acme/held',
  ]);
  expect(deleteOrgObject).toHaveBeenCalledTimes(1);
  expect(deleteOrgObject).toHaveBeenCalledWith('acme', 'blobs/acme/loose');
});

it('keeps every byte something holds, and asks nothing for no refs [FILE-R9]', async () => {
  const held = fakeSql([]);
  expect(
    await deleteUnheldOrgBlobRefs(held.sql, 'org_1', ['s3:blobs/acme/held']),
  ).toEqual([]);
  expect(deleteOrgObject).not.toHaveBeenCalled();

  const none = fakeSql([]);
  expect(await deleteUnheldOrgBlobRefs(none.sql, 'org_1', [])).toEqual([]);
  expect(none.statements).toEqual([]);
});

it('keeps every byte when the holder check fails, and logs it [FILE-R9]', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  // Only the holder question fails; the fragments it is built from never
  // reach the database on their own.
  const failing = ((strings: TemplateStringsArray) =>
    strings.join('?').trim().startsWith('SELECT r.ref')
      ? Promise.reject(new Error('connection lost'))
      : Promise.resolve([])) as unknown as Sql;

  expect(
    await deleteUnheldOrgBlobRefs(failing, 'org_1', ['s3:blobs/acme/a']),
  ).toEqual([]);
  expect(deleteOrgObject).not.toHaveBeenCalled();
  expect(warn).toHaveBeenCalledWith(
    '[files] blob reclaim skipped (holder check failed):',
    expect.any(Error),
  );
  warn.mockRestore();
});
