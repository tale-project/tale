import { expect, test } from 'bun:test';

import {
  AUTOMATION_FLOOR_SQL,
  AUTOMATION_LEDGER_QUERY,
  checkedAutomationLedgerQuery,
} from './automation-floor';

test('native floor reader admits only the exact generated read-only SELECT', () => {
  expect(AUTOMATION_FLOOR_SQL).toContain(AUTOMATION_LEDGER_QUERY.slice(0, -1));
  expect(checkedAutomationLedgerQuery("SELECT 'null'::json;")).toBe(
    "SELECT 'null'::json;",
  );
  const query = `SELECT json_build_object('schema', 'tale', 'ids', coalesce(json_agg(name ORDER BY name COLLATE "C"), '[]'::json)) FROM (SELECT name FROM tale.app_migrations ORDER BY name COLLATE "C" LIMIT 2049) inventory;`;
  expect(checkedAutomationLedgerQuery(query)).toBe(query);
  for (const bad of [
    null,
    '',
    query + ' DROP TABLE app.tasks;',
    query.replace('tale.app_migrations', 'public.app_migrations'),
    query.replace('2049', '99999'),
    query.replace("'tale'", "'ta\u0027le'"),
    query.replace('json_build_object', 'set_config'),
  ])
    expect(() => checkedAutomationLedgerQuery(bad)).toThrow();
});
