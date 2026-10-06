import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import { listRecentFeedbackPage } from './service.ts';

function feedbackRow(index: number, comment: string | null = 'Explanation') {
  return {
    id: `feedback-${index}`,
    threadId: 'thread-1',
    messageId: `message-${index}`,
    userId: 'user-1',
    rating: 'positive' as const,
    comment,
    metadata: null,
    agentSlug: null,
    model: 'model-1',
    provider: 'provider-1',
    createdAt: 1_700_000_000_000 - index,
  };
}

function fakeSql(rows: ReturnType<typeof feedbackRow>[]) {
  const queries: { text: string; values: unknown[] }[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('$?').replace(/\s+/g, ' ').trim();
    queries.push({ text, values });
    return Promise.resolve(
      text.includes('app.message_feedback')
        ? rows
        : [{ id: 'user-1', name: 'Reviewer' }],
    );
  };
  Object.assign(tag, { unsafe: (text: string) => text });
  return { sql: tag as unknown as Sql, queries };
}

describe('listRecentFeedbackPage — Comments only pagination', () => {
  it.each([true, false, undefined])(
    'filters comments in SQL before LIMIT (withCommentOnly=%s)',
    async (withCommentOnly) => {
      const { sql, queries } = fakeSql([]);
      await listRecentFeedbackPage(sql, 'org-1', {
        numItems: 25,
        cursor: null,
        withCommentOnly,
      });

      const query = queries[0];
      expect(query).toBeDefined();
      const predicate =
        "AND (NOT $?::boolean OR NULLIF(comment, '') IS NOT NULL)";
      expect(query?.text).toContain(predicate);
      expect(query?.text.indexOf(predicate)).toBeLessThan(
        query?.text.indexOf('ORDER BY') ?? 0,
      );
      expect(query?.values).toContain(withCommentOnly === true);
      expect(query?.values.at(-1)).toBe(26);
      expect(query?.text).toContain('WHERE org_id = $?');
      expect(query?.text).toContain(
        "lifecycle_status IS DISTINCT FROM 'trashed'",
      );
    },
  );

  it('returns an older matching comment on the first filtered page', async () => {
    const { sql } = fakeSql([feedbackRow(25)]);
    const result = await listRecentFeedbackPage(sql, 'org-1', {
      numItems: 25,
      cursor: null,
      withCommentOnly: true,
    });

    expect(result).toEqual({
      page: [
        expect.objectContaining({
          _id: 'feedback-25',
          comment: 'Explanation',
          userDisplayName: 'Reviewer',
        }),
      ],
      isDone: true,
      continueCursor: '',
    });
  });

  it('derives continuation from the last matching row, not the lookahead', async () => {
    const rows = Array.from({ length: 26 }, (_, index) => feedbackRow(index));
    const { sql } = fakeSql(rows);
    const result = await listRecentFeedbackPage(sql, 'org-1', {
      numItems: 25,
      cursor: null,
      withCommentOnly: true,
    });

    expect(result.page).toHaveLength(25);
    expect(result.isDone).toBe(false);
    expect(result.continueCursor).toBe('1699999999976|feedback-24');
  });

  it('preserves unfiltered ratings without written comments', async () => {
    const { sql } = fakeSql([feedbackRow(0, null), feedbackRow(1, '')]);
    const result = await listRecentFeedbackPage(sql, 'org-1', {
      numItems: 25,
      cursor: null,
    });

    expect(result.page).toHaveLength(2);
    expect(result.isDone).toBe(true);
  });
});
