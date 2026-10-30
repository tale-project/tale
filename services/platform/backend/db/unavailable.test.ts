// @vitest-environment node

import { createServer, type AddressInfo } from 'node:net';

import pg from 'pg';
import postgres from 'postgres';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  databaseUnavailableCause,
  describeDatabaseError,
  isAnyDatabaseUnavailable,
  isDatabaseUnavailable,
  knowledgeDatabaseUnavailable,
  logDetail,
  markKnowledgeDatabaseError,
  noteSwallowedDatabaseError,
  runWithSwallowedDatabaseErrors,
} from './unavailable.ts';

/** An error carrying `code`, the way both drivers and Node report one. */
function coded(code: string, message = `failed: ${code}`): Error {
  return Object.assign(new Error(message), { code });
}

/** A port nothing listens on: bound, read, released. */
async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
  return port;
}

describe('isDatabaseUnavailable', () => {
  it.each(['57P01', '57P02', '57P03', '08000', '08001', '08006', '08P01'])(
    'counts SQLSTATE %s',
    (code) => {
      expect(isDatabaseUnavailable(coded(code))).toBe(true);
    },
  );

  it('reads the SQLSTATE the same off both drivers’ error classes', () => {
    // postgres.js builds its error from the server's fields; its type
    // declares only the message form.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the runtime constructor's real shape
    const PostgresError = postgres.PostgresError as unknown as new (fields: {
      message: string;
      code: string;
    }) => Error;
    const postgresJs = new PostgresError({
      message: 'terminating connection due to administrator command',
      code: '57P01',
    });
    const nodePostgres = new pg.DatabaseError(
      'terminating connection due to administrator command',
      0,
      'error',
    );
    nodePostgres.code = '57P01';
    expect(isDatabaseUnavailable(postgresJs)).toBe(true);
    expect(isDatabaseUnavailable(nodePostgres)).toBe(true);
  });

  it.each([
    ['57014', 'a statement timeout'],
    ['40001', 'a serialization failure'],
    ['23505', 'a unique violation'],
    ['28P01', 'rejected credentials — an operator’s to fix'],
    ['3D000', 'a missing database — an operator’s to fix'],
    ['53300', 'too many connections — capacity, not a restart'],
  ])('leaves SQLSTATE %s (%s) to be reported', (code) => {
    expect(isDatabaseUnavailable(coded(code))).toBe(false);
  });

  it.each([
    'CONNECT_TIMEOUT',
    'CONNECTION_CLOSED',
    'CONNECTION_ENDED',
    'CONNECTION_DESTROYED',
  ])('counts postgres.js’s %s', (code) => {
    expect(isDatabaseUnavailable(coded(code, `write ${code} db:5432`))).toBe(
      true,
    );
  });

  it.each([
    'Connection terminated unexpectedly',
    'Connection terminated due to connection timeout',
  ])('counts node-postgres’s code-less “%s”', (message) => {
    expect(isDatabaseUnavailable(new Error(message))).toBe(true);
  });

  it.each([
    'ECONNREFUSED',
    'ECONNRESET',
    'EAI_AGAIN',
    'ENOTFOUND',
    'ETIMEDOUT',
    'EHOSTUNREACH',
    'ENETUNREACH',
  ])('counts %s from a database client only', (code) => {
    const socket = coded(code);
    // A bare socket error could be the object store's or a model
    // provider's: answering it as a database restart would hide that
    // outage from error tracking.
    expect(isDatabaseUnavailable(socket)).toBe(false);
    expect(isDatabaseUnavailable(socket, { fromDatabase: true })).toBe(true);
    const stamped = Object.assign(coded(code), {
      query: undefined,
      parameters: undefined,
    });
    expect(isDatabaseUnavailable(stamped)).toBe(true);
  });

  it('leaves other socket errors and plain errors alone', () => {
    expect(isDatabaseUnavailable(coded('EPIPE'), { fromDatabase: true })).toBe(
      false,
    );
    expect(isDatabaseUnavailable(new Error('connection refused'))).toBe(false);
    for (const value of [null, undefined, 'ECONNREFUSED', 57, {}]) {
      expect(isDatabaseUnavailable(value)).toBe(false);
    }
  });

  it('follows the cause chain, and a fetch failure stays a fetch failure', () => {
    const wrapped = new Error('could not load the thread', {
      cause: coded('57P01'),
    });
    expect(isDatabaseUnavailable(wrapped)).toBe(true);
    // What `fetch` throws when a model provider refuses the connection.
    const fetchFailed = new TypeError('fetch failed', {
      cause: coded('ECONNREFUSED'),
    });
    expect(isDatabaseUnavailable(fetchFailed)).toBe(false);
  });

  it('stops on a cause chain that loops', () => {
    const looped = new Error('first');
    Object.assign(looped, { cause: looped });
    expect(isDatabaseUnavailable(looped)).toBe(false);
  });

  describe('against the real drivers', () => {
    let port: number;
    beforeAll(async () => {
      port = await closedPort();
    });

    it('counts a postgres.js query refused a connection', async () => {
      const sql = postgres(`postgres://tale:pw@127.0.0.1:${port}/tale`, {
        connect_timeout: 2,
        max: 1,
      });
      try {
        const error: unknown = await sql`SELECT 1`.then(
          () => null,
          (thrown: unknown) => thrown,
        );
        expect(error).toMatchObject({ code: 'ECONNREFUSED' });
        expect(isDatabaseUnavailable(error)).toBe(true);
      } finally {
        await sql.end({ timeout: 0 });
      }
    });

    it('counts a node-postgres refusal once the caller vouches for its origin', async () => {
      const pool = new pg.Pool({
        connectionString: `postgres://tale:pw@127.0.0.1:${port}/tale`,
      });
      try {
        const error: unknown = await pool.query('SELECT 1').then(
          () => null,
          (thrown: unknown) => thrown,
        );
        expect(error).toMatchObject({ code: 'ECONNREFUSED' });
        expect(isDatabaseUnavailable(error)).toBe(false);
        expect(isDatabaseUnavailable(error, { fromDatabase: true })).toBe(true);
      } finally {
        await pool.end();
      }
    });
  });
});

