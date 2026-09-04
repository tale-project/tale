import { describe, expect, it } from 'vitest';

import { canonicalizeForTest } from '../../core/lib/helpers/audit_hash.ts';
import {
  buildAuditRecordHashInput,
  normalizeStoredJson,
  normalizeStoredText,
  rowToHashInput,
  toStoredAuditRecord,
  type StoredAuditRecord,
} from './hash-input.ts';
import type { AuditLogRow } from './types.ts';

/**
 * What Postgres hands back for a `text` column: the UTF-8 encoder replaces a
 * lone surrogate with U+FFFD; a NUL byte is refused outright (and with it the
 * whole INSERT). The integration check proves this against a real database;
 * here the model keeps the parity test honest.
 */
function asPostgresText(value: string): string {
  if (value.includes('\u0000')) {
    throw new Error('invalid byte sequence for encoding "UTF8": 0x00');
  }
  return Buffer.from(value, 'utf8').toString('utf8');
}

/**
 * What a `jsonb` column hands back: the serialized document parsed again.
 * `JSON.stringify` only ever emits a `\udXXX` escape for a LONE surrogate
 * (pairs are written raw), and the jsonb parser refuses both that and
 * `\u0000`.
 */
function asPostgresJsonb(
  value: Record<string, unknown>,
): Record<string, unknown> {
  const text = JSON.stringify(value);
  if (text.includes('\\u0000')) {
    throw new Error('unsupported Unicode escape sequence');
  }
  if (/\\ud[89a-f][0-9a-f]{2}/i.test(text)) {
    throw new Error('Unicode low surrogate must follow a high surrogate');
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the input was a record; JSON round-trips a record to a record
  return JSON.parse(text) as Record<string, unknown>;
}

/** The row `app.audit_logs` would hand back for a record it stored. */
function rowFromStorage(stored: StoredAuditRecord): AuditLogRow {
  const text = (value: string | undefined): string | null =>
    value === undefined ? null : asPostgresText(value);
  const json = (
    value: Record<string, unknown> | undefined,
  ): Record<string, unknown> | null =>
    value === undefined ? null : asPostgresJsonb(value);
  return {
    id: 'row-1',
    organizationId: stored.organizationId,
    actorId: asPostgresText(stored.actorId),
    actorEmail: text(stored.actorEmail),
    actorEmailHash: text(stored.actorEmailHash),
    actorRole: text(stored.actorRole),
    actorType: stored.actorType,
    action: asPostgresText(stored.action),
    category: stored.category,
    resourceType: asPostgresText(stored.resourceType),
    resourceId: text(stored.resourceId),
    resourceName: text(stored.resourceName),
    previousState: json(stored.previousState),
    newState: json(stored.newState),
    changedFields:
      stored.changedFields.length > 0
        ? stored.changedFields.map(asPostgresText)
        : null,
    sessionId: text(stored.sessionId),
    ipAddress: text(stored.ipAddress),
    actorIpHash: text(stored.actorIpHash),
    userAgent: text(stored.userAgent),
    requestId: text(stored.requestId),
    timestamp: stored.timestamp,
    status: stored.status,
    errorMessage: text(stored.errorMessage),
    metadata: json(stored.metadata),
    integrityHash: 'not-part-of-the-input',
    previousHash: null,
    piiScrubbed: null,
  };
}

const canonical = (record: Record<string, unknown>): string =>
  canonicalizeForTest(record);

const LONE_HIGH = '🎉'.slice(0, 1);
const LONE_LOW = '🎉'.slice(1);

/** A record every one of whose tricky fields a real writer can produce:
 * a `.slice()` through an emoji, binary in an error, a Date in metadata,
 * a `.map()` that yielded undefined, a 100 KB payload. */
function trickyRecord(): StoredAuditRecord {
  const sparse: unknown[] = [1];
  sparse[2] = 3;
  return {
    organizationId: 'org-1',
    actorId: 'user-1',
    actorEmail: 'zoë@example.com',
    actorType: 'user',
    action: 'itest.tricky',
    category: 'data',
    resourceType: 'document',
    resourceName:
      'quote " backslash \\ newline \n tab \t emoji 🎉 zero-width \u200B 漢字 é',
    errorMessage: `truncated at an emoji ${LONE_HIGH}`,
    previousState: {
      'we,ird"{key}': 'old',
      nested: { 'kéy 🎉': ['✓', '\u0001'] },
    },
    newState: {
      'we,ird"{key}': 'new',
      nested: { 'kéy 🎉': ['✓', '\u0002'] },
      when: new Date(0),
    },
    changedFields: ['we,ird"{key}', 'nested', 'when'],
    metadata: {
      nul: 'a\u0000b',
      lone: `${LONE_LOW} head`,
      holes: [1, undefined, 'x'],
      sparse,
      big: 'x'.repeat(100_000),
      huge: 1e21,
      negativeZero: -0,
      notANumber: Number.NaN,
      [`k${LONE_HIGH}`]: 'lone surrogate in a key',
    },
    timestamp: 1_756_900_000_000,
    status: 'failure',
  };
}

describe('normalizeStoredText', () => {
  it('replaces a lone surrogate with U+FFFD — the byte Postgres stores', () => {
    expect(normalizeStoredText(`tail ${LONE_HIGH}`)).toBe('tail \uFFFD');
    expect(normalizeStoredText(`${LONE_LOW} head`)).toBe('\uFFFD head');
    expect(normalizeStoredText(`${LONE_HIGH}${LONE_HIGH}`)).toBe(
      '\uFFFD\uFFFD',
    );
  });

  it('replaces NUL, which neither text nor jsonb can hold', () => {
    expect(normalizeStoredText('a\u0000b\u0000')).toBe('a\uFFFDb\uFFFD');
  });

  it('is the identity on every storable string', () => {
    for (const value of [
      '',
      'plain',
      'quote " backslash \\ newline \n tab \t',
      '🎉 paired emoji, 漢字, é combining, \u200B zero-width',
      '\u0001\u001F control chars',
      '\uFFFD already a replacement mark',
    ]) {
      expect(normalizeStoredText(value)).toBe(value);
    }
  });
});

describe('normalizeStoredJson', () => {
  it('yields what a jsonb column hands back', () => {
    const sparse: unknown[] = [1];
    sparse[2] = 3;
    const normalized = normalizeStoredJson({
      dropped: undefined,
      holes: [1, undefined, 'x'],
      sparse,
      when: new Date(0),
      notANumber: Number.NaN,
      infinite: Number.POSITIVE_INFINITY,
      negativeZero: -0,
      nested: { keep: 'value', gone: undefined },
    });
    expect(normalized).toStrictEqual({
      holes: [1, null, 'x'],
      sparse: [1, null, 3],
      when: '1970-01-01T00:00:00.000Z',
      notANumber: null,
      infinite: null,
      negativeZero: 0,
      nested: { keep: 'value' },
    });
  });

  it('text-normalizes keys and strings at every depth', () => {
    const normalized = normalizeStoredJson({
      [`k${LONE_HIGH}`]: { deep: [`${LONE_LOW}x`, 'a\u0000b'] },
    });
    expect(normalized).toStrictEqual({
      'k\uFFFD': { deep: ['\uFFFDx', 'a\uFFFDb'] },
    });
  });

  it('keeps a large payload intact', () => {
    const big = 'x'.repeat(100_000);
    expect(normalizeStoredJson({ big })).toStrictEqual({ big });
  });
});

describe('the writer hashes the STORED form', () => {
  it('a record hashed pre-storage cannot be rebuilt from its row (the defect)', () => {
    const raw = trickyRecord();
    // The jsonb fields refuse the INSERT outright…
    expect(() => rowFromStorage(raw)).toThrow();
    // …and a text-only lone surrogate stores as U+FFFD while the writer's
    // canonical carried the `\udXXX` escape: a false tamper verdict forever.
    const textOnly: StoredAuditRecord = {
      ...raw,
      previousState: undefined,
      newState: undefined,
      metadata: undefined,
      changedFields: [],
    };
    expect(canonical(rowToHashInput(rowFromStorage(textOnly)))).not.toBe(
      canonical(buildAuditRecordHashInput(textOnly)),
    );
  });

  it('the stored form is storable and rebuilds to the identical canonical', () => {
    const stored = toStoredAuditRecord(trickyRecord());
    const row = rowFromStorage(stored);
    expect(canonical(rowToHashInput(row))).toBe(
      canonical(buildAuditRecordHashInput(stored)),
    );
    // The normalization is visible in the row, not a no-op.
    expect(row.errorMessage).toBe('truncated at an emoji \uFFFD');
    expect(row.metadata).toMatchObject({
      nul: 'a\uFFFDb',
      lone: '\uFFFD head',
      holes: [1, null, 'x'],
      sparse: [1, null, 3],
      huge: 1e21,
      negativeZero: 0,
      notANumber: null,
      'k\uFFFD': 'lone surrogate in a key',
    });
    expect(row.newState).toMatchObject({ when: '1970-01-01T00:00:00.000Z' });
    expect(row.changedFields).toStrictEqual(['we,ird"{key}', 'nested', 'when']);
  });

  it('is the identity on a plain record — rows already written keep their hash', () => {
    const plain: StoredAuditRecord = {
      organizationId: 'org-1',
      actorId: 'user-1',
      actorEmail: 'admin@example.com',
      actorRole: 'owner',
      actorType: 'user',
      action: 'member.role_changed',
      category: 'member',
      resourceType: 'member',
      resourceId: 'user-2',
      resourceName: 'Zoë 🎉',
      previousState: { role: 'member', tags: ['a', 'b'] },
      newState: { role: 'admin', tags: ['a'] },
      changedFields: ['role', 'tags'],
      ipAddress: '203.0.113.7',
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64)',
      requestId: 'req-1',
      timestamp: 1_756_900_000_000,
      status: 'success',
      metadata: { note: 'quotes " and \\ and\nnewlines', count: 3 },
    };
    expect(
      canonical(buildAuditRecordHashInput(toStoredAuditRecord(plain))),
    ).toBe(canonical(buildAuditRecordHashInput(plain)));
    expect(canonical(rowToHashInput(rowFromStorage(plain)))).toBe(
      canonical(buildAuditRecordHashInput(plain)),
    );
  });
});
