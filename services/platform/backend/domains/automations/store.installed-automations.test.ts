// @vitest-environment node

/**
 * The automations installed in a page of projects (#5203): list_projects
 * names them for each project it answers, and reads them for that page's
 * projects alone, in one grouped read of their bindings, instead of every
 * automation of the organization.
 */

import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import { installedAutomationNames } from './store.ts';

/** A tagged-template double that records each query's text and values and
 * answers `rows`. */
function recordingSql(rows: unknown[]) {
  const queries: { text: string; values: unknown[] }[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    queries.push({
      text: strings.join('?').replace(/\s+/g, ' ').trim(),
      values,
    });
    return Promise.resolve(rows);
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return { sql: tag as unknown as Sql, queries };
}

describe('installedAutomationNames', () => {
  it("reads the named projects' bindings in one grouped statement, of automations the organization has", async () => {
    const { sql, queries } = recordingSql([
      { projectId: 'p-1', names: ['ops/digest', 'sales/follow-up'] },
    ]);
    const installed = await installedAutomationNames(sql, 'org-1', [
      'p-1',
      'p-2',
    ]);
    expect(installed).toEqual(
      new Map([['p-1', ['ops/digest', 'sales/follow-up']]]),
    );
    expect(queries).toEqual([
      {
        text:
          'SELECT b.project_id AS "projectId", ' +
          'array_agg(b.automation_name ORDER BY b.automation_name) AS names ' +
          'FROM app.automation_project_bindings b ' +
          'WHERE b.org_id = ? AND b.project_id = ANY(?) ' +
          'AND EXISTS ( SELECT 1 FROM app.automations a ' +
          'WHERE a.org_id = b.org_id AND a.name = b.automation_name ) ' +
          'GROUP BY b.project_id',
        values: ['org-1', ['p-1', 'p-2']],
      },
    ]);
  });

  it('reads nothing for no projects', async () => {
    const { sql, queries } = recordingSql([]);
    expect(await installedAutomationNames(sql, 'org-1', [])).toEqual(new Map());
    expect(queries).toEqual([]);
  });
});
