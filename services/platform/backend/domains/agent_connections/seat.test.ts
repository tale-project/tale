// @vitest-environment node

/**
 * What the MCP door reads of a coding agent's connection on every call
 * [AGCONN-R11]: the one live connection of this person and app in this
 * organization, with the person's seat in it — and nothing when there is
 * none, whatever the reason.
 */

import { describe, expect, it } from 'vitest';

import { findLiveConnectionSeat } from './seat.ts';
import { recordingSql } from './test-helpers.ts';

const SEAT = {
  connectionId: 'conn-1',
  clientName: 'Claude Code',
  scopes: ['tale:mcp'],
  createdAt: 1_791_000_000_000,
  organizationSlug: 'acme',
  role: 'developer',
  email: 'ada@example.test',
};

const args = {
  organizationId: 'org-1',
  userId: 'user-ada',
  clientId: 'https://claude.example.test/client.json',
};

describe('the connection and seat the door reads [AGCONN-R11]', () => {
  it('is the live connection of this person and app in this organization, joined to their seat now', async () => {
    const { sql, statements } = recordingSql(() => [SEAT]);
    await expect(findLiveConnectionSeat(sql, args)).resolves.toEqual(SEAT);
    const [read] = statements;
    expect(read?.values).toEqual([
      'org-1',
      'user-ada',
      'https://claude.example.test/client.json',
    ]);
    // Only a connection that has not ended, by the index that holds one per
    // person, organization and app.
    expect(read?.text).toContain(
      'WHERE c.org_id = ? AND c.user_id = ? AND c.client_id = ? AND c.revoked_at_ms IS NULL',
    );
    // The seat is the member row of this person in this organization, and a
    // seat that was switched off opens nothing, in whatever case it is kept.
    expect(read?.text).toContain(
      'JOIN "member" m ON m."organizationId" = c.org_id AND m."userId" = c.user_id',
    );
    expect(read?.text).toContain(`lower(m."role") <> 'disabled'`);
    expect(read?.text).toContain('lower(m."role") AS role');
    expect(read?.text).toContain('LIMIT 1');
  });

  it('is nothing when there is no such connection, seat or person', async () => {
    const { sql } = recordingSql(() => []);
    await expect(findLiveConnectionSeat(sql, args)).resolves.toBeNull();
  });
});
