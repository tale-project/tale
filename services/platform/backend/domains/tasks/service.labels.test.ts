// @vitest-environment node

/**
 * D-02: task labels came back lower-cased and re-sorted — `Bug`, `P1`,
 * `MixedCase-ÄÖÜ` read back as `bug`, `p1`, `mixedcase-äöü` — because
 * case-folding was the only way `UNIQUE (project_id, name)` kept `Bug` and
 * `bug` from becoming two labels, and every external system a mirror
 * syncs from treats label case as significant. The catalog now keeps the
 * spelling a label was first created with and is unique per project on
 * `lower(name)` (migration 0097): lookups fold case, the insert converges
 * on the case-folded key, and a list is deduplicated on it with the first
 * spelling winning.
 */

import type { TransactionSql } from 'postgres';
import { describe, expect, it, vi } from 'vitest';

import { renameTaskLabel, resolveProjectLabels } from './service.ts';

vi.mock('../../realtime/outbox.ts', () => ({ emitHintInTx: vi.fn() }));

interface Statement {
  text: string;
  values: unknown[];
}

const PROJECT = {
  id: 'project-1',
  organizationId: 'org_1',
  name: 'Board',
  teamId: null,
  sharedWithTeamIds: [] as string[],
  archivedAt: null,
  createdBy: 'user-1',
};

const auth = {
  organizationId: 'org_1',
  userId: 'user-1',
  role: 'editor',
  teamIds: [] as string[],
};

/** The catalog as stored: the lookup answers by case-folded name. */
function fakeTx(catalog: Array<{ id: string; name: string }>): {
  tx: TransactionSql;
  statements: Statement[];
} {
  const statements: Statement[] = [];
  const run = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    statements.push({ text, values });
    if (text.includes('FROM app.projects WHERE id = ?')) {
      return Promise.resolve([PROJECT]);
    }
    if (text.includes('lower(name) = lower(?)')) {
      const wanted = String(values[1]).toLowerCase();
      return Promise.resolve(
        catalog.filter((row) => row.name.toLowerCase() === wanted),
      );
    }
    if (text.startsWith('INSERT INTO app.task_labels')) {
      return Promise.resolve([{ id: `new:${String(values[2])}` }]);
    }
    if (
      text.includes(
        'SELECT project_id AS "projectId", name FROM app.task_labels',
      )
    ) {
      return Promise.resolve([{ projectId: 'project-1', name: 'Bug' }]);
    }
    return Promise.resolve([]);
  };
  const tx = Object.assign(run, { unsafe: (text: string) => text });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a template-tag stand-in for the postgres.js transaction
  return { tx: tx as unknown as TransactionSql, statements };
}

describe('resolveProjectLabels — spelling kept, matched without regard to case', () => {
  it('creates a missing label with the spelling given, converging on the case-folded key', async () => {
    const { tx, statements } = fakeTx([]);
    const ids = await resolveProjectLabels(tx, {
      organizationId: 'org_1',
      projectId: 'project-1',
      names: ['  MixedCase-ÄÖÜ ', 'ALLCAPS'],
      createdBy: 'user-1',
      createIfMissing: true,
    });
    expect(ids).toEqual(['new:MixedCase-ÄÖÜ', 'new:ALLCAPS']);
    const inserts = statements.filter((s) =>
      s.text.startsWith('INSERT INTO app.task_labels'),
    );
    expect(inserts.map((s) => s.values[2])).toEqual([
      'MixedCase-ÄÖÜ',
      'ALLCAPS',
    ]);
    for (const insert of inserts) {
      expect(insert.text).toContain('ON CONFLICT (project_id, lower(name))');
    }
  });

  it('wears the existing label for a name that differs only in case, keeping the order sent', async () => {
    const { tx, statements } = fakeTx([
      { id: 'lbl-bug', name: 'Bug' },
      { id: 'lbl-p1', name: 'P1' },
    ]);
    const ids = await resolveProjectLabels(tx, {
      organizationId: 'org_1',
      projectId: 'project-1',
      names: ['p1', 'BUG', 'Feature'],
      createdBy: 'user-1',
      createIfMissing: true,
    });
    expect(ids).toEqual(['lbl-p1', 'lbl-bug', 'new:Feature']);
    expect(statements.filter((s) => s.text.startsWith('INSERT')).length).toBe(
      1,
    );
  });

  it('deduplicates on the case-folded name, the first spelling winning, and composes NFC', async () => {
    const { tx, statements } = fakeTx([]);
    const ids = await resolveProjectLabels(tx, {
      organizationId: 'org_1',
      projectId: 'project-1',
      names: ['Ops', 'ops', 'OPS', 'éclair'],
      createdBy: 'user-1',
      createIfMissing: true,
    });
    expect(ids).toEqual(['new:Ops', 'new:éclair']);
    const inserts = statements.filter((s) => s.text.startsWith('INSERT'));
    expect(inserts.map((s) => s.values[2])).toEqual(['Ops', 'éclair']);
  });

  it('refuses an unknown name on a human path, naming the spelling sent', async () => {
    const { tx } = fakeTx([{ id: 'lbl-bug', name: 'Bug' }]);
    await expect(
      resolveProjectLabels(tx, {
        organizationId: 'org_1',
        projectId: 'project-1',
        names: ['bug', 'Nope'],
        createdBy: 'user-1',
      }),
    ).rejects.toMatchObject({
      code: 'TASK_LABEL_UNKNOWN',
      data: { name: 'Nope' },
    });
  });
});

describe('renameTaskLabel', () => {
  it('refuses a name another label carries in any case, and keeps the spelling of a free one', async () => {
    const taken = fakeTx([
      { id: 'lbl-bug', name: 'Bug' },
      { id: 'lbl-p1', name: 'P1' },
    ]);
    await expect(
      renameTaskLabel(taken.tx, auth, { labelId: 'lbl-bug', name: 'p1' }),
    ).rejects.toMatchObject({ code: 'TASK_LABEL_TAKEN' });

    const free = fakeTx([{ id: 'lbl-bug', name: 'Bug' }]);
    await renameTaskLabel(free.tx, auth, {
      labelId: 'lbl-bug',
      name: ' Defect ',
    });
    const update = free.statements.find((s) =>
      s.text.startsWith('UPDATE app.task_labels'),
    );
    expect(update?.values[0]).toBe('Defect');
  });
});
