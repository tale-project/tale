import { expect, test } from 'bun:test';
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import * as nativeContext from '@better-auth/core/context';
import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { createEmailVerificationToken } from 'better-auth/api';

import { oidcOrganizationClaims } from '../../../../../services/platform/backend/auth/oidc';
import { createBackendEmailAttestation } from './email-attestation';

const origin = 'https://native.example.org';
const email = 'operator@example.org';
const secret = 'isolated-native-email-signing-secret-32-characters';
const password = 'isolated-account-password';

async function fixture(
  body: (f: Awaited<ReturnType<typeof createFixture>>) => Promise<void>,
) {
  const f = await createFixture();
  try {
    await body(f);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
}

async function createFixture() {
  const root = mkdtempSync(join(tmpdir(), 'tale-email-attestation-'));
  const database: Record<string, Record<string, unknown>[]> = {
    user: [],
    session: [],
    account: [],
    verification: [],
  };
  let before = 0;
  let after = 0;
  let writes = 0;
  let closed = 0;
  let tokenMode = 'normal';
  let scopeUnavailable = false;
  let loseResponse = false;
  let changeAtWrite: (() => void) | undefined;
  let optionsOverride: Record<string, unknown> | undefined;
  const calls: unknown[] = [];
  const native = () =>
    betterAuth({
      database: memoryAdapter(database),
      secret,
      baseURL: origin,
      logger: { level: 'error', disabled: true },
      telemetry: { enabled: false },
      emailAndPassword: { enabled: true, requireEmailVerification: false },
      databaseHooks: {
        user: {
          update: {
            before: async () => {
              before++;
            },
            after: async () => {
              after++;
            },
          },
        },
      },
    });
  const original = native();
  const signup = await original.api.signUpEmail({
    body: { name: 'Declared operator', email, password },
    asResponse: true,
  });
  expect(signup.status).toBe(200);
  const headers = new Headers({
    cookie: signup.headers
      .getSetCookie()
      .map((v) => v.split(';')[0])
      .join('; '),
    origin,
  });
  const user = database.user[0]!;
  const sessionCount = database.session.length;
  const api = createBackendEmailAttestation({
    origin,
    env: {
      DATABASE_URL: 'synthetic-not-contacted',
      BETTER_AUTH_SECRET: secret,
    },
    loadModule: async (id) => {
      if (id.endsWith('/db/sql.ts'))
        return {
          createSql: () => ({
            end: async () => {
              closed++;
            },
          }),
        };
      if (id.endsWith('/api/index.mjs'))
        return {
          createEmailVerificationToken: async (
            value: string,
            selected: string,
            updateTo: undefined,
            ttl: number,
          ) => {
            expect(value).toBe(secret);
            expect(selected).toBe(email);
            expect(updateTo).toBeUndefined();
            expect(ttl).toBe(60);
            const token = await createEmailVerificationToken(
              tokenMode === 'signature' ? 'different-secret' : value,
              selected,
              undefined,
              tokenMode === 'expired' ? -1 : ttl,
            );
            const payload = JSON.parse(
              Buffer.from(token.split('.')[1]!, 'base64url').toString(),
            );
            expect(Object.keys(payload).sort()).toEqual([
              'email',
              'exp',
              'iat',
            ]);
            expect(payload.exp - payload.iat).toBe(
              tokenMode === 'expired' ? -1 : ttl,
            );
            return token;
          },
        };
      if (id.endsWith('/context/index.mjs'))
        return scopeUnavailable
          ? { ...nativeContext, getCurrentAdapter: async () => undefined }
          : nativeContext;
      expect(id).toBe('/app/backend/auth/auth.ts');
      return {
        createAuth: () => {
          const auth = native();
          const context = auth.$context.then((ctx) => {
            if (optionsOverride)
              Object.assign(ctx.options, {
                emailVerification: optionsOverride,
              });
            const update = ctx.adapter.update.bind(ctx.adapter);
            ctx.adapter.update = async <T>(
              args: Parameters<typeof ctx.adapter.update>[0],
            ) => {
              calls.push(structuredClone(args));
              changeAtWrite?.();
              const result = await update<T>(args);
              if (result) writes++;
              return result;
            };
            return ctx;
          });
          return {
            options: {
              database: {
                end: async () => {
                  closed++;
                },
              },
            },
            $context: context,
            api: {
              getSession: async (
                args: Parameters<typeof auth.api.getSession>[0],
              ) => {
                await context;
                expect(args?.query).toEqual({
                  disableCookieCache: true,
                  disableRefresh: true,
                });
                return auth.api.getSession(args);
              },
              verifyEmail: async (
                args: Parameters<typeof auth.api.verifyEmail>[0],
              ) => {
                await context;
                expect(Object.keys(args!)).toEqual(['query']);
                expect(Object.keys(args!.query)).toEqual(['token']);
                const pending = JSON.parse(
                  readFileSync(
                    join(root, 'private/email-attestation.json'),
                    'utf8',
                  ),
                );
                expect(pending.phase).toBe('pending');
                expect(pending.userId).toBe(user.id);
                expect(pending.email).toBe(email);
                const result = await auth.api.verifyEmail(args);
                if (loseResponse) throw new Error(`${password}-response-lost`);
                return result;
              },
            },
          };
        },
      };
    },
  });
  return {
    root,
    database,
    user,
    headers,
    sessionCount,
    calls,
    run: (overrides: Record<string, unknown> = {}) =>
      api({
        userId: String(user.id),
        email,
        headers,
        stateDirectory: root,
        ...overrides,
      }),
    setTokenMode: (mode: string) => {
      tokenMode = mode;
    },
    disableScope: () => {
      scopeUnavailable = true;
    },
    setLoseResponse: () => {
      loseResponse = true;
    },
    setChangeAtWrite: (change: () => void) => {
      changeAtWrite = change;
    },
    setOptions: (value: Record<string, unknown>) => {
      optionsOverride = value;
    },
    counts: () => ({ before, after, writes, closed }),
  };
}

// The native attestation intent is fsynced under POSIX ownership/permissions.
// The public managed command refuses Windows. Pre-intent policy stays portable;
// later failures must not pass merely because the directory fsync failed first.
const testPosix = test.skipIf(process.platform === 'win32');

testPosix(
  'native public signup remains unverified; explicit attestation preserves hooks and sessions and replays without a write',
  async () =>
    fixture(async (f) => {
      expect(f.user.emailVerified).toBe(false);
      let queried = false;
      await expect(
        oidcOrganizationClaims(
          (async () => {
            queried = true;
            return [];
          }) as never,
          { id: String(f.user.id), emailVerified: false },
          'org',
        ),
      ).rejects.toThrow('IDENTITY_NOT_ELIGIBLE');
      expect(queried).toBe(false);
      const result = await f.run();
      expect(result).toMatchObject({
        method: 'operator-attested',
        userId: f.user.id,
        email,
        emailVerified: true,
      });
      expect(f.user.emailVerified).toBe(true);
      expect(f.database.session.length).toBe(f.sessionCount);
      expect(f.counts()).toEqual({ before: 1, after: 1, writes: 1, closed: 2 });
      expect(f.calls[0]).toMatchObject({
        model: 'user',
        update: { emailVerified: true },
        where: [
          { field: 'email', value: email },
          { field: 'id', value: f.user.id, connector: 'AND' },
          { field: 'emailVerified', value: false, connector: 'AND' },
        ],
      });
      const saved = readFileSync(result.receipt.path);
      expect(JSON.stringify(result)).not.toContain(password);
      expect(saved.toString()).not.toContain(secret);
      expect(saved.toString()).not.toContain('token');
      expect((await f.run()).receipt).toEqual(result.receipt);
      expect(readFileSync(result.receipt.path)).toEqual(saved);
      expect(f.counts().writes).toBe(1);
    }),
);

testPosix.each(['expired', 'signature'])(
  'native %s token is refused without verification or token disclosure',
  async (mode) =>
    fixture(async (f) => {
      f.setTokenMode(mode);
      const error = await f.run().catch((value) => value);
      expect(error.message).toBe('Native operator email attestation failed.');
      expect(JSON.stringify(error)).not.toContain(secret);
      expect(f.user.emailVerified).toBe(false);
      expect(f.counts().writes).toBe(0);
      expect(f.database.session.length).toBe(f.sessionCount);
    }),
);

testPosix(
  'accepted response loss reconciles only the retained authenticated account with no second native write',
  async () =>
    fixture(async (f) => {
      f.setLoseResponse();
      await expect(f.run()).rejects.toThrow('attestation failed');
      expect(f.user.emailVerified).toBe(true);
      expect(
        JSON.parse(
          readFileSync(join(f.root, 'private/email-attestation.json'), 'utf8'),
        ).phase,
      ).toBe('pending');
      await f.run();
      expect(f.counts().writes).toBe(1);
      f.user.emailVerified = false;
      await expect(f.run()).rejects.toThrow('attestation failed');
      expect(f.counts().writes).toBe(1);
    }),
);

test('wrong account, email, session and unsafe native options refuse before an intent or write', async () =>
  fixture(async (f) => {
    for (const selected of [
      { userId: 'another-user' },
      { email: 'other@example.org' },
      { headers: new Headers() },
    ])
      await expect(f.run(selected)).rejects.toThrow('attestation failed');
    for (const selected of [
      { autoSignInAfterVerification: true },
      { beforeEmailVerification: async () => {} },
      { afterEmailVerification: async () => {} },
    ]) {
      f.setOptions(selected);
      await expect(f.run()).rejects.toThrow('attestation failed');
    }
    expect(readdirSync(f.root)).toEqual([]);
    expect(f.counts().writes).toBe(0);
  }));

testPosix(
  'concurrent email reassignment cannot verify a different ID and keeps native failure hooks intact',
  async () =>
    fixture(async (f) => {
      f.setChangeAtWrite(() => {
        f.user.email = 'renamed@example.org';
        f.database.user.push({
          ...f.user,
          id: 'different-user',
          email,
          emailVerified: false,
        });
      });
      await expect(f.run()).rejects.toThrow('attestation failed');
      expect(
        f.database.user.every((user) => user.emailVerified === false),
      ).toBe(true);
      expect(f.counts().writes).toBe(0);
    }),
);

testPosix(
  'unavailable native adapter scope refuses before verifyEmail can make an unguarded write',
  async () =>
    fixture(async (f) => {
      f.disableScope();
      await expect(f.run()).rejects.toThrow('attestation failed');
      expect(f.counts().writes).toBe(0);
      expect(f.user.emailVerified).toBe(false);
    }),
);

testPosix(
  'retained intent mutation cannot turn a successful native write into a trusted receipt',
  async () =>
    fixture(async (f) => {
      f.setChangeAtWrite(() => {
        const file = join(f.root, 'private/email-attestation.json');
        const intent = JSON.parse(readFileSync(file, 'utf8'));
        writeFileSync(file, JSON.stringify({ ...intent, phase: 'ready' }));
      });
      await expect(f.run()).rejects.toThrow('attestation failed');
      expect(f.counts().writes).toBe(1);
    }),
);