describe('an error a knowledge database raised [KNOW-R20]', () => {
  it('is the knowledge database’s outage, never the platform’s', () => {
    // What postgres.js rejects a query with when an organization's own
    // database refuses the connection: stamped, code and all.
    const refused = Object.assign(
      coded('ECONNREFUSED', 'connect ECONNREFUSED 10.0.0.7:5432'),
      { query: 'select 1', parameters: [] },
    );
    const restart = coded(
      '57P01',
      'terminating connection due to administrator command',
    );
    markKnowledgeDatabaseError(refused, 'organization');
    markKnowledgeDatabaseError(restart, 'deployment');

    expect(isDatabaseUnavailable(refused)).toBe(false);
    expect(knowledgeDatabaseUnavailable(refused)).toBe('organization');
    expect(isDatabaseUnavailable(restart)).toBe(false);
    expect(knowledgeDatabaseUnavailable(restart)).toBe('deployment');
  });

  it('counts a bare socket error under the mark: a database client raised it', () => {
    const reset = coded('ECONNRESET', 'read ECONNRESET');
    markKnowledgeDatabaseError(reset, 'organization');

    expect(knowledgeDatabaseUnavailable(reset)).toBe('organization');
  });

  it('is marked once — the first mark wins, and a repeat says it was not the first', () => {
    // Every query queued on a connection that fails is rejected with the
    // same error object.
    const shared = coded('CONNECTION_CLOSED', 'write CONNECTION_CLOSED');

    expect(markKnowledgeDatabaseError(shared, 'organization')).toBe(true);
    expect(markKnowledgeDatabaseError(shared, 'deployment')).toBe(false);
    expect(knowledgeDatabaseUnavailable(shared)).toBe('organization');
    expect(markKnowledgeDatabaseError('a thrown string', 'deployment')).toBe(
      false,
    );
    expect(markKnowledgeDatabaseError(null, 'deployment')).toBe(false);
  });

  it('follows the mark through the cause chain, either way round', () => {
    const lost = coded('08006', 'connection failure');
    markKnowledgeDatabaseError(lost, 'organization');
    const wrapped = new Error('knowledge search failed', { cause: lost });

    expect(knowledgeDatabaseUnavailable(wrapped)).toBe('organization');
    expect(isDatabaseUnavailable(wrapped)).toBe(false);

    // A marked error that wraps the driver's.
    const marked = new Error('transaction failed', { cause: coded('57P01') });
    markKnowledgeDatabaseError(marked, 'deployment');

    expect(knowledgeDatabaseUnavailable(marked)).toBe('deployment');
    expect(isDatabaseUnavailable(marked)).toBe(false);
  });

  it.each(['CONNECTION_ENDED', 'CONNECTION_DESTROYED'])(
    'is a defect, not an outage, for a pool the platform itself ended (%s)',
    (code) => {
      const ended = coded(code, `write ${code} 10.0.0.7:5432`);
      markKnowledgeDatabaseError(ended, 'organization');

      expect(knowledgeDatabaseUnavailable(ended)).toBeNull();
      expect(isDatabaseUnavailable(ended)).toBe(false);
      expect(logDetail(ended)).toBe(ended);
    },
  );

  it('keeps rejected credentials, a missing database and a defect actionable', () => {
    const errors = [
      coded('28P01', 'password authentication failed for user "tale"'),
      coded('3D000', 'database "corpus" does not exist'),
      coded('42P01', 'relation "documents" does not exist'),
      new TypeError('cannot read properties of undefined'),
    ];
    for (const error of errors) {
      markKnowledgeDatabaseError(error, 'organization');

      expect(knowledgeDatabaseUnavailable(error)).toBeNull();
      expect(isDatabaseUnavailable(error)).toBe(false);
      expect(logDetail(error)).toBe(error);
    }
  });

  it('leaves an unmarked error to the platform’s rule', () => {
    const restart = coded('57P01');

    expect(knowledgeDatabaseUnavailable(restart)).toBeNull();
    expect(isDatabaseUnavailable(restart)).toBe(true);
    expect(knowledgeDatabaseUnavailable(undefined)).toBeNull();
  });

  it('is waited out like the platform’s by what waits either out alike', () => {
    // A boot step, the scan of a corpus's indexes: an outage of either
    // database is one to wait out, and a pool the platform ended is not.
    const restart = coded('57P03', 'the database system is starting up');
    markKnowledgeDatabaseError(restart, 'deployment');
    const ended = coded('CONNECTION_ENDED', 'write CONNECTION_ENDED');
    markKnowledgeDatabaseError(ended, 'deployment');
    const rejected = coded('28P01', 'password authentication failed');
    markKnowledgeDatabaseError(rejected, 'organization');

    expect(isAnyDatabaseUnavailable(restart)).toBe(true);
    expect(isAnyDatabaseUnavailable(coded('57P01'))).toBe(true);
    expect(isAnyDatabaseUnavailable(ended)).toBe(false);
    expect(isAnyDatabaseUnavailable(rejected)).toBe(false);
    // A bare socket error counts only when the caller vouches for it.
    const reset = coded('ECONNRESET', 'read ECONNRESET');
    expect(isAnyDatabaseUnavailable(reset)).toBe(false);
    expect(isAnyDatabaseUnavailable(reset, { fromDatabase: true })).toBe(true);
  });

  it('logs as the one line the platform’s outage logs as', () => {
    const refused = coded('ECONNREFUSED', 'connect ECONNREFUSED 10.0.0.7:5432');
    markKnowledgeDatabaseError(refused, 'organization');

    expect(logDetail(refused)).toBe('connect ECONNREFUSED 10.0.0.7:5432');
  });

  it('reads a real postgres.js refusal, once marked, as the knowledge database’s', async () => {
    const port = await closedPort();
    const sql = postgres(`postgres://tale:pw@127.0.0.1:${port}/corpus`, {
      connect_timeout: 2,
      max: 1,
    });
    try {
      const error: unknown = await sql`SELECT 1`.then(
        () => null,
        (thrown: unknown) => thrown,
      );
      expect(isDatabaseUnavailable(error)).toBe(true);

      markKnowledgeDatabaseError(error, 'organization');

      expect(isDatabaseUnavailable(error)).toBe(false);
      expect(knowledgeDatabaseUnavailable(error)).toBe('organization');
    } finally {
      await sql.end({ timeout: 0 });
    }
  });
});

