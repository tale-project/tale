// @vitest-environment node

/**
 * The daily clean-up of what coding agents leave behind [AGCONN-R19]: which
 * connections, apps and tokens it removes, and what it keeps.
 */

import { describe, expect, it } from 'vitest';

import {
  ENDED_CONNECTION_RETENTION_DAYS,
  gcAgentConnections,
  RETIRED_TOKEN_RETENTION_DAYS,
  UNUSED_APP_GRACE_HOURS,
} from './gc.ts';
import { recordingSql } from './test-helpers.ts';

const NOW = Date.UTC(2026, 9, 13, 4, 20);
const DAY = 86_400_000;

function run(answers: Record<string, number> = {}) {
  const { sql, statements } = recordingSql((statement) => {
    for (const [prefix, count] of Object.entries(answers)) {
      if (statement.text.startsWith(prefix)) {
        return Array.from({ length: count }, (_, id) => ({ id: String(id) }));
      }
    }
    return [];
  });
  return { sql, statements };
}

describe('what the clean-up removes [AGCONN-R19]', () => {
  it('counts what each statement removed', async () => {
    const { sql } = run({
      'DELETE FROM app.agent_connections': 3,
      'DELETE FROM "oauthClient"': 2,
      'DELETE FROM "oauthRefreshToken"': 5,
      'DELETE FROM "oauthAccessToken"': 4,
    });
    await expect(gcAgentConnections(sql, NOW)).resolves.toEqual({
      connections: 3,
      apps: 2,
      refreshTokens: 5,
      accessTokens: 4,
    });
  });

  it('removes a connection ended more than ninety days ago, and no live one', async () => {
    const { sql, statements } = run();
    await gcAgentConnections(sql, NOW);
    const removal = statements[0];
    expect(removal?.text).toBe(
      'DELETE FROM app.agent_connections WHERE revoked_at_ms IS NOT NULL AND revoked_at_ms < ? RETURNING id',
    );
    expect(ENDED_CONNECTION_RETENTION_DAYS).toBe(90);
    expect(removal?.values).toEqual([NOW - 90 * DAY]);
  });

  it('removes an app only when it is an agent’s, old enough, with no live connection and no working refresh token', async () => {
    const { sql, statements } = run();
    await gcAgentConnections(sql, NOW);
    const removal = statements[1];
    expect(removal?.text).toBe(
      `DELETE FROM "oauthClient" AS agent_app WHERE agent_app."referenceId" IS NULL AND agent_app."userId" IS NULL AND agent_app."scopes" @> '["tale:mcp"]'::jsonb AND agent_app."createdAt" < ? AND NOT EXISTS ( SELECT 1 FROM app.agent_connections AS live WHERE live.client_id = agent_app."clientId" AND live.revoked_at_ms IS NULL ) AND NOT EXISTS ( SELECT 1 FROM "oauthRefreshToken" AS working WHERE working."clientId" = agent_app."clientId" AND working."revoked" IS NULL AND working."expiresAt" > ? ) RETURNING agent_app."clientId" AS "clientId"`,
    );
    expect(UNUSED_APP_GRACE_HOURS).toBe(24);
    expect(removal?.values).toEqual([
      new Date(NOW - 24 * 3_600_000),
      new Date(NOW),
    ]);
  });

  it('removes the tokens of agents’ apps that expired or were retired a month ago, and no others', async () => {
    const { sql, statements } = run();
    await gcAgentConnections(sql, NOW);
    const before = new Date(NOW - 30 * DAY);
    expect(RETIRED_TOKEN_RETENTION_DAYS).toBe(30);
    expect(statements[2]?.text).toBe(
      `DELETE FROM "oauthRefreshToken" WHERE ("revoked" < ? OR "expiresAt" < ?) AND "clientId" IN ( SELECT "clientId" FROM "oauthClient" WHERE "referenceId" IS NULL AND "userId" IS NULL AND "scopes" @> '["tale:mcp"]'::jsonb ) RETURNING "id"`,
    );
    expect(statements[2]?.values).toEqual([before, before]);
    expect(statements[3]?.text).toBe(
      `DELETE FROM "oauthAccessToken" WHERE "expiresAt" < ? AND "clientId" IN ( SELECT "clientId" FROM "oauthClient" WHERE "referenceId" IS NULL AND "userId" IS NULL AND "scopes" @> '["tale:mcp"]'::jsonb ) RETURNING "id"`,
    );
    expect(statements[3]?.values).toEqual([before]);
  });

  it('does everything in one transaction, in this order, and nothing else', async () => {
    const { sql, statements } = run();
    await gcAgentConnections(sql, NOW);
    expect(
      statements.map((statement) =>
        statement.text.split(' ').slice(0, 3).join(' '),
      ),
    ).toEqual([
      'DELETE FROM app.agent_connections',
      'DELETE FROM "oauthClient"',
      'DELETE FROM "oauthRefreshToken"',
      'DELETE FROM "oauthAccessToken"',
    ]);
  });

  it('reads the clock when no moment is given', async () => {
    const { sql, statements } = run();
    const before = Date.now();
    await gcAgentConnections(sql);
    const cut = statements[0]?.values[0];
    expect(typeof cut).toBe('number');
    expect(Number(cut)).toBeGreaterThanOrEqual(before - 90 * DAY - 1_000);
    expect(Number(cut)).toBeLessThanOrEqual(Date.now() - 90 * DAY);
  });
});
