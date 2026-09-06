// @vitest-environment node

/**
 * The upload-intent ledger is the only record that a presigned blob exists.
 * A key the browser never bound had no file row for the row-driven sweeps,
 * so its bytes stayed in the bucket forever while the mint path dropped the
 * expired ROW — the last trace of the blob. The sweep now reclaims the blob
 * of an intent that expired unconsumed — and only of one NOTHING vouched
 * for: the non-consuming ownership proof stamps the row, and a stamped or
 * file-backed ref keeps its blob. The live MinIO round-trip rides the
 * integration check; this double locks the statement shape and the per-row
 * outcomes.
 */

import type { Sql } from 'postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { deleteOrgObject } from '../../lib/object-store.ts';
import {
  ownsUploadedBlob,
  recordUploadIntent,
  sweepUploadIntents,
} from './upload-intents.ts';

vi.mock('../../lib/object-store.ts', () => ({
  deleteOrgObject: vi.fn(() => Promise.resolve()),
}));
vi.mock('../../lib/org-config.ts', () => ({
  resolveOrgSlug: vi.fn(() => Promise.resolve('acme')),
}));

interface Statement {
  text: string;
  values: unknown[];
}

const FRAGMENT = Symbol('fragment');

interface Fragment {
  [FRAGMENT]: true;
  text: string;
  values: unknown[];
}

function isFragment(value: unknown): value is Fragment {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { [FRAGMENT]?: true })[FRAGMENT] === true
  );
}

/** A recorder that inlines nested fragments (`sql.unsafe`, `sql\`…\``) the
 * way postgres.js does; answers per statement from the script. */
function fakeLedger(script: {
  abandoned?: { id: string; s3Ref: string }[];
  stamped?: { id: string }[];
  uploaderRow?: boolean;
  /** Fail the sweep's first statement (the consumed-row DELETE). */
  sweepFails?: boolean;
}): { sql: Sql; statements: Statement[] } {
  const statements: Statement[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    let text = '';
    const flat: unknown[] = [];
    strings.forEach((part, index) => {
      text += part;
      if (index >= values.length) return;
      const value = values[index];
      if (isFragment(value)) {
        text += value.text;
        flat.push(...value.values);
      } else {
        text += '?';
        flat.push(value);
      }
    });
    text = text.replace(/\s+/g, ' ').trim();
    statements.push({ text, values: flat });
    if (script.sweepFails && text.includes('consumed_at_ms IS NOT NULL')) {
      const fragment: Fragment = { [FRAGMENT]: true, text, values: flat };
      return Object.assign(
        Promise.reject(new Error('deadlock detected')),
        fragment,
      );
    }
    let rows: unknown[] = [];
    if (text.startsWith('SELECT i.id, i.s3_ref')) {
      rows = script.abandoned ?? [];
    } else if (text.startsWith('UPDATE app.upload_intents SET bound_at_ms')) {
      rows = script.stamped ?? [];
    } else if (text.startsWith('SELECT EXISTS')) {
      rows = [{ owned: script.uploaderRow === true }];
    }
    const fragment: Fragment = { [FRAGMENT]: true, text, values: flat };
    return Object.assign(Promise.resolve(rows), fragment);
  };
  tag.unsafe = (text: string): Fragment => ({
    [FRAGMENT]: true,
    text,
    values: [],
  });
  return { sql: tag as unknown as Sql, statements };
}

/** The fake records nested fragment creations too; only real statements
 * (what Postgres would receive) matter to the assertions. */
function sqlStatements(statements: Statement[]): Statement[] {
  return statements.filter((s) =>
    /^(SELECT|INSERT|UPDATE|DELETE)/.test(s.text),
  );
}

const scope = { organizationId: 'org_1', userId: 'user_1' };

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('ownsUploadedBlob', () => {
  it('stamps the intent it proves ownership through', async () => {
    const fake = fakeLedger({ stamped: [{ id: 'i-1' }] });

    const owned = await ownsUploadedBlob(fake.sql, {
      ...scope,
      storageRef: 's3:blobs/acme/aaa',
    });

    expect(owned).toBe(true);
    const stamp = fake.statements.find((s) =>
      s.text.startsWith('UPDATE app.upload_intents'),
    );
    expect(stamp?.text).toContain('SET bound_at_ms = coalesce(bound_at_ms, ?)');
    expect(stamp?.text).toContain('expires_at_ms > ?');
    expect(stamp?.text).toContain('RETURNING id');
    expect(stamp?.values).toContain('s3:blobs/acme/aaa');
    expect(
      fake.statements.some((s) => s.text.startsWith('SELECT EXISTS')),
    ).toBe(false);
  });

  it('falls back to the registered uploader row when no intent is live', async () => {
    const fake = fakeLedger({ stamped: [], uploaderRow: true });

    const owned = await ownsUploadedBlob(fake.sql, {
      ...scope,
      storageRef: 's3:blobs/acme/aaa',
    });

    expect(owned).toBe(true);
    const proof = fake.statements.find((s) =>
      s.text.startsWith('SELECT EXISTS'),
    );
    expect(proof?.text).toContain('FROM app.file_metadata');
    expect(proof?.text).toContain('uploaded_by = ?');
  });

  it('refuses a ref that is neither minted for the caller nor theirs by row', async () => {
    const fake = fakeLedger({ stamped: [], uploaderRow: false });

    expect(
      await ownsUploadedBlob(fake.sql, {
        ...scope,
        storageRef: 's3:blobs/acme/zzz',
      }),
    ).toBe(false);
  });
});

