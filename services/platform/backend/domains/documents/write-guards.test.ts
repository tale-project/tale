import { describe, expect, it } from 'vitest';

import { authorizeRls } from '../../auth/access.ts';
import { checkProjectAccess } from '../../core/projects/access.ts';
import {
  assertDocumentsWriteRole,
  assertGenericDocumentContentWritableJson,
  assertHubTeamAssignable,
  assertRecordTrashableJson,
  DocumentError,
} from './service.ts';

/**
 * The documents write-guard trio at the service seam — the org-role write
 * matrix, the controlled-record content freeze on the jsonb projection, and
 * the retained-history delete protection. Every mutating door (app routes,
 * REST v1, agent upsert, folder cascade) inherits these; the tables here are
 * the wire-level contract those doors rely on.
 */

function codeOf(run: () => void): { code: string; status: number } | null {
  try {
    run();
    return null;
  } catch (error) {
    if (error instanceof DocumentError) {
      return { code: error.code, status: error.status };
    }
    throw error;
  }
}

describe('assertDocumentsWriteRole (the org-role write matrix)', () => {
  it.each(['owner', 'admin', 'developer', 'editor'])(
    'admits the %s role',
    (role) => {
      expect(codeOf(() => assertDocumentsWriteRole({ role }))).toBeNull();
    },
  );

  it.each(['member', 'disabled'])('refuses the read-only %s role', (role) => {
    expect(codeOf(() => assertDocumentsWriteRole({ role }))).toEqual({
      code: 'RBAC_FORBIDDEN',
      status: 403,
    });
  });

  it('fails closed for unknown roles (degrade to member)', () => {
    expect(codeOf(() => assertDocumentsWriteRole({ role: 'wizard' }))).toEqual({
      code: 'RBAC_FORBIDDEN',
      status: 403,
    });
  });

  // The two matrices behind `requireDocumentWriteAccess` must agree: every
  // role the org-wide write matrix admits also holds project `canEdit`, so a
  // writer who can SEE a project file can always edit it — and no role that
  // only reads can rename, move, or trash one. If either matrix moves, this
  // is the test that says the project-file write door changed meaning.
  it.each([
    'owner',
    'admin',
    'developer',
    'editor',
    'member',
    'disabled',
    'wizard',
  ])('%s: documents:write ⇔ project canEdit on a readable project', (role) => {
    const orgWideProject = { teamId: null, sharedWithTeamIds: [] };
    expect(checkProjectAccess(orgWideProject, [], role).canEdit).toBe(
      authorizeRls(role, 'documents', 'write'),
    );
  });
});

describe('assertGenericDocumentContentWritableJson (content freeze)', () => {
  it('admits an uncontrolled document', () => {
    expect(
      codeOf(() => assertGenericDocumentContentWritableJson(null)),
    ).toBeNull();
  });

  it.each([
    ['in_review', 'DOCUMENT_RECORD_FROZEN'],
    ['approved', 'DOCUMENT_RECORD_FROZEN'],
    // A draft is not frozen, but controlled bytes still have exactly one
    // door — the attested replacement flow.
    ['draft', 'DOCUMENT_RECORD_REPLACEMENT_REQUIRED'],
  ])('refuses a controlled record in %s as %s', (state, code) => {
    expect(
      codeOf(() =>
        assertGenericDocumentContentWritableJson({
          state,
          version: 1,
          approvedVersions: [],
        }),
      ),
    ).toEqual({ code, status: 400 });
  });
});

describe('assertRecordTrashableJson (delete protection incl. history)', () => {
  it('admits an uncontrolled document', () => {
    expect(codeOf(() => assertRecordTrashableJson(null))).toBeNull();
  });

  it('admits a controlled first draft with no approved history', () => {
    expect(
      codeOf(() =>
        assertRecordTrashableJson({
          state: 'draft',
          version: 1,
          approvedVersions: [],
        }),
      ),
    ).toBeNull();
  });

  it.each(['in_review', 'approved'])('refuses a record in %s', (state) => {
    expect(
      codeOf(() =>
        assertRecordTrashableJson({ state, version: 1, approvedVersions: [] }),
      ),
    ).toEqual({ code: 'DOCUMENT_RECORD_PROTECTED', status: 400 });
  });

  it('refuses a revision draft that retains approved history', () => {
    // The "open a new revision, then delete" hole: protection follows the
    // record's EVIDENCE, never the current state alone.
    expect(
      codeOf(() =>
        assertRecordTrashableJson({
          state: 'draft',
          version: 2,
          approvedVersions: [
            { version: 1, fileId: 'file_1', approvedAt: 1, approvedBy: 'u1' },
          ],
        }),
      ),
    ).toEqual({ code: 'DOCUMENT_RECORD_PROTECTED', status: 400 });
  });
});

describe('assertHubTeamAssignable (team scope must stay visible)', () => {
  it('admits a team the caller belongs to', () => {
    expect(
      codeOf(() =>
        assertHubTeamAssignable({ teamIds: ['team_a', 'team_b'] }, 'team_b'),
      ),
    ).toBeNull();
  });

  it.each([
    ['a foreign team', 'team_other'],
    ['an unknown id', 'no-such-team'],
  ])('refuses %s', (_label, teamId) => {
    expect(
      codeOf(() => assertHubTeamAssignable({ teamIds: ['team_a'] }, teamId)),
    ).toEqual({ code: 'TEAM_ACCESS_DENIED', status: 403 });
  });
});
