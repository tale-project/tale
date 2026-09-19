import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import { automationShimHandlers } from '../automations/shim.ts';
import { loadAgentLanguageContext } from './agent-language.ts';

function sqlStub(rows: unknown[]) {
  const queries: Array<{ text: string; values: unknown[] }> = [];
  const call = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replace(/\s+/g, ' ');
    queries.push({ text, values });
    return Promise.resolve(
      text.includes('FROM app.automation_runs')
        ? [
            {
              taskId: 'task-1',
              taskTitleTemplate: 'Quarterly check {name}',
              projectId: 'p-1',
              name: 'quarterly-check',
            },
          ]
        : rows,
    );
  };
  return { sql: call as unknown as Sql, queries };
}

describe('agent language context', () => {
  it('loads current canonical task prose and the existing organization language setting', async () => {
    const { sql, queries } = sqlStub([
      {
        metadata: '{"defaultLocale":"de"}',
        id: 'task-1',
        title: '2026 Q1',
        description: null,
      },
    ]);
    await expect(
      loadAgentLanguageContext(sql, {
        organizationId: 'org-1',
        taskId: 'task-1',
      }),
    ).resolves.toEqual({
      defaultLocale: 'de',
      task: { id: 'task-1', title: '2026 Q1', description: null },
    });
    expect(queries[0]?.text).toContain('t.org_id = o.id');
    expect(queries[0]?.text).toContain('WHERE o.id = ?');
    expect(queries[0]?.values).toEqual(['task-1', null, null, 'org-1']);
  });

  it('does not use unrelated task data for an absent or foreign task', async () => {
    const { sql } = sqlStub([
      {
        metadata: { defaultLocale: 'fr' },
        id: null,
        title: null,
        description: null,
      },
    ]);
    await expect(
      loadAgentLanguageContext(sql, {
        organizationId: 'org-1',
        taskId: 'foreign',
      }),
    ).resolves.toEqual({ defaultLocale: 'fr', task: null });
  });

  it('keeps the existing English fallback for missing organization metadata', async () => {
    const { sql } = sqlStub([]);
    await expect(
      loadAgentLanguageContext(sql, { organizationId: 'org-1' }),
    ).resolves.toEqual({ defaultLocale: 'en', task: null });
  });

  it('resolves workflow language from the run’s task subject under the run organization', async () => {
    const { sql, queries } = sqlStub([
      {
        metadata: { defaultLocale: 'de' },
        id: 'task-1',
        title: 'Préparer les justificatifs',
        description: null,
      },
    ]);
    const handler =
      automationShimHandlers(sql)['automations/queries:getRunLanguageContext'];
    const context = await handler?.({
      organizationId: 'org-1',
      runId: 'run-1',
    });
    expect(context).toMatchObject({
      defaultLocale: 'de',
      task: { title: 'Préparer les justificatifs' },
      taskTitleTemplate: 'Quarterly check {name}',
    });
    expect(queries[0]?.text).toContain("input -> 'task' ->> 'id'");
    expect(queries[0]?.text).toContain('AND r.org_id = ?');
    expect(queries[0]?.values).toEqual(['run-1', 'org-1']);
    expect(queries[1]?.values).toEqual(['task-1', ['p-1'], ['p-1'], 'org-1']);
  });
  it('keeps an explicit empty project scope closed', async () => {
    const { sql, queries } = sqlStub([
      {
        metadata: { defaultLocale: 'de' },
        id: null,
        title: null,
        description: null,
      },
    ]);
    await expect(
      loadAgentLanguageContext(sql, {
        organizationId: 'org-1',
        taskId: 'foreign',
        projectIds: [],
      }),
    ).resolves.toEqual({ defaultLocale: 'de', task: null });
    expect(queries[0]?.text).toContain('t.project_id = ANY(?::text[])');
    expect(queries[0]?.values).toEqual(['foreign', [], [], 'org-1']);
  });
});
