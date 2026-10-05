import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const migration = await readFile(
  new URL('./migrations/0150_blob_reclaims.sql', import.meta.url),
  'utf8',
);

describe('chat provenance rolling writer barrier source contract', () => {
  it('locks both old writer tables before the rowless preflight and installs enduring triggers', () => {
    expect(
      migration.indexOf('LOCK TABLE app.file_metadata, app.messages'),
    ).toBeLessThan(migration.indexOf('DO $$'));
    expect(migration).toContain(
      'BEFORE INSERT OR UPDATE OF parts ON app.messages',
    );
    expect(migration).toContain(
      'BEFORE DELETE OR UPDATE OF storage_ref, org_id, document_id, uploaded_by, thread_id, lifecycle_status ON app.file_metadata',
    );
    expect(migration).toContain('FOR SHARE OF file');
    expect(migration).toContain('FOR SHARE OF file NOWAIT');
    expect(migration).toContain('INSERT INTO app.blob_reclaims');
    expect(migration).toContain(
      'ON CONFLICT (org_id, storage_ref) DO UPDATE SET',
    );
    expect(migration).toContain(
      "RAISE EXCEPTION 'chat attachment writer has no trusted file binding'",
    );
  });

  it('never derives document ownership or source identity from a lossy pointer', () => {
    expect(migration).toContain("jsonb_build_object('sourceAmbiguous', true)");
    expect(migration).not.toContain("jsonb_build_object('documentId'");
    expect(migration).toContain('(file).document_id IS NULL AND');
    expect(migration).toContain('(file).uploaded_by = (thread).user_id');
    expect(migration).toContain('(file).thread_id = (thread).branch_root_id');
    expect(migration).toContain(
      "WHEN (file).document_id IS NULL THEN jsonb_build_object('fileId', (file).id)",
    );
  });

  it('never overwrites a trusted proof or backfills historical rows at migration time', () => {
    expect(migration).toContain(
      "IF coalesce(NEW.attachment_ownership, '{}'::jsonb) ? ref THEN",
    );
    expect(migration).toContain(
      "AND NOT (coalesce(message.attachment_ownership, '{}'::jsonb) ? OLD.storage_ref)",
    );
    expect(migration).toContain('WHERE message.org_id = OLD.org_id');
    const topLevel = migration.slice(
      0,
      migration.indexOf('CREATE OR REPLACE FUNCTION'),
    );
    expect(topLevel).not.toMatch(/UPDATE app\.messages/);
    expect(topLevel).toContain("to_jsonb(message)->'attachment_ownership'");
  });

  it('prioritizes a valid independent owned binding over the retired weak binding', () => {
    expect(migration).toContain(
      'independent.org_id = OLD.org_id AND independent.storage_ref = OLD.storage_ref',
    );
    expect(migration).toContain('independent.id <> OLD.id');
    expect(migration).toContain(
      'app.chat_attachment_file_proof(independent, thread) @> \'{"owned":true}\'::jsonb',
    );
  });
});
