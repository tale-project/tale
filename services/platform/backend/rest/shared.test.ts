// @vitest-environment node

import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import {
  formatKeysetCursor,
  loadRestProject,
  pageLimit,
  parseKeysetCursor,
} from './shared.ts';

describe('REST project access', () => {
  const auth = {
    organizationId: 'org-1',
    userId: 'user-1',
    role: 'member',
    teamIds: ['team-1'],
  };
  const project = {
    id: 'project-1',
    organizationId: 'org-1',
    teamId: 'team-1',
    sharedWithTeamIds: [],
    archivedAt: null,
  };
  const database = (rows: unknown[], error?: Error) =>
    Object.assign(
      () => (error ? Promise.reject(error) : Promise.resolve(rows)),
      { unsafe: (text: string) => text },
    ) as unknown as Sql;

  it('keeps missing, foreign and invisible projects opaque', async () => {
    for (const rows of [
      [],
      [{ ...project, organizationId: 'other-org' }],
      [{ ...project, teamId: 'other-team' }],
    ]) {
      await expect(
        loadRestProject(database(rows), auth, project.id),
      ).rejects.toMatchObject({ status: 404, message: 'Project not found' });
    }
  });

  it('allows member collaboration but refuses editorial changes', async () => {
    const sql = database([project]);
    await expect(
      loadRestProject(sql, auth, project.id, { active: true }),
    ).resolves.toEqual(project);
    await expect(
      loadRestProject(sql, auth, project.id, { write: true }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      loadRestProject(sql, { ...auth, role: 'editor' }, project.id, {
        write: true,
      }),
    ).resolves.toEqual(project);
  });

  it('permits archived reads but refuses all active-project mutations', async () => {
    const archived = { ...project, archivedAt: 123 };
    const sql = database([archived]);
    await expect(loadRestProject(sql, auth, project.id)).resolves.toEqual(
      archived,
    );
    for (const options of [{ active: true }, { write: true }]) {
      await expect(
        loadRestProject(sql, { ...auth, role: 'admin' }, project.id, options),
      ).rejects.toMatchObject({ status: 403 });
    }
  });

  it('preserves database failures as outages rather than missing resources', async () => {
    const outage = new Error('database unavailable');
    await expect(
      loadRestProject(database([], outage), auth, project.id),
    ).rejects.toBe(outage);
  });
});

/**
 * The one cursor codec every keyset-paginated /api/v1 list shares, and the
 * page-size clamp: a consumer passes `continueCursor` straight back as
 * `cursor`, and no `limit` a client can send turns into a Postgres error
 * (negative LIMIT) or a dead page (LIMIT 0 answering nothing forever).
 */

describe('keyset cursor codec', () => {
  it("round-trips the previous page's last row", () => {
    const token = formatKeysetCursor(1_725_000_000_000, 'row-42');
    expect(token).toBe('1725000000000:row-42');
    expect(parseKeysetCursor(token)).toEqual({
      at: 1_725_000_000_000,
      id: 'row-42',
    });
  });

  it('keeps an id that itself contains the separator intact', () => {
    expect(parseKeysetCursor('17:a:b:c')).toEqual({ at: 17, id: 'a:b:c' });
  });

  it('reads an absent or empty cursor as the first page', () => {
    expect(parseKeysetCursor(undefined)).toBeNull();
    expect(parseKeysetCursor(null)).toBeNull();
    expect(parseKeysetCursor('')).toBeNull();
  });

  it('reads an unparseable token as the first page, never a crash', () => {
    for (const garbage of [
      'nope',
      ':row',
      '17:',
      'NaN:row',
      '{"updatedAt":1,"id":"x"}',
    ]) {
      expect(parseKeysetCursor(garbage)).toBeNull();
    }
  });
});

describe('pageLimit', () => {
  it('honours a sane value and defaults when absent', () => {
    expect(pageLimit('40', { fallback: 25, max: 200 })).toBe(40);
    expect(pageLimit(undefined, { fallback: 25, max: 200 })).toBe(25);
  });

  it('floors at one row and caps at the family maximum', () => {
    expect(pageLimit('0', { fallback: 25, max: 200 })).toBe(1);
    expect(pageLimit('-5', { fallback: 25, max: 200 })).toBe(1);
    expect(pageLimit('1000', { fallback: 25, max: 200 })).toBe(200);
  });

  it('falls back on non-numeric input and truncates fractions', () => {
    expect(pageLimit('abc', { fallback: 25, max: 200 })).toBe(25);
    expect(pageLimit('2.9', { fallback: 25, max: 200 })).toBe(2);
  });
});

/**
 * The keyset codec only ever writes a whole epoch-millisecond count. A
 * fraction, an exponent or a count beyond the bigint column used to pass
 * `Number.isFinite` and reach Postgres as a cast error — a 500 where the
 * door had just promised a 400 for a cursor it never answered.
 */
describe('parseKeysetCursor — timestamps the column cannot hold', () => {
  it.each([
    '1.5:p-2',
    '100000000000000000000:p-2',
    '1e100:p-2',
    '-5:p-2',
    '0x10:p-2',
    ' 7:p-2',
  ])('reads %s as no cursor', (token) => {
    expect(parseKeysetCursor(token)).toBeNull();
  });

  it('keeps a whole epoch-millisecond count', () => {
    expect(parseKeysetCursor('1699999999998:p-2')).toEqual({
      at: 1_699_999_999_998,
      id: 'p-2',
    });
  });
});
