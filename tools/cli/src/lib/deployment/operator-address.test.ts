import { expect, test } from 'bun:test';

import * as nativeContext from '@better-auth/core/context';
import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';

import { createBackendOperatorAddress } from './operator-address';

const origin = 'https://native.example.org';
const previous = 'operator@example.org';
const declared = 'deploy@example.org';
const secret = 'isolated-native-address-secret-32-characters';
const password = 'isolated-operator-password';

type Row = Record<string, unknown>;

async function fixture(
  body: (f: Awaited<ReturnType<typeof createFixture>>) => Promise<void>,
) {
  await body(await createFixture());
}

async function createFixture() {
  const database: Record<string, Row[]> = {
    user: [],
    session: [],
    account: [],
    verification: [],
  };
  let before = 0;
  let after = 0;
  let modules = 0;
  let scopeUnavailable = false;
  let changeAtWrite: (() => void) | undefined;
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
  const headersOf = (response: Response) =>
    new Headers({
      cookie: response.headers
        .getSetCookie()
        .map((value) => value.split(';')[0])
        .join('; '),
      origin,
    });
  const signIn = async (email: string, secretPassword = password) => {
    const response = await original.api.signInEmail({
      body: { email, password: secretPassword },
      asResponse: true,
    });
    return { status: response.status, headers: headersOf(response) };
  };
  const signUp = async (email: string) => {
    const response = await original.api.signUpEmail({
      body: { name: 'Synthetic person', email, password },
      asResponse: true,
    });
    expect(response.status).toBe(200);
    return headersOf(response);
  };
  const headers = await signUp(previous);
  const user = database.user[0]!;
  database.user[0]!.emailVerified = true;
  // A person signed in as the operator account in another browser.
  expect((await signIn(previous)).status).toBe(200);
  const address = createBackendOperatorAddress({
    origin,
    env: {
      DATABASE_URL: 'synthetic-not-contacted',
      BETTER_AUTH_SECRET: secret,
    },
    loadModule: async (id) => {
      modules++;
      if (id.endsWith('/db/sql.ts'))
        return { createSql: () => ({ end: async () => {} }) };
      if (id.endsWith('/context/index.mjs'))
        return scopeUnavailable
          ? { ...nativeContext, getCurrentAdapter: async () => undefined }
          : nativeContext;
      expect(id).toBe('/app/backend/auth/auth.ts');
      return {
        createAuth: () => {
          const auth = native();
          const context = auth.$context.then((ctx) => {
            const update = ctx.adapter.update.bind(ctx.adapter);
            ctx.adapter.update = async <T>(
              args: Parameters<typeof ctx.adapter.update>[0],
            ) => {
              calls.push(structuredClone(args));
              changeAtWrite?.();
              return update<T>(args);
            };
            return ctx;
          });
          return {
            options: { database: { end: async () => {} } },
            $context: context,
            api: {
              getSession: async (
                args: Parameters<typeof auth.api.getSession>[0],
              ) => {
                await context;
                return auth.api.getSession(args);
              },
            },
          };
        },
      };
    },
  });
  const selection = {
    userId: String(user.id),
    email: declared,
    migrateEmailFrom: previous,
  };
  return {
    database,
    user,
    headers,
    calls,
    signIn,
    signUp,
    counts: () => ({ before, after, modules }),
    sessionsOf: (userId: unknown) =>
      database.session.filter((row) => row.userId === userId),
    disableScope: () => {
      scopeUnavailable = true;
    },
    setChangeAtWrite: (change: () => void) => {
      changeAtWrite = change;
    },
    read: (overrides: Record<string, unknown> = {}) =>
      address.read({ ...selection, ...overrides }),
    rename: (overrides: Record<string, unknown> = {}) =>
      address.rename({ ...selection, headers, ...overrides }),
  };
}

// Portable: this capability keeps no private files.
test('reads the retained account’s current address and refuses another holder of the declared one', async () =>
  fixture(async (f) => {
    expect(await f.read()).toEqual({ email: previous });
    expect(await f.read({ email: declared.toUpperCase() })).toEqual({
      email: previous,
    });
    await expect(f.read({ userId: 'missing-operator' })).rejects.toThrow(
      'The retained operator account is missing; no replacement was created.',
    );
    await f.signUp('someone@example.org');
    const someone = f.database.user.at(-1)!;
    await expect(f.read({ userId: String(someone.id) })).rejects.toThrow(
      'holds neither the declared nor the previous address',
    );
    await f.signUp(declared);
    await expect(f.read()).rejects.toThrow(
      'Another account already holds the declared operator address.',
    );
    await expect(f.rename()).rejects.toThrow(
      'Another account already holds the declared operator address.',
    );
    expect(f.calls).toEqual([]);
    expect(f.user.email).toBe(previous);
  }));

