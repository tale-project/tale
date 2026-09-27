// @vitest-environment node

import { EventEmitter } from 'node:events';
import { createServer, type AddressInfo } from 'node:net';

import pg from 'pg';
import type { Sql } from 'postgres';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { signCookieValue } from '../core/enterprise_sso/sign_cookie_value.ts';
import {
  databaseUnavailableCause,
  runWithSwallowedDatabaseErrors,
} from '../db/unavailable.ts';
import { createAuth } from './auth.ts';

/**
 * Better Auth against a database that is not there — a restart, as the api
 * process meets it. Its pool must not turn a dropped connection into an
 * uncaught exception (the process exited on every `db` recreation), and its
 * session read, which throws a bare 500 in place of the adapter's error, must
 * leave the real error where the error handlers find it. The session read runs
 * the real library against a closed port: an upgrade that stops logging the
 * swallowed error fails here, not in production.
 */

const SECRET = 'test-secret-at-least-16-chars';

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

let databaseUrl: string;

beforeAll(async () => {
  databaseUrl = `postgresql://tale:pw@127.0.0.1:${await closedPort()}/tale_app`;
});

afterEach(() => {
  vi.restoreAllMocks();
});

function authAgainstNothing() {
  return createAuth({
    databaseUrl,
    secret: SECRET,
    baseUrl: 'http://localhost:3000',
    // The session read never reaches the app query lane.
    sql: null as unknown as Sql,
  });
}

function poolOf(auth: ReturnType<typeof createAuth>): pg.Pool {
  const pool = auth.options.database;
  if (!(pool instanceof pg.Pool)) throw new Error('not a node-postgres pool');
  return pool;
}

describe('Better Auth’s pool when the database drops its connections', () => {
  it('logs an idle client’s drop instead of throwing it', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const pool = poolOf(authAgainstNothing());
    const terminated = Object.assign(
      new Error('terminating connection due to administrator command'),
      { code: '57P01' },
    );
    // pg-pool re-emits an idle client's error on the pool; with no listener
    // EventEmitter throws it, which is how the process used to exit.
    expect(() => pool.emit('error', terminated, {})).not.toThrow();
    expect(warn).toHaveBeenCalledWith(
      '[backend] auth database connection dropped: 57P01 terminating connection due to administrator command',
    );
  });

  it('listens on a checked-out client for exactly as long as it is out', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const pool = poolOf(authAgainstNothing());
    const client = new EventEmitter();
    pool.emit('acquire', client);
    expect(() =>
      client.emit('error', new Error('Connection terminated unexpectedly')),
    ).not.toThrow();
    pool.emit('release', undefined, client);
    expect(client.listenerCount('error')).toBe(0);
  });
});

describe('Better Auth’s session read when the database is unavailable', () => {
  it('throws its bare 500, and the refused connection behind it is noted for the request', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const auth = authAgainstNothing();
    const cookie = `better-auth.session_token=${await signCookieValue('session-token', SECRET)}`;

    const outcome = await runWithSwallowedDatabaseErrors(async () => {
      const thrown: unknown = await auth.api
        .getSession({ headers: new Headers({ cookie }) })
        .then(
          () => null,
          (reason: unknown) => reason,
        );
      return { thrown, cause: databaseUnavailableCause(thrown) };
    });

    // What the error handlers receive: no cause, just a 500.
    expect(outcome.thrown).toMatchObject({ statusCode: 500 });
    expect(outcome.thrown).not.toHaveProperty('cause');
    // What they can still find: the database error Better Auth logged.
    expect(outcome.cause).toMatchObject({ code: 'ECONNREFUSED' });
    // Logged as one warn line, not an error stack per request.
    expect(error).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(
        /\[Better Auth\]: INTERNAL_SERVER_ERROR — database unavailable: connect ECONNREFUSED/,
      ),
    );
    await poolOf(auth).end();
  });
});
