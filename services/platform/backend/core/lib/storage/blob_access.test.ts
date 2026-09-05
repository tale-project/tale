import { describe, expect, it } from 'vitest';

import {
  deleteBlob,
  readBlobBytes,
  UnsupportedBlobRefError,
} from './blob_access';

// Regression: a non-`s3:` ref used to fall into the Convex `_storage`
// branches, which on the 0.5 ctx shim surfaced as a `TypeError` /
// "[ctx-shim] ctx.storage.get is not available" from deep inside a lane.
// The refusal is now typed and happens before any store is resolved.
describe('blob_access — a legacy or malformed ref is refused with a typed error', () => {
  it('readBlobBytes throws UnsupportedBlobRefError for a Convex-era id', async () => {
    await expect(readBlobBytes('acme', 'kg2abc123')).rejects.toBeInstanceOf(
      UnsupportedBlobRefError,
    );
  });

  it('deleteBlob throws UnsupportedBlobRefError for a Convex-era id', async () => {
    await expect(deleteBlob('acme', 'kg2abc123')).rejects.toBeInstanceOf(
      UnsupportedBlobRefError,
    );
  });

  it('names the offending ref and stays an Error', async () => {
    const error = await readBlobBytes('acme', 'not-a-ref').catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).name).toBe('UnsupportedBlobRefError');
    expect((error as Error).message).toContain('"not-a-ref"');
  });
});