describe('describeDatabaseError', () => {
  it('names the code once, then the message', () => {
    expect(
      describeDatabaseError(
        coded('57P01', 'terminating connection due to administrator command'),
      ),
    ).toBe('57P01 terminating connection due to administrator command');
    expect(
      describeDatabaseError(
        coded('ECONNREFUSED', 'connect ECONNREFUSED 10.0.0.5:5432'),
      ),
    ).toBe('connect ECONNREFUSED 10.0.0.5:5432');
    expect(describeDatabaseError('plain')).toBe('plain');
  });

  it('reads a plain copy of an error’s fields, as pg-boss re-emits one', () => {
    expect(
      describeDatabaseError({
        code: '57P01',
        message: 'terminating connection due to administrator command',
        queue: 'rag.index_file',
      }),
    ).toBe('57P01 terminating connection due to administrator command');
    expect(describeDatabaseError({ code: '57P01' })).toBe('57P01');
    expect(describeDatabaseError({})).toBe('');
  });
});

describe('a database error a library swallowed', () => {
  /** Better Auth's replacement: a 500 `APIError` without a cause. */
  const bare500 = (): Error =>
    Object.assign(new Error('Failed to get session'), {
      status: 'INTERNAL_SERVER_ERROR',
      statusCode: 500,
    });
  const refused = coded('ECONNREFUSED', 'connect ECONNREFUSED 10.0.0.5:5432');

  it('is recovered for the library’s bare 500 in the same request', async () => {
    const cause = await runWithSwallowedDatabaseErrors(async () => {
      noteSwallowedDatabaseError(refused);
      noteSwallowedDatabaseError(coded('57P03'));
      return databaseUnavailableCause(bare500());
    });
    // The first note wins.
    expect(cause).toBe(refused);
  });

  it('is never borrowed by an error that says something of its own', async () => {
    const cause = await runWithSwallowedDatabaseErrors(async () => {
      noteSwallowedDatabaseError(refused);
      return databaseUnavailableCause(new Error('a defect'));
    });
    expect(cause).toBeUndefined();
  });

  it('notes nothing but an unavailable database, and nothing outside a request', async () => {
    const unrelated = await runWithSwallowedDatabaseErrors(async () => {
      noteSwallowedDatabaseError(coded('23505'));
      return databaseUnavailableCause(bare500());
    });
    expect(unrelated).toBeUndefined();
    noteSwallowedDatabaseError(refused);
    expect(databaseUnavailableCause(bare500())).toBeUndefined();
  });

  it('keeps one request’s note out of another running beside it', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const [noted, clean] = await Promise.all([
      runWithSwallowedDatabaseErrors(async () => {
        noteSwallowedDatabaseError(refused);
        await gate;
        return databaseUnavailableCause(bare500());
      }),
      runWithSwallowedDatabaseErrors(async () => {
        release();
        await gate;
        return databaseUnavailableCause(bare500());
      }),
    ]);
    expect(noted).toBe(refused);
    expect(clean).toBeUndefined();
  });

  it('answers the error itself when it says the database is unavailable', () => {
    const terminated = coded('57P01');
    expect(databaseUnavailableCause(terminated)).toBe(terminated);
    expect(databaseUnavailableCause(refused)).toBeUndefined();
    expect(databaseUnavailableCause(refused, { fromDatabase: true })).toBe(
      refused,
    );
  });
});

