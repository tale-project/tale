// Regression: transformDocumentsBatch must resolve an `s3:` blob ref to the
// `/storage?ref=…&org=…` serve URL, NOT call ctx.storage.getUrl on it. Passing
// an `s3:` string to ctx.storage.getUrl throws "Invalid storage ID", which
// crashed the ENTIRE Documents list query for any org with a BYO-S3 document
// (i.e. the moment the org-data-residency panel's own S3 uploads landed).

import { convexTest, type TestConvex } from 'convex-test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import schema from '../schema';
import { transformDocumentsBatch } from './transform_to_document_item';

const TEST_DIR_FROM_CONVEX_ROOT = 'documents';
function toConvexRootKey(globKey: string): string {
  const stack: string[] = [];
  for (const part of `${TEST_DIR_FROM_CONVEX_ROOT}/${globKey}`.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  return stack.join('/');
}
const rawModules = import.meta.glob('../**/*.*s');
const modules: Record<string, () => Promise<unknown>> = {};
for (const [key, loader] of Object.entries(rawModules)) {
  modules[toConvexRootKey(key)] = loader;
}

type T = TestConvex<typeof schema>;

let priorSiteUrl: string | undefined;
beforeEach(() => {
  priorSiteUrl = process.env.SITE_URL;
  process.env.SITE_URL = 'https://tale.example';
});
afterEach(() => {
  if (priorSiteUrl === undefined) delete process.env.SITE_URL;
  else process.env.SITE_URL = priorSiteUrl;
});

describe('transformDocumentsBatch — S3 blob ref', () => {
  it('resolves an s3: fileId to the /storage serve URL without crashing', async () => {
    const t: T = convexTest(schema, modules);

    const key = 's3:org_x/11111111-1111-1111-1111-111111111111';
    const docId = await t.run(async (ctx) =>
      ctx.db.insert('documents', {
        organizationId: 'org_x',
        title: 'byo.txt',
        fileId: key,
        mimeType: 'text/plain',
      }),
    );

    const items = await t.run(async (ctx) => {
      const doc = await ctx.db.get(docId);
      if (!doc) throw new Error('seeded document not found');
      return transformDocumentsBatch(ctx, [doc]);
    });

    expect(items).toHaveLength(1);
    // The serve URL routes through the node /storage route with the org param;
    // it must NOT be a raw _storage URL and must NOT have thrown.
    expect(items[0].url).toContain('/storage?ref=');
    expect(items[0].url).toContain('org=org_x');
  });
});
