// @vitest-environment node

/**
 * The ledger upsert is the one writer of `app.usage_ledger`. Its second
 * request on a bucket must leave a column the lane never books as NULL —
 * `0` seconds stamped on a chat bucket made the usage page read it as a
 * transcription and drop it from Top models.
 */

import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import { incrementUsageLedger } from './service.ts';

function capturingSql(): { sql: Sql; statements: string[] } {
  const statements: string[] = [];
  const tag = (strings: TemplateStringsArray) => {
    statements.push(strings.join('?'));
    return Promise.resolve([]);
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only the tag call is exercised by the ledger
  return { sql: tag as unknown as Sql, statements };
}

describe('incrementUsageLedger', () => {
  it('leaves the audio and character columns NULL when neither side books them', async () => {
    const { sql, statements } = capturingSql();
    await incrementUsageLedger(sql, {
      organizationId: 'org_1',
      userId: 'user_1',
      model: 'm',
      provider: 'p',
      inputTokens: 10,
      outputTokens: 5,
      costEstimateCents: 1,
      timestamp: Date.now(),
    });
    // One upsert per period bucket, each keeping NULL + NULL as NULL and
    // only otherwise summing with `coalesce(…, 0)`.
    expect(statements).toHaveLength(3);
    for (const text of statements) {
      expect(text).toMatch(
        /character_count =\s+CASE\s+WHEN app\.usage_ledger\.character_count IS NULL\s+AND EXCLUDED\.character_count IS NULL THEN NULL/,
      );
      expect(text).toMatch(
        /audio_duration_sec =\s+CASE\s+WHEN app\.usage_ledger\.audio_duration_sec IS NULL\s+AND EXCLUDED\.audio_duration_sec IS NULL THEN NULL/,
      );
    }
  });
});