test('refuses to rename an operator that holds a single sign-on link, before any write', async () =>
  fixture(async (f) => {
    f.database.account.push({
      id: 'synthetic-sso-link',
      userId: f.user.id,
      providerId: 'entra-id',
      accountId: 'synthetic-subject',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const sessions = f.sessionsOf(f.user.id).length;
    for (const attempt of [() => f.read(), () => f.rename()])
      await expect(attempt()).rejects.toThrow(
        'The retained operator account holds a single sign-on link; remove it before renaming the operator.',
      );
    expect(f.calls).toEqual([]);
    expect(f.user.email).toBe(previous);
    expect(f.sessionsOf(f.user.id)).toHaveLength(sessions);
  }));

test('renames the authenticated account once through the guarded native update and ends every session it holds', async () =>
  fixture(async (f) => {
    const other = await f.signUp('someone@example.org');
    const someone = f.database.user.at(-1)!;
    const otherSessions = f.sessionsOf(someone.id);
    const accounts = structuredClone(
      f.database.account.filter((row) => row.userId === f.user.id),
    );
    expect(f.sessionsOf(f.user.id)).toHaveLength(2);
    expect(await f.rename()).toEqual({ renamed: true });
    expect(f.calls).toEqual([
      {
        model: 'user',
        update: { email: declared, emailVerified: false },
        where: [
          { field: 'id', value: f.user.id },
          { field: 'email', value: previous, connector: 'AND' },
        ],
      },
    ]);
    expect(f.counts()).toMatchObject({ before: 1, after: 1 });
    const renamed = f.database.user.find((row) => row.id === f.user.id)!;
    expect(renamed).toMatchObject({ email: declared, emailVerified: false });
    expect(f.database.user).toHaveLength(2);
    expect(f.sessionsOf(f.user.id)).toHaveLength(0);
    expect(f.sessionsOf(someone.id)).toEqual(otherSessions);
    expect(
      f.database.account.filter((row) => row.userId === f.user.id),
    ).toEqual(accounts);
    expect((await f.signIn(previous)).status).toBe(401);
    const signedIn = await f.signIn(declared);
    expect(signedIn.status).toBe(200);
    expect(await f.read()).toEqual({ email: declared });
    // Replay after an interruption: no second rename, sessions end again.
    expect(await f.rename({ headers: signedIn.headers })).toEqual({
      renamed: false,
    });
    expect(f.calls).toHaveLength(1);
    expect(f.counts()).toMatchObject({ before: 1, after: 1 });
    expect(f.sessionsOf(f.user.id)).toHaveLength(0);
    await expect(f.rename({ headers: other })).rejects.toThrow(
      'Native operator address migration failed.',
    );
  }));

test('a concurrent address change at the write is refused without overwriting it or ending sessions', async () =>
  fixture(async (f) => {
    f.setChangeAtWrite(() => {
      f.user.email = 'concurrent@example.org';
    });
    const error = await f.rename().catch((value: unknown) => value);
    if (!(error instanceof Error)) throw error;
    expect(error.message).toBe('Native operator address migration failed.');
    expect(JSON.stringify(error)).not.toContain(password);
    expect(f.user.email).toBe('concurrent@example.org');
    expect(f.sessionsOf(f.user.id)).toHaveLength(2);
    expect(f.counts().after).toBe(0);
  }));

test('an unavailable adapter scope refuses before an unguarded native update', async () =>
  fixture(async (f) => {
    f.disableScope();
    await expect(f.rename()).rejects.toThrow('address migration failed');
    expect(f.calls).toEqual([]);
    expect(f.user.email).toBe(previous);
    expect(f.sessionsOf(f.user.id)).toHaveLength(2);
  }));

test('foreign or missing sessions and malformed selections hold without a write', async () =>
  fixture(async (f) => {
    const other = await f.signUp('someone@example.org');
    for (const headers of [new Headers(), other])
      await expect(f.rename({ headers })).rejects.toThrow(
        'Native operator address migration failed.',
      );
    const modules = f.counts().modules;
    for (const overrides of [
      { migrateEmailFrom: declared },
      { migrateEmailFrom: declared.toUpperCase() },
      { email: 'not-an-address' },
      { userId: '' },
    ]) {
      await expect(f.read(overrides)).rejects.toThrow(
        'Invalid operator address migration input.',
      );
      await expect(f.rename(overrides)).rejects.toThrow(
        'Invalid operator address migration input.',
      );
    }
    expect(f.counts().modules).toBe(modules);
    expect(f.calls).toEqual([]);
    expect(f.user.email).toBe(previous);
    expect(f.sessionsOf(f.user.id)).toHaveLength(2);
  }));