describe('sweepUploadIntents', () => {
  it('reclaims the blob of an abandoned intent and drops its row, leaving vouched-for and file-backed refs alone', async () => {
    const fake = fakeLedger({
      abandoned: [{ id: 'i-abandoned', s3Ref: 's3:blobs/acme/aaa' }],
    });

    const outcome = await sweepUploadIntents(fake.sql, {
      organizationId: 'org_1',
    });

    expect(outcome).toEqual({ reclaimed: 1 });
    // Every store that may hold the key — an intent minted before the org
    // connected its own bucket left its blob in the deployment default.
    expect(deleteOrgObject).toHaveBeenCalledTimes(1);
    expect(deleteOrgObject).toHaveBeenCalledWith('acme', 'blobs/acme/aaa');

    const issued = sqlStatements(fake.statements);
    // Consumed rows are dead handshakes.
    expect(issued[0]?.text).toBe(
      'DELETE FROM app.upload_intents WHERE org_id = ? AND consumed_at_ms IS NOT NULL',
    );
    // Vouched-for or file-backed rows drop WITHOUT touching their blob.
    const heldDrop = issued[1];
    expect(heldDrop?.text).toContain('DELETE FROM app.upload_intents i');
    expect(heldDrop?.text).toContain('i.expires_at_ms < ?');
    expect(heldDrop?.text).toContain(
      '(i.bound_at_ms IS NOT NULL OR EXISTS ( SELECT 1 FROM app.file_metadata m',
    );
    // Only a ref nobody holds is a reclaim candidate.
    const candidates = issued[2];
    expect(candidates?.text).toContain(
      'SELECT i.id, i.s3_ref AS "s3Ref" FROM app.upload_intents i',
    );
    expect(candidates?.text).toContain('i.consumed_at_ms IS NULL');
    expect(candidates?.text).toContain('NOT (i.bound_at_ms IS NOT NULL)');
    expect(candidates?.text).toContain(
      'NOT EXISTS ( SELECT 1 FROM app.file_metadata m',
    );
    expect(candidates?.text).toContain('ORDER BY i.expires_at_ms LIMIT ?');
    // The row goes only after its bytes did.
    const rowDrop = fake.statements.find(
      (s) => s.text === 'DELETE FROM app.upload_intents WHERE id = ?',
    );
    expect(rowDrop?.values).toEqual(['i-abandoned']);
  });

  it('keeps the row of a blob whose delete failed, for the next sweep', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.mocked(deleteOrgObject).mockRejectedValueOnce(
      new Error('503 slow down'),
    );
    const fake = fakeLedger({
      abandoned: [{ id: 'i-stuck', s3Ref: 's3:blobs/acme/bbb' }],
    });

    const outcome = await sweepUploadIntents(fake.sql, {
      organizationId: 'org_1',
    });

    expect(outcome).toEqual({ reclaimed: 0 });
    expect(
      fake.statements.some(
        (s) => s.text === 'DELETE FROM app.upload_intents WHERE id = ?',
      ),
    ).toBe(false);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(
        'abandoned-upload delete failed for blobs/acme/bbb',
      ),
      '503 slow down',
    );
  });

  it('drops a row naming a ref outside the org namespace without a store call', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fake = fakeLedger({
      abandoned: [{ id: 'i-foreign', s3Ref: 's3:blobs/other-org/ccc' }],
    });

    const outcome = await sweepUploadIntents(fake.sql, {
      organizationId: 'org_1',
    });

    expect(outcome).toEqual({ reclaimed: 0 });
    expect(deleteOrgObject).not.toHaveBeenCalled();
    const rowDrop = fake.statements.find(
      (s) => s.text === 'DELETE FROM app.upload_intents WHERE id = ?',
    );
    expect(rowDrop?.values).toEqual(['i-foreign']);
  });

  it('sweeps the REST ledger on its own table, where consumed is the only bind', async () => {
    const fake = fakeLedger({ abandoned: [] });

    await sweepUploadIntents(fake.sql, {
      organizationId: 'org_1',
      ledger: 'app.rest_upload_intents',
    });

    const issued = sqlStatements(fake.statements);
    expect(issued).toHaveLength(3);
    for (const statement of issued) {
      expect(statement.text).toContain('app.rest_upload_intents');
      expect(statement.text).not.toContain('app.upload_intents');
      expect(statement.text).not.toContain('bound_at_ms');
    }
    expect(issued[2]?.text).toContain('NOT (FALSE)');
  });
});

describe('recordUploadIntent', () => {
  // Regression: the sweep ran unguarded on the mint path, so a bookkeeping
  // failure failed the mint AFTER the byte lane had already stored the blob.
  it('records the intent even when the lazy sweep fails, and logs the sweep', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fake = fakeLedger({ sweepFails: true });

    await expect(
      recordUploadIntent(fake.sql, {
        ...scope,
        purpose: 'file',
        storageRef: 's3:blobs/acme/aaa',
      }),
    ).resolves.toBeUndefined();

    const insert = sqlStatements(fake.statements)[0];
    expect(insert?.text).toContain('INSERT INTO app.upload_intents');
    expect(insert?.values).toContain('s3:blobs/acme/aaa');
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('upload-intent sweep failed'),
      'deadlock detected',
    );
  });
});
