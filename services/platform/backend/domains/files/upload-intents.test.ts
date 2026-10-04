// @vitest-environment node

/**
 * The upload-intent ledger is the only record that a presigned blob exists.
 * A key the browser never bound had no file row for the row-driven sweeps,
 * so its bytes stayed in the bucket forever while the mint path dropped the
 * expired ROW — the last trace of the blob. The sweep now reclaims the blob
 * of an intent that expired unconsumed — and only of one NOTHING vouched
 * for: the non-consuming ownership proof stamps the row, and a stamped ref,
 * or one a file row, a document or a task holds, keeps its blob. The
 * client's own reclaim of a rejected upload claims its intent under the same
 * rule (#4104). The live MinIO round-trips ride the integration check; this
 * double locks the statement shape and the per-row outcomes.
 */

import type { Sql } from 'postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { deleteOrgObject } from '../../lib/object-store.ts';
import {
  claimRejectedUpload,
  firstForeignUpload,
  releaseReclaimedIntent,
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
  claimed?: { id: string }[];
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
    if (text.includes('SELECT i.id, i.s3_ref')) {
      rows = script.abandoned ?? [];
    } else if (
      text.startsWith('UPDATE app.upload_intents i SET expires_at_ms = 0')
    ) {
      rows = script.claimed ?? [];
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
    /^(SELECT|INSERT|UPDATE|DELETE|WITH)/.test(s.text),
  );
}

const scope = { organizationId: 'org_1', userId: 'user_1' };

describe('firstForeignUpload', () => {
  it('keeps early refusal read-only and returns the sorted foreign ref', async () => {
    const fake = fakeLedger({ uploaderRow: false });
    expect(
      await firstForeignUpload(
        fake.sql,
        scope,
        ['s3:blobs/acme/b', 's3:blobs/acme/a', 's3:blobs/acme/b'],
        { stamp: false },
      ),
    ).toBe('s3:blobs/acme/a');
    expect(
      sqlStatements(fake.statements).some((statement) =>
        statement.text.startsWith('UPDATE'),
      ),
    ).toBe(false);
  });
  it('locks deduplicated refs in the same order for reversed sends', async () => {
    const forward = fakeLedger({ stamped: [{ id: 'intent' }] });
    const reversed = fakeLedger({ stamped: [{ id: 'intent' }] });
    for (const [fake, refs] of [
      [forward, ['s3:blobs/acme/a', 's3:blobs/acme/b']],
      [reversed, ['s3:blobs/acme/b', 's3:blobs/acme/a', 's3:blobs/acme/b']],
    ] as const) {
      expect(await firstForeignUpload(fake.sql, scope, refs)).toBeNull();
    }
    const locks = (fake: ReturnType<typeof fakeLedger>) =>
      sqlStatements(fake.statements)
        .filter((statement) =>
          statement.text.startsWith('UPDATE app.upload_intents'),
        )
        .map((statement) => statement.values[1]);
    expect(locks(forward)).toEqual(['s3:blobs/acme/a', 's3:blobs/acme/b']);
    expect(locks(reversed)).toEqual(locks(forward));
  });
});

