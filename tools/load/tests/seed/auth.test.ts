import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { userId } from '../../src/plan.ts';
import {
  assertMintedSessionAccepted,
  mintedSessionCookie,
} from '../../src/seed/auth.ts';
import { SeedHttp } from '../../src/seed/http.ts';

const SECRET = 'the-deployment-secret-0123456789abcdef';
const RUN_ID = 'abcd1234';

describe('the minted-session preflight', () => {
  let server: Server;
  let base = '';

  // A stand-in for Better Auth's `GET /api/auth/get-session`: it knows user
  // 0's minted cookie under SECRET and answers `null` for anything else,
  // exactly as the real endpoint answers an unknown session.
  beforeAll(async () => {
    server = createServer((req, res) => {
      const known = mintedSessionCookie(base, SECRET, RUN_ID, 0);
      const body =
        req.url === '/api/auth/get-session' && req.headers.cookie === known
          ? { user: { id: userId(RUN_ID, 0) }, session: {} }
          : null;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  test('passes when the deployment resolves the minted cookie to the user', async () => {
    const http = new SeedHttp({ target: base, connections: 1 });
    try {
      await assertMintedSessionAccepted(
        http,
        base,
        SECRET,
        { runId: RUN_ID },
        0,
      );
    } finally {
      await http.close();
    }
  });

  test('a wrong secret is one clear error, not a 401 per organization', async () => {
    const http = new SeedHttp({ target: base, connections: 1 });
    try {
      let caught: unknown = null;
      try {
        await assertMintedSessionAccepted(
          http,
          base,
          'not-the-deployment-secret',
          { runId: RUN_ID },
          0,
        );
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(Error);
      expect((caught as Error).message).toContain('BETTER_AUTH_SECRET');
    } finally {
      await http.close();
    }
  });
});
