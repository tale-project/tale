import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import { getCurrentMemberContext } from './service.ts';

/**
 * `GET /api/app/members/me` — the app's own membership bundle. The seat row
 * decides whether the caller is a member; the role the org gate enforces on
 * the request (a trusted-headers session's asserted role included) is what
 * the app is told, so the shell never shows a stale seat.
 */

function fakeSql(seatRole: string | null): Sql {
  const tag = (strings: TemplateStringsArray) => {
    const text = strings.join('$?').replace(/\s+/g, ' ').trim();
    if (text.startsWith('SELECT "id" FROM "organization"')) {
      return Promise.resolve([{ id: 'org-1' }]);
    }
    if (text.startsWith('SELECT "id", "role", "createdAt"')) {
      return Promise.resolve(
        seatRole === null
          ? []
          : [{ id: 'member-1', role: seatRole, createdAt: '2026-01-01' }],
      );
    }
    return Promise.resolve([]);
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return tag as unknown as Sql;
}

const actor = { userId: 'user-1', name: 'Proxy User' };

describe('getCurrentMemberContext — the role the app is told', () => {
  it('reports the seat role when the gate enforces nothing else', async () => {
    const context = await getCurrentMemberContext(
      fakeSql('member'),
      actor,
      'org-1',
    );
    expect(context).toMatchObject({
      status: 'ok',
      role: 'member',
      isAdmin: false,
    });
  });

  it('reports the enforced role over the seat — a proxy-asserted admin acts as admin', async () => {
    const context = await getCurrentMemberContext(
      fakeSql('member'),
      actor,
      'org-1',
      'admin',
    );
    expect(context).toMatchObject({
      status: 'ok',
      memberId: 'member-1',
      role: 'admin',
      isAdmin: true,
    });
  });

  it('still needs a seat — an enforced role never conjures a membership', async () => {
    expect(
      await getCurrentMemberContext(fakeSql(null), actor, 'org-1', 'admin'),
    ).toEqual({ status: 'not_member' });
  });
});