describe('logDetail', () => {
  it('is the one line that says the database is away, not its stack', () => {
    const restart = coded(
      '57P01',
      'terminating connection due to administrator command',
    );

    expect(logDetail(restart)).toBe(
      '57P01 terminating connection due to administrator command',
    );
    // The code is not said twice when the message names it already.
    expect(
      logDetail(coded('ECONNREFUSED', 'connect ECONNREFUSED 10.0.0.5:5432'), {
        fromDatabase: true,
      }),
    ).toBe('connect ECONNREFUSED 10.0.0.5:5432');
  });

  it('reads a refused socket postgres.js rejected a statement with as the database’s', () => {
    const refused = Object.assign(
      coded('ECONNREFUSED', 'connect ECONNREFUSED 10.0.0.5:5432'),
      { query: 'select 1', parameters: [] },
    );

    expect(logDetail(refused)).toBe('connect ECONNREFUSED 10.0.0.5:5432');
  });

  it('keeps the evidence of a provider’s refused socket, which is not the database’s', () => {
    // What `fetch` raises when a model provider refuses the connection.
    const providerDown = new TypeError('fetch failed', {
      cause: coded('ECONNREFUSED', 'connect ECONNREFUSED 203.0.113.9:443'),
    });

    expect(logDetail(providerDown)).toBe(providerDown);
  });

  it('is the error itself for anything else, so a defect keeps its stack', () => {
    const defect = new TypeError('cannot read properties of undefined');
    const constraint = coded('23505', 'duplicate key value');

    expect(logDetail(defect)).toBe(defect);
    expect(logDetail(constraint)).toBe(constraint);
    expect(logDetail('a thrown string')).toBe('a thrown string');
  });
});
