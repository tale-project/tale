import type { Sql } from 'postgres';
import { describe, expect, it, vi } from 'vitest';

import { checkProjectTaskMetrics } from './metrics.integration.ts';
import { getProjectTaskMetrics } from './metrics.ts';

vi.mock('@tale/shared/db/serializable', () => ({
  transactSerializable: async (sql: Sql, run: (tx: Sql) => Promise<unknown>) =>
    run(sql),
}));
vi.mock('./service.ts', () => ({
  archiveTask: async () => {},
  createTask: async () => 'terminal-task',
  restoreTask: async () => {},
}));
vi.mock('./metrics.ts', () => ({ getProjectTaskMetrics: vi.fn() }));

describe('project metrics fixture cleanup', () => {
  it.each(['return', 'throw', 'archive throw'] as const)(
    'deletes all created fixture projects when metrics %s',
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
      const sql = Object.assign(tag, {
        begin: async (run: (tx: typeof tag) => Promise<unknown>) => run(tag),
        json: (value: unknown) => value,
      });
      vi.mocked(getProjectTaskMetrics).mockReset();
      if (outcome !== 'return') {
        vi.mocked(getProjectTaskMetrics).mockRejectedValue(
          new Error('metrics read failed'),
        );
      } else {
        vi.mocked(getProjectTaskMetrics).mockResolvedValue({
          daily: [],
          previousDaily: [],
        });
      }
      if (outcome === 'archive throw') {
        vi.mocked(getProjectTaskMetrics).mockResolvedValueOnce({
          daily: [],
          previousDaily: [],
        });
      }
      const run = checkProjectTaskMetrics(
        sql as unknown as Sql,
        { orgId: 'org', userId: 'user' },
        vi.fn(),
      );
      if (outcome !== 'return') {
        await expect(run).rejects.toThrow('metrics read failed');
      } else {
        await run;
      }
      const expectedProjects = outcome === 'throw' ? 2 : 3;
      expect(insertedProjects).toHaveLength(expectedProjects);
      expect(new Set(insertedProjects).size).toBe(expectedProjects);
      expect(projects.size).toBe(0);
    },
  );
});
