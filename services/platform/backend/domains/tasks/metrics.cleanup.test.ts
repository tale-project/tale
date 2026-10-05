import type { Sql } from 'postgres';
import { describe, expect, it, vi } from 'vitest';

import { checkProjectTaskMetrics } from './metrics.integration.ts';
import { getProjectTaskMetrics } from './metrics.ts';

vi.mock('@tale/shared/db/serializable', () => ({
  transactSerializable: async (sql: Sql, run: (tx: Sql) => Promise<unknown>) =>
    run(sql),
}));
vi.mock('./service.ts', () => ({
  createTask: async () => 'terminal-task',
}));
vi.mock('./metrics.ts', () => ({ getProjectTaskMetrics: vi.fn() }));

describe('project metrics fixture cleanup', () => {
  it.each(['return', 'throw'] as const)(
    'deletes both fixture projects when metrics %s',
    async (outcome) => {
      const projects = new Set<string>();
      const insertedProjects: string[] = [];
      const tag = async (
        strings: TemplateStringsArray,
        ...values: unknown[]
      ) => {
        const query = strings.join('?');
        if (query.includes('INSERT INTO app.projects')) {
          const projectId = String(values[0]);
          projects.add(projectId);
          insertedProjects.push(projectId);
        }
        if (query.includes('DELETE FROM app.projects')) {
          projects.delete(String(values[0]));
        }
        if (query.includes('INSERT INTO app.automation_runs')) {
          return [{ id: 'automation-run' }];
        }
        if (query.includes('completed_at_ms::float8')) {
          return [{ completedAt: 1 }, { completedAt: 1 }];
        }
        return [];
      };
      const sql = Object.assign(tag, { json: (value: unknown) => value });
      vi.mocked(getProjectTaskMetrics).mockReset();
      if (outcome === 'throw') {
        vi.mocked(getProjectTaskMetrics).mockRejectedValue(
          new Error('metrics read failed'),
        );
      } else {
        vi.mocked(getProjectTaskMetrics).mockResolvedValue({
          daily: [],
          previousDaily: [],
        });
      }
      const run = checkProjectTaskMetrics(
        sql as unknown as Sql,
        { orgId: 'org', userId: 'user' },
        vi.fn(),
      );
      if (outcome === 'throw') {
        await expect(run).rejects.toThrow('metrics read failed');
      } else {
        await run;
      }
      expect(insertedProjects).toHaveLength(2);
      expect(new Set(insertedProjects).size).toBe(2);
      expect(projects.size).toBe(0);
    },
  );
});
