/**
 * An uploaded image has no text extractor today (the vision seam is retired),
 * so its indexing outcome must be the honest, terminal 'unsupported' — never
 * 'failed', whose badge offers a retry that can only fail again.
 */

import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import { indexUploadedFile } from './service.ts';

interface Query {
  text: string;
  values: unknown[];
}

function fakeSql(fileName: string, log: Query[]): Sql {
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('$');
    log.push({ text, values });
    if (text.includes('FROM app.file_metadata WHERE id')) {
      return Promise.resolve([
        {
          organizationId: 'org-1',
          storageRef: 's3:org-1/blob-1',
          fileName,
          contentType: 'application/octet-stream',
          documentId: null,
          skipRagIndexing: null,
        },
      ]);
    }
    if (text.includes('FROM "organization"')) {
      return Promise.resolve([{ slug: 'acme' }]);
    }
    if (text.includes('UPDATE app.file_metadata')) {
      return Promise.resolve([{ orgId: 'org-1' }]);
    }
    return Promise.resolve([]);
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return Object.assign(tag, { unsafe: (t: string) => t }) as unknown as Sql;
}

const statusWrites = (log: Query[]): unknown[][] =>
  log
    .filter((q) => q.text.includes('UPDATE app.file_metadata'))
    .map((q) => q.values);

describe('indexUploadedFile — images', () => {
  it("marks an image 'unsupported' up front, never 'failed'", async () => {
    const log: Query[] = [];
    await indexUploadedFile(fakeSql('photo.png', log), 'file-1');

    const writes = statusWrites(log);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain('unsupported');
    expect(JSON.stringify(writes[0])).toMatch(/vision/i);
    expect(JSON.stringify(writes)).not.toContain('failed');
    // Decided from the name alone: no 'running' pass, no blob fetch.
    expect(JSON.stringify(writes)).not.toContain('Extracting text');
  });

  it('still sends a text document down the extraction path', async () => {
    const log: Query[] = [];
    // Past the status write this reaches the (unfaked) object store; the
    // outcome of that is not under test here — only that the image branch
    // did not swallow a non-image.
    await indexUploadedFile(fakeSql('notes.txt', log), 'file-2').catch(
      () => undefined,
    );
    const first = statusWrites(log)[0];
    expect(first).toContain('running');
    expect(first).toContain('Extracting text…');
  });
});