/** `blobRefHeld` over the ledger row's ref, as the statements inline it. */
const HELD_BY_A_ROW =
  "(EXISTS ( SELECT 1 FROM app.file_metadata held_file WHERE held_file.org_id = ? AND held_file.storage_ref = i.s3_ref ) OR EXISTS ( SELECT 1 FROM app.documents held_doc WHERE held_doc.org_id = ? AND (held_doc.file_ref = i.s3_ref OR held_doc.history_files @> ARRAY[i.s3_ref::text]) ) OR (EXISTS ( SELECT 1 FROM app.tasks held WHERE held.org_id = ? AND (coalesce(held.attachments, '[]'::jsonb) || coalesce(held.outputs, '[]'::jsonb)) @> jsonb_build_array(jsonb_build_object('fileId', i.s3_ref::text)) ) OR EXISTS ( SELECT 1 FROM app.conversation_messages held_mail WHERE held_mail.org_id = ? AND held_mail.direction = 'outbound' AND held_mail.delivery_state IN ('queued', 'failed') AND held_mail.metadata->'attachments' @> jsonb_build_array(jsonb_build_object('storageId', i.s3_ref::text)) ) OR EXISTS ( SELECT 1 FROM app.messages held_chat WHERE held_chat.org_id = ? AND held_chat.role = 'user' AND held_chat.parts @> jsonb_build_array(jsonb_build_object( 'type', 'attachment', 'fileId', i.s3_ref::text )) )))";

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('ownsUploadedBlob', () => {
  it('asks without writing when told not to stamp (#4111)', async () => {
    const fake = fakeLedger({ stamped: [{ id: 'i-1' }] });

    const owned = await ownsUploadedBlob(
      fake.sql,
      { ...scope, storageRef: 's3:blobs/acme/aaa' },
      { stamp: false },
    );

    const issued = sqlStatements(fake.statements);
    expect(issued.some((s) => s.text.startsWith('UPDATE'))).toBe(false);
    expect(issued[0]?.text).toBe(
      "SELECT id FROM app.upload_intents WHERE s3_ref = ? AND org_id = ? AND user_id = ? AND purpose = 'file' AND expires_at_ms > ?",
    );
    // The fake answers the read with no row, so the uploader arm decides.
    expect(owned).toBe(false);
  });

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

  it('proves nothing through a staged bundle’s intent, which its own lane consumes and deletes (#4110)', async () => {
    const fake = fakeLedger({ stamped: [{ id: 'i-1' }] });

    await ownsUploadedBlob(fake.sql, {
      ...scope,
      storageRef: 's3:blobs/acme/aaa',
    });

    const stamp = fake.statements.find((s) =>
      s.text.startsWith('UPDATE app.upload_intents'),
    );
    expect(stamp?.text).toContain("AND purpose = 'file'");
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
  it('materializes a bounded backlog before either expensive holder scan', async () => {
    const fake = fakeLedger({});
    await sweepUploadIntents(fake.sql, { organizationId: 'org_1' });
    const issued = sqlStatements(fake.statements);
    for (const statement of issued.slice(1, 3)) {
      expect(statement.text).toMatch(/^WITH candidates AS MATERIALIZED/);
      expect(statement.text).toContain(
        'ORDER BY expires_at_ms, id LIMIT ? FOR UPDATE SKIP LOCKED )',
      );
      expect(statement.text.indexOf('LIMIT ?')).toBeLessThan(
        statement.text.indexOf('FROM app.messages held_chat'),
      );
      expect(statement.values).toContain(25);
    }
  });
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
    // Vouched-for rows, and rows whose ref a file row, a document or a task
    // holds (files/blob-holders.ts), drop WITHOUT touching their blob.
    const heldDrop = issued[1];
    expect(heldDrop?.text).toContain(
      'DELETE FROM app.upload_intents target USING candidates i',
    );
    expect(heldDrop?.text).toContain('expires_at_ms < ?');
    expect(heldDrop?.text).toContain(
      `AND (i.bound_at_ms IS NOT NULL OR ${HELD_BY_A_ROW})`,
    );
    // Only a ref nobody holds is a reclaim candidate.
    const candidates = issued[2];
    expect(candidates?.text).toContain(
      'SELECT i.id, i.s3_ref AS "s3Ref" FROM candidates i',
    );
    expect(candidates?.text).toContain('consumed_at_ms IS NULL');
    expect(candidates?.text).toContain(
      `WHERE NOT (i.bound_at_ms IS NOT NULL OR ${HELD_BY_A_ROW}) ORDER BY`,
    );
    expect(candidates?.text).toContain('ORDER BY expires_at_ms, id LIMIT ?');
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
    const retry = sqlStatements(fake.statements).find((statement) =>
      statement.text.startsWith('UPDATE app.upload_intents SET expires_at_ms'),
    );
    expect(retry?.text).toContain(
      'AND consumed_at_ms IS NULL AND expires_at_ms < ?',
    );
    expect(retry?.values.slice(1, 3)).toEqual(['i-stuck', 'org_1']);
    const retryAt = Number(retry?.values[0]);
    expect(retryAt).toBeLessThan(Date.now());
    expect(retryAt - Number(retry?.values[3])).toBe(60_000);
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
    expect(issued[2]?.text).toContain(`NOT (FALSE OR ${HELD_BY_A_ROW})`);
  });
});

describe('claimRejectedUpload', () => {
  it('closes the caller’s own intent only while nothing holds its blob', async () => {
    const fake = fakeLedger({ claimed: [{ id: 'i-1' }] });

    const claimed = await claimRejectedUpload(fake.sql, {
      ...scope,
      storageRef: 's3:blobs/acme/aaa',
    });

    expect(claimed).toBe(true);
    const issued = sqlStatements(fake.statements);
    expect(issued).toHaveLength(1);
    // One statement on the intent row (#4104). What serializes it against a
    // bind is the row itself: every bind stamps or consumes it in the
    // transaction that writes its holder, so the claim waits on that lock
    // and re-reads `bound_at_ms` and `consumed_at_ms` on the committed row.
    // The holder subqueries get no such re-read — under READ COMMITTED they
    // keep the statement's snapshot — so they are the belt, not the race
    // guard; `tests/guards/binding-doors.guard.test.ts` holds every door to
    // the row (#4111).
    expect(issued[0]?.text).toBe(
      `UPDATE app.upload_intents i SET expires_at_ms = 0 WHERE i.s3_ref = ? AND i.org_id = ? AND i.user_id = ? AND i.consumed_at_ms IS NULL AND i.expires_at_ms > ? AND NOT (i.bound_at_ms IS NOT NULL OR ${HELD_BY_A_ROW}) RETURNING i.id`,
    );
    expect(issued[0]?.values.slice(0, 3)).toEqual([
      's3:blobs/acme/aaa',
      'org_1',
      'user_1',
    ]);
    // Any purpose: the reclaim only has to prove the upload was the caller's.
    expect(issued[0]?.text).not.toContain('purpose');
  });

  it('refuses a bound, held, foreign or missing intent alike', async () => {
    const fake = fakeLedger({ claimed: [] });

    expect(
      await claimRejectedUpload(fake.sql, {
        ...scope,
        storageRef: 's3:blobs/acme/held',
      }),
    ).toBe(false);
  });
});

describe('releaseReclaimedIntent', () => {
  it('drops only the tombstone a claim left, once the bytes are gone (#4111)', async () => {
    const fake = fakeLedger({});

    await releaseReclaimedIntent(fake.sql, {
      organizationId: 'org_1',
      storageRef: 's3:blobs/acme/aaa',
    });

    const issued = sqlStatements(fake.statements);
    expect(issued).toHaveLength(1);
    expect(issued[0]?.text).toBe(
      'DELETE FROM app.upload_intents WHERE s3_ref = ? AND org_id = ? AND consumed_at_ms IS NULL AND expires_at_ms = 0',
    );
    expect(issued[0]?.values).toEqual(['s3:blobs/acme/aaa', 'org_1']);
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
