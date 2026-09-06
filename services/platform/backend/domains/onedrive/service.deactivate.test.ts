// @vitest-environment node

/**
 * A cancel (or a hub-folder delete / a trash of a directly-selected file)
 * that lands while a run is in flight refuses that run's final stamp, so
 * the row used to keep `last_sync_status = 'running'` for good: the listing
 * showed a running inactive config, and re-activating it sat behind the
 * claim fence until the stamp was 30 minutes stale. Every deactivation
 * settles the marker, and a reactivation starts a fresh lifecycle.
 */

import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import {
  cancelSyncConfigRow,
  deactivateSyncConfigsForPath,
  stopSyncForTrashedDocument,
  upsertSyncConfigRow,
} from './service.ts';

interface Statement {
  text: string;
  values: unknown[];
}

function recordingSql(answer: unknown[] = [{ id: 'cfg-1' }]): {
  sql: Sql;
  statements: Statement[];
} {
  const statements: Statement[] = [];
  const fn = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.reduce(
      (acc, part, i) =>
        acc + part + (i < values.length ? renderValue(values[i]) : ''),
      '',
    );
    statements.push({ text, values });
    return Promise.resolve(answer);
  };
  fn.unsafe = (text: string) => ({ __unsafe: text });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return { sql: fn as unknown as Sql, statements };
}

/** Inline `sql.unsafe` fragments so the assertion reads the SQL as sent. */
function renderValue(value: unknown): string {
  if (
    typeof value === 'object' &&
    value !== null &&
    '__unsafe' in value &&
    typeof value.__unsafe === 'string'
  ) {
    return value.__unsafe;
  }
  return '$';
}

const SETTLED_MARKER =
  "WHEN last_sync_status = 'running' THEN 'cancelled' ELSE last_sync_status END";

const normalize = (text: string): string => text.replace(/\s+/g, ' ');

describe('sync-config deactivation settles a running marker', () => {
  it('cancel stamps an in-flight run cancelled alongside status inactive', async () => {
    const { sql, statements } = recordingSql();
    await cancelSyncConfigRow(
      sql,
      'app.onedrive_sync_configs',
      'org-1',
      'cfg-1',
    );
    const update = normalize(statements[0]?.text ?? '');
    expect(update).toContain("status = 'inactive'");
    expect(update).toContain(SETTLED_MARKER);
  });

  it('a hub-folder delete settles every config it deactivates', async () => {
    const { sql, statements } = recordingSql();
    await deactivateSyncConfigsForPath(sql, 'org-1', 'Reports');
    expect(statements).toHaveLength(2);
    for (const statement of statements) {
      expect(normalize(statement.text)).toContain(SETTLED_MARKER);
    }
  });

  it('a trash of a directly-selected file settles its config', async () => {
    const { sql, statements } = recordingSql();
    const stopped = await stopSyncForTrashedDocument(sql, {
      organizationId: 'org-1',
      metadata: {
        sourceMode: 'auto',
        isDirectlySelected: true,
        syncConfigId: 'cfg-1',
      },
    });
    expect(stopped).toBe(true);
    expect(normalize(statements[0]?.text ?? '')).toContain(SETTLED_MARKER);
  });

  it('a reactivation clears the previous lifecycle marker, a live row keeps it', async () => {
    const { sql, statements } = recordingSql();
    await upsertSyncConfigRow(sql, 'app.onedrive_sync_configs', {
      organizationId: 'org-1',
      userId: 'user-1',
      itemType: 'folder',
      itemId: 'folder-1',
      itemName: 'Reports',
      targetBucket: 'documents',
    });
    const upsert = normalize(statements[0]?.text ?? '');
    // The existing row is read through its alias: an unqualified `status`
    // inside DO UPDATE is ambiguous against EXCLUDED and Postgres refuses
    // the whole statement (every "Sync import" 500ed).
    expect(upsert).toContain('INSERT INTO app.onedrive_sync_configs AS cfg (');
    expect(upsert).toContain(
      "last_sync_status = CASE WHEN cfg.status = 'inactive' THEN NULL ELSE cfg.last_sync_status END",
    );
  });
});
