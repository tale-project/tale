// @vitest-environment node

/**
 * The ledger upsert is the one writer of `app.usage_ledger`. Its second
 * request on a bucket must leave a column the lane never books as NULL —
 * `0` seconds stamped on a chat bucket made the usage page read it as a
 * transcription and drop it from Top models.
 */

import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import { incrementUsageLedger, recordConnectorUsage } from './service.ts';

function capturingSql(): {
  sql: Sql;
  statements: string[];
  bindings: unknown[][];
} {
  const statements: string[] = [];
  const bindings: unknown[][] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    statements.push(strings.join('?'));
    bindings.push(values);
    return Promise.resolve([]);
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only the tag call is exercised by the ledger
  return { sql: tag as unknown as Sql, statements, bindings };
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

  it('books spend in a project into the project’s own buckets too [GOV-R14]', async () => {
    const { sql, statements, bindings } = capturingSql();
    const timestamp = Date.UTC(2026, 9, 7, 12);
    await incrementUsageLedger(sql, {
      organizationId: 'org_1',
      userId: 'user_1',
      inputTokens: 10,
      outputTokens: 5,
      costEstimateCents: 3,
      timestamp,
      projectIds: ['project_1'],
    });
    const project = statements.flatMap((text, index) =>
      text.includes('INSERT INTO app.project_usage') ? [index] : [],
    );
    // One project bucket per period, beside each ledger bucket.
    expect(statements).toHaveLength(6);
    expect(project).toHaveLength(3);
    expect(project.map((index) => bindings[index]?.slice(0, 4))).toEqual([
      ['org_1', 'project_1', 'daily', '2026-10-07'],
      ['org_1', 'project_1', 'weekly', '2026-W41'],
      ['org_1', 'project_1', 'monthly', '2026-10'],
    ]);
    expect(bindings[project[0] ?? -1]?.slice(4, 8)).toEqual([10, 5, 15, 3]);
  });

  it('books spend outside a project into the ledger alone', async () => {
    const { sql, statements } = capturingSql();
    await incrementUsageLedger(sql, {
      organizationId: 'org_1',
      userId: 'user_1',
      inputTokens: 1,
      outputTokens: 1,
      costEstimateCents: 1,
      timestamp: Date.now(),
    });
    expect(statements.some((text) => text.includes('app.project_usage'))).toBe(
      false,
    );
  });

  it('books spend in several projects into each project’s buckets [GOV-R14]', async () => {
    const { sql, statements, bindings } = capturingSql();
    await incrementUsageLedger(sql, {
      organizationId: 'org_1',
      userId: '__automation__',
      inputTokens: 1,
      outputTokens: 1,
      costEstimateCents: 2,
      timestamp: Date.UTC(2026, 9, 7, 12),
      projectIds: ['project_1', 'project_2', 'project_1'],
    });
    const booked = statements.flatMap((text, index) =>
      text.includes('INSERT INTO app.project_usage')
        ? [String(bindings[index]?.[1])]
        : [],
    );
    // Three periods for each project, a repeated id booked once.
    expect(booked.toSorted()).toEqual([
      'project_1',
      'project_1',
      'project_1',
      'project_2',
      'project_2',
      'project_2',
    ]);
  });

  it('counts a connector call as one, never as a model request [GOV-R15]', async () => {
    const { sql, statements, bindings } = capturingSql();
    await recordConnectorUsage(sql, {
      organizationId: 'org_1',
      userId: 'user_1',
      agentSlug: 'invoices/monthly',
      apiKeyId: 'key_1',
      connectorName: 'gmail',
      connectorOperation: 'send_message',
      costEstimateCents: 0,
      timestamp: Date.UTC(2026, 9, 8, 12),
      projectIds: ['project_1'],
    });

    // The three ledger buckets alone: a project's buckets count requests,
    // tokens and cost, and a connector call adds none of them.
    expect(statements).toHaveLength(3);
    for (const [index, text] of statements.entries()) {
      expect(text).toContain('INSERT INTO app.usage_ledger');
      expect(text).toContain(
        'request_count = app.usage_ledger.request_count + EXCLUDED.request_count',
      );
      const values = bindings[index] ?? [];
      // api_key_id, connector_name, connector_operation …
      expect(values.slice(8, 11)).toEqual(['key_1', 'gmail', 'send_message']);
      // … request_count 0, connector_call_count 1.
      expect(values.slice(15, 17)).toEqual([0, 1]);
    }
  });

  it('books a model call as one request by default', async () => {
    const { sql, bindings } = capturingSql();
    await incrementUsageLedger(sql, {
      organizationId: 'org_1',
      userId: 'user_1',
      inputTokens: 1,
      outputTokens: 1,
      costEstimateCents: 1,
      timestamp: Date.now(),
    });
    // request_count 1, connector_call_count 0.
    expect(bindings[0]?.slice(15, 17)).toEqual([1, 0]);
  });
});
