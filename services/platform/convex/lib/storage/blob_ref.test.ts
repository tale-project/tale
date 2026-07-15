import { describe, expect, it } from 'vitest';

import {
  convexStorageId,
  encodeS3Ref,
  isS3Ref,
  parseBlobRef,
  s3KeyBelongsToOrg,
} from './blob_ref';

describe('blob_ref encoding', () => {
  it('round-trips an s3 key through encode/parse', () => {
    const parsed = parseBlobRef(encodeS3Ref('acme/123e4567'));
    expect(parsed).toEqual({ backend: 's3', key: 'acme/123e4567' });
  });

  it('treats a non-prefixed string as a Convex storage id', () => {
    const parsed = parseBlobRef('kg2abc123');
    expect(parsed.backend).toBe('convex');
    expect(isS3Ref('kg2abc123')).toBe(false);
    expect(convexStorageId('kg2abc123')).toBe('kg2abc123');
  });

  it('convexStorageId is null for s3 refs', () => {
    expect(convexStorageId('s3:acme/uuid')).toBeNull();
  });
});

describe('s3KeyBelongsToOrg (tenant-isolation guard)', () => {
  it('accepts the org own keys, with and without a prefix', () => {
    // buildObjectKey mints `[prefix/]orgSlug/uuid` — second-to-last = org.
    expect(s3KeyBelongsToOrg('acme/6f9619ff-8b86', 'acme')).toBe(true);
    expect(s3KeyBelongsToOrg('tale/prod/acme/6f9619ff', 'acme')).toBe(true);
  });

  it('refuses another org key — even inside a shared bucket namespace', () => {
    expect(s3KeyBelongsToOrg('globex/6f9619ff-8b86', 'acme')).toBe(false);
    expect(s3KeyBelongsToOrg('tale/prod/globex/6f9619ff', 'acme')).toBe(false);
  });

  it('refuses a prefix crafted to embed the victim slug in the wrong segment', () => {
    // Attacker org "globex" chose prefix "x/acme" → its keys are
    // `x/acme/globex/uuid`; the segment before the uuid is still globex.
    expect(s3KeyBelongsToOrg('x/acme/globex/6f9619ff', 'acme')).toBe(false);
    // And the victim's own key never passes for the attacker.
    expect(s3KeyBelongsToOrg('x/acme/6f9619ff', 'globex')).toBe(false);
  });

  it('refuses malformed keys: empty segments, bare uuid, empty string', () => {
    expect(s3KeyBelongsToOrg('acme//6f9619ff', 'acme')).toBe(false);
    expect(s3KeyBelongsToOrg('//acme/6f9619ff', 'acme')).toBe(false);
    expect(s3KeyBelongsToOrg('6f9619ff', 'acme')).toBe(false);
    expect(s3KeyBelongsToOrg('', 'acme')).toBe(false);
    expect(s3KeyBelongsToOrg('acme/', 'acme')).toBe(false);
  });
});
