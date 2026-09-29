// @vitest-environment node

import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import {
  API_KEY_CAPABILITIES,
  mayCreateApiKeys,
} from './api-key-create-gate.ts';

/**
 * Who may create a personal API key: an owner, admin or developer of any
 * organization, or a member holding a live grant of a competence that is
 * used with a key, in an organization whose seat is not disabled.
 */

interface Seat {
  organizationId: string;
  role: string;
}

/** Answers the seat read with `seats` and the grant read with `grant`,
 * recording each query's text and bindings. */
function database(seats: Seat[], grant: boolean) {
  const queries: { text: string; values: unknown[] }[] = [];
  const sql = ((first: unknown, ...values: unknown[]) => {
    // `sql(list)` builds a fragment; the fake hands the list back as is.
    if (!Array.isArray(first) || !('raw' in first)) return first;
    const text = (first as unknown as TemplateStringsArray)
      .join('?')
      .replaceAll(/\s+/g, ' ')
      .trim();
    queries.push({ text, values });
    if (text.includes('FROM "member"')) return Promise.resolve(seats);
    return Promise.resolve(grant ? [{ id: 'grant-1' }] : []);
  }) as unknown as Sql;
  return { sql, queries };
}

const NOW = 1_800_000_000_000;

describe('mayCreateApiKeys', () => {
  it.each(['owner', 'admin', 'developer', 'Developer'])(
    'lets a %s create one without reading grants',
    async (role) => {
      const { sql, queries } = database(
        [{ organizationId: 'o1', role }],
        false,
      );
      expect(await mayCreateApiKeys(sql, 'u1', NOW)).toBe(true);
      expect(queries).toHaveLength(1);
    },
  );

  it('lets the developer of another organization create one', async () => {
    // A key is the person's and works wherever they are a member.
    const { sql } = database(
      [
        { organizationId: 'o1', role: 'member' },
        { organizationId: 'o2', role: 'developer' },
      ],
      false,
    );
    expect(await mayCreateApiKeys(sql, 'u1', NOW)).toBe(true);
  });

  it('lets a member holding a key-using grant create one', async () => {
    const { sql, queries } = database(
      [{ organizationId: 'o1', role: 'member' }],
      true,
    );
    expect(await mayCreateApiKeys(sql, 'u1', NOW)).toBe(true);
    const grantRead = queries[1];
    expect(grantRead?.text).toContain('FROM app.competence_records');
    expect(grantRead?.text).toContain('revoked_at_ms IS NULL');
    expect(grantRead?.text).toContain(
      '(expires_at_ms IS NULL OR expires_at_ms > ?)',
    );
    expect(grantRead?.values).toEqual([
      'u1',
      ['o1'],
      [...API_KEY_CAPABILITIES],
      NOW,
    ]);
  });

  it.each(['member', 'editor'])(
    'refuses a %s without such a grant',
    async (role) => {
      const { sql } = database([{ organizationId: 'o1', role }], false);
      expect(await mayCreateApiKeys(sql, 'u1', NOW)).toBe(false);
    },
  );

  it('counts no grant held in an organization whose seat is disabled', async () => {
    const { sql, queries } = database(
      [
        { organizationId: 'o1', role: 'disabled' },
        { organizationId: 'o2', role: 'member' },
      ],
      true,
    );
    await mayCreateApiKeys(sql, 'u1', NOW);
    expect(queries[1]?.values[1]).toEqual(['o2']);
  });

  it('refuses a caller whose every seat is disabled, without reading grants', async () => {
    const { sql, queries } = database(
      [{ organizationId: 'o1', role: 'disabled' }],
      true,
    );
    expect(await mayCreateApiKeys(sql, 'u1', NOW)).toBe(false);
    expect(queries).toHaveLength(1);
  });

  it('names every competence that is used with a key, and no other', () => {
    expect([...API_KEY_CAPABILITIES].sort()).toEqual([
      'tale:models.api',
      'tale:notifications.export',
      'tale:rest.act-as',
    ]);
  });
});
