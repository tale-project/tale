// @vitest-environment node

/**
 * A refresh token used twice [AGCONN-R16]: what a token request presents, how
 * the provider stores it, which presented token is a reuse, and what Tale
 * does once the provider has ended the sign-in because of it.
 */

import type { Sql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { endAgentConnectionsInTx } from '../domains/agent_connections/end.ts';
import {
  endAgentsAfterReuse,
  storedRefreshToken,
  tokenRequestFields,
  usedRefreshToken,
} from './agent-reuse.ts';

vi.mock('../domains/agent_connections/end.ts', () => ({
  endAgentConnectionsInTx: vi.fn(() => Promise.resolve([{ id: 'conn-1' }])),
}));

interface Statement {
  text: string;
  values: unknown[];
}

/** The reads the steps make, answered by `answer`; a transaction runs its
 * work on the same fake. */
function fakeSql(answer: (statement: Statement) => unknown[] | Error) {
  const statements: Statement[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const statement = {
      text: strings.join('?').replaceAll(/\s+/g, ' ').trim(),
      values,
    };
    statements.push(statement);
    const given = answer(statement);
    return given instanceof Error
      ? Promise.reject(given)
      : Promise.resolve(given);
  };
  const sql = Object.assign(tag, {
    begin: (work: (tx: unknown) => Promise<unknown>) => work(sql),
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- SQL tag test double
  return { sql: sql as unknown as Sql, statements };
}

function tokenRequest(
  body: string,
  type = 'application/x-www-form-urlencoded',
  headers: Record<string, string> = {},
): Request {
  return new Request('https://tale.example.test/api/auth/oauth2/token', {
    method: 'POST',
    headers: { 'content-type': type, ...headers },
    body,
  });
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(endAgentConnectionsInTx).mockClear();
});

describe('what a token request presents', () => {
  it('is its form fields, or the strings of the JSON it claims to be', async () => {
    expect(
      await tokenRequestFields(
        tokenRequest('grant_type=refresh_token&refresh_token=r1&client_id=c1'),
      ),
    ).toEqual({
      grant_type: 'refresh_token',
      refresh_token: 'r1',
      client_id: 'c1',
    });
    for (const type of [
      'application/json',
      'application/json; charset=utf-8',
      'APPLICATION/JSON',
      'application/vnd.example+json',
    ]) {
      expect(
        await tokenRequestFields(
          tokenRequest(
            JSON.stringify({
              grant_type: 'refresh_token',
              refresh_token: 'r1',
              scope: 7,
              extra: { nested: true },
            }),
            type,
          ),
        ),
        type,
      ).toEqual({ grant_type: 'refresh_token', refresh_token: 'r1' });
    }
  });

  it('is nothing when it is JSON that is no object, JSON that does not parse, or too large to read', async () => {
    expect(
      await tokenRequestFields(tokenRequest('[1,2]', 'application/json')),
    ).toBeNull();
    expect(
      await tokenRequestFields(tokenRequest('"x"', 'application/json')),
    ).toBeNull();
    expect(
      await tokenRequestFields(tokenRequest('{nope', 'application/json')),
    ).toBeNull();
    expect(console.warn).toHaveBeenCalledTimes(1);
    const declared = tokenRequest('grant_type=refresh_token', undefined, {
      'content-length': String(64 * 1024 + 1),
    });
    expect(await tokenRequestFields(declared)).toBeNull();
    const large = `grant_type=refresh_token&pad=${'x'.repeat(64 * 1024)}`;
    expect(await tokenRequestFields(tokenRequest(large))).toBeNull();
    // Exactly the cap is still read, declared or not.
    const head = 'grant_type=refresh_token&pad=';
    const atCap = `${head}${'x'.repeat(64 * 1024 - head.length)}`;
    expect(atCap).toHaveLength(64 * 1024);
    expect(await tokenRequestFields(tokenRequest(atCap))).not.toBeNull();
    expect(
      await tokenRequestFields(
        tokenRequest('grant_type=refresh_token', undefined, {
          'content-length': String(64 * 1024),
        }),
      ),
    ).toEqual({ grant_type: 'refresh_token' });
  });

  it('is read from a clone: the provider still gets the whole body', async () => {
    const request = tokenRequest('grant_type=refresh_token&refresh_token=r1');
    await tokenRequestFields(request);
    expect(await request.text()).toBe(
      'grant_type=refresh_token&refresh_token=r1',
    );
  });
});

describe('how the provider stores a refresh token', () => {
  it('is the SHA-256 of it in unpadded base64url', () => {
    // sha256("abc") = ba7816bf…15ad
    expect(storedRefreshToken('abc')).toBe(
      'ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0',
    );
    expect(storedRefreshToken('abc')).not.toContain('=');
    expect(storedRefreshToken('abd')).not.toBe(storedRefreshToken('abc'));
  });
});

describe('the refresh token a request presents when it is one already used [AGCONN-R16]', () => {
  const now = new Date('2026-10-13T10:00:00.000Z');
  const row = { id: 'rt-1', userId: 'user-ada', clientId: 'https://c.test/c' };

  it('is looked up by how the provider stores it, only while retired, unexpired and past the seconds a retry is answered', async () => {
    const { sql, statements } = fakeSql(() => [row]);
    await expect(
      usedRefreshToken(
        sql,
        { grant_type: 'refresh_token', refresh_token: 'abc' },
        now,
      ),
    ).resolves.toEqual(row);
    const [read] = statements;
    expect(read?.text).toBe(
      'SELECT "id", "userId", "clientId" FROM "oauthRefreshToken" WHERE "token" = ? AND "revoked" IS NOT NULL AND "expiresAt" > ? AND NOT ( "rotatedAt" IS NOT NULL AND "rotationReplayExpiresAt" IS NOT NULL AND "rotationReplayExpiresAt" >= ? ) LIMIT 1',
    );
    expect(read?.values).toEqual([storedRefreshToken('abc'), now, now]);
  });

  it('is nothing for any other grant, a missing, empty or oversized token — and reads nothing then', async () => {
    const { sql, statements } = fakeSql(() => [row]);
    const presented: Record<string, string>[] = [
      { grant_type: 'authorization_code', refresh_token: 'abc' },
      { refresh_token: 'abc' },
      { grant_type: 'refresh_token' },
      { grant_type: 'refresh_token', refresh_token: '' },
      { grant_type: 'refresh_token', refresh_token: 'x'.repeat(2049) },
    ];
    for (const fields of presented) {
      expect(
        await usedRefreshToken(sql, fields, now),
        JSON.stringify(fields),
      ).toBe(null);
    }
    expect(statements).toEqual([]);
    expect(
      await usedRefreshToken(
        sql,
        { grant_type: 'refresh_token', refresh_token: 'x'.repeat(2048) },
        now,
      ),
    ).toEqual(row);
  });

  it('is nothing when no such token is on file, and is not allowed to hold the request up when the lookup fails', async () => {
    const none = fakeSql(() => []);
    expect(
      await usedRefreshToken(
        none.sql,
        { grant_type: 'refresh_token', refresh_token: 'abc' },
        now,
      ),
    ).toBeNull();
    const broken = fakeSql(() => new Error('connection reset'));
    expect(
      await usedRefreshToken(
        broken.sql,
        { grant_type: 'refresh_token', refresh_token: 'abc' },
        now,
      ),
    ).toBeNull();
    expect(console.error).toHaveBeenCalledTimes(1);
  });
});

describe('what Tale does once the provider refused a used refresh token [AGCONN-R16]', () => {
  const used = {
    id: 'rt-1',
    userId: 'user-ada',
    clientId: 'https://c.test/c',
  };

  it('ends every connection of the person and the app, in every organization, as the platform’s doing, when the token is gone', async () => {
    const { sql, statements } = fakeSql(() => []);
    expect(await endAgentsAfterReuse(sql, used)).toBe(1);
    expect(statements[0]?.text).toBe(
      'SELECT "id" FROM "oauthRefreshToken" WHERE "id" = ? LIMIT 1',
    );
    expect(statements[0]?.values).toEqual(['rt-1']);
    // No organization is named: the provider ended the sign-in everywhere.
    expect(vi.mocked(endAgentConnectionsInTx).mock.calls[0]?.[1]).toEqual({
      userId: 'user-ada',
      clientId: 'https://c.test/c',
      reason: 'refresh_reuse',
      revokedBy: 'system',
    });
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it('ends nothing when the token is still on file: the provider refused it for another reason', async () => {
    const { sql } = fakeSql(() => [{ id: 'rt-1' }]);
    expect(await endAgentsAfterReuse(sql, used)).toBe(0);
    expect(endAgentConnectionsInTx).not.toHaveBeenCalled();
  });

  it('never throws: the answer to the agent is the provider’s whatever happens here', async () => {
    const failing = fakeSql(() => new Error('connection reset'));
    expect(await endAgentsAfterReuse(failing.sql, used)).toBe(0);
    vi.mocked(endAgentConnectionsInTx).mockRejectedValueOnce(
      new Error('lock timeout'),
    );
    const { sql } = fakeSql(() => []);
    expect(await endAgentsAfterReuse(sql, used)).toBe(0);
    expect(console.error).toHaveBeenCalledTimes(2);
  });
});
