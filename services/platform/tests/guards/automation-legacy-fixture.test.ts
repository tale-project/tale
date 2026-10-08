import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

const fixtures = new URL('../fixtures/automation-legacy-v1/', import.meta.url);
const hash = (value: string): string =>
  createHash('sha256').update(value).digest('hex');
const sectionSchema = z.strictObject({
  name: z.string(),
  start: z.number().int().nonnegative(),
  end: z.number().int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
const manifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  source: z.literal('b4931db4b48bdfde37afe1af2a1479e6640a0799'),
  files: z
    .array(
      z.strictObject({
        sourcePath: z.string(),
        blob: z.string().regex(/^[a-f0-9]{40}$/),
        rawFile: z.string().regex(/^(store|stepper|agent)\.raw\.txt$/),
        rawSha256: z.string().regex(/^[a-f0-9]{64}$/),
        moduleFile: z.string().regex(/^(store|stepper|agent)\.ts$/),
        sections: z.array(sectionSchema).min(1),
      }),
    )
    .length(3),
});

describe('retained real legacy execution bodies', () => {
  it('pins raw b493 blobs and byte-identical executable declarations', async () => {
    const manifest = manifestSchema.parse(
      JSON.parse(await readFile(new URL('provenance.json', fixtures), 'utf8')),
    );
    for (const file of manifest.files) {
      const raw = await readFile(new URL(file.rawFile, fixtures), 'utf8');
      expect(hash(raw)).toBe(file.rawSha256);
      expect(
        createHash('sha1')
          .update(`blob ${Buffer.byteLength(raw)}\0`)
          .update(raw)
          .digest('hex'),
      ).toBe(file.blob);
      const module = await readFile(new URL(file.moduleFile, fixtures), 'utf8');
      for (const section of file.sections) {
        const body = raw.slice(section.start, section.end);
        expect(hash(body)).toBe(section.sha256);
        expect(module.split(body)).toHaveLength(2);
        expect(module.replace(body, `${body.slice(0, -1)} `)).not.toContain(
          body,
        );
      }
    }
  });

  it('excludes the historical modules from production Docker context', async () => {
    const ignore = await readFile(
      new URL('../../../../.dockerignore', import.meta.url),
      'utf8',
    );
    expect(ignore.split('\n')).toContain('services/platform/tests/');
  });
});
