import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import * as nativeContext from '@better-auth/core/context';
import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { hashPassword } from 'better-auth/crypto';

import {
  createBackendBreakGlassAccount,
  reconcileBreakGlassMembership,
} from './break-glass';
import type { NativeClientContext } from './native-client';
import { provisionStatePath, writeProvisionState } from './provision-state';

const origin = 'https://native.example.org';
const operatorEmail = 'operator@example.org';
const address = 'break-glass@example.org';
const secret = 'isolated-native-break-glass-secret-32-characters';
const operatorPassword = 'isolated-operator-password';
const password = 'Synthetic!Break-Glass1';

type Row = Record<string, unknown>;

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
  const root = mkdtempSync(join(tmpdir(), 'tale-break-glass-'));
  const database: Record<string, Row[]> = {
    user: [],
    session: [],
    account: [],
    verification: [],
  };
  let modules = 0;
  let passwordOptions: Record<string, unknown> | undefined;
  let beforeCreate: (() => void) | undefined;
  let failReadback = false;
  // One-shot interruptions at the native writes a run can die between.
  const interruptions = { afterCreate: false, link: false, sweep: false };
  const interrupted = (step: keyof typeof interruptions) => {
    if (!interruptions[step]) return;
    interruptions[step] = false;
    throw new Error(`${password}-${step}-interrupted`);
  };
  const native = () =>
    betterAuth({
      database: memoryAdapter(database),
      secret,
      baseURL: origin,
      logger: { level: 'error', disabled: true },
      telemetry: { enabled: false },
      emailAndPassword: { enabled: true, requireEmailVerification: false },
    });
  const original = native();
  const cookies = (response: Response) =>
    new Headers({
      cookie: response.headers
        .getSetCookie()
        .map((value) => value.split(';')[0])
        .join('; '),
      origin,
    });
  const signUp = async (email: string, secretPassword: string) => {
    const response = await original.api.signUpEmail({
      body: { name: 'Synthetic person', email, password: secretPassword },
      asResponse: true,
    });
    expect(response.status).toBe(200);
    return cookies(response);
  };
  const signIn = async (email: string, secretPassword: string) =>
    (
      await original.api.signInEmail({
        body: { email, password: secretPassword },
        asResponse: true,
      })
    ).status;
  const headers = await signUp(operatorEmail, operatorPassword);
  const operator = database.user[0]!;
  const hash = await hashPassword(password);
  const account = createBackendBreakGlassAccount({
    origin,
    env: {
      DATABASE_URL: 'synthetic-not-contacted',
      BETTER_AUTH_SECRET: secret,
    },
    loadModule: async (id) => {
      modules++;
      if (id.endsWith('/db/sql.ts'))
        return { createSql: () => ({ end: async () => {} }) };
      if (id.endsWith('/context/index.mjs')) return nativeContext;
      expect(id).toBe('/app/backend/auth/auth.ts');
      return {
        createAuth: () => {
          const auth = native();
          const context = auth.$context.then((ctx) => {
            if (passwordOptions)
              Object.assign(ctx.options.emailAndPassword!, passwordOptions);
            const internal = ctx.internalAdapter;
            const createUser = internal.createUser.bind(internal);
            internal.createUser = (async (...args: never[]) => {
              beforeCreate?.();
              const made = await (
                createUser as (...values: never[]) => Promise<unknown>
              )(...args);
              interrupted('afterCreate');
              return made;
            }) as typeof internal.createUser;
            const linkAccount = internal.linkAccount.bind(internal);
            internal.linkAccount = (async (...args: never[]) => {
              interrupted('link');
              return (linkAccount as (...values: never[]) => unknown)(...args);
            }) as typeof internal.linkAccount;
            const deleteUserSessions =
              internal.deleteUserSessions.bind(internal);
            internal.deleteUserSessions = (async (...args: never[]) => {
              interrupted('sweep');
              return (deleteUserSessions as (...values: never[]) => unknown)(
                ...args,
              );
            }) as typeof internal.deleteUserSessions;
            const findAccounts = internal.findAccounts.bind(internal);
            internal.findAccounts = (async (userId: string) => {
              const found = await findAccounts(userId);
              if (failReadback && found.length) {
                failReadback = false;
                throw new Error(`${password}-readback-lost`);
              }
              return found;
            }) as typeof internal.findAccounts;
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
  const journal = join(root, 'private/break-glass.json');
  return {
    root,
    database,
    operator,
    headers,
    hash,
    journal,
    signUp,
    signIn,
    modules: () => modules,
    snapshot: () => structuredClone(database),
    sessionsOf: (userId: unknown) =>
      database.session.filter((row) => row.userId === userId),
    credentialsOf: (userId: unknown) =>
      database.account.filter(
        (row) => row.userId === userId && row.providerId === 'credential',
      ),
    setPasswordOptions: (value: Record<string, unknown>) => {
      passwordOptions = value;
    },
    setBeforeCreate: (value: () => void) => {
      beforeCreate = value;
    },
    loseReadback: () => {
      failReadback = true;
    },
    interrupt: (step: keyof typeof interruptions) => {
      interruptions[step] = true;
    },
    readJournal: () => JSON.parse(readFileSync(journal, 'utf8')) as Row,
    writeJournal: (value: Row) => {
      provisionStatePath(root, 'break-glass.json', true);
      writeProvisionState(journal, value);
    },
    run: (overrides: Record<string, unknown> = {}) =>
      account({
        operatorUserId: String(operator.id),
        email: address,
        passwordHash: hash,
        headers,
        stateDirectory: root,
        ...overrides,
      } as Parameters<typeof account>[0]),
  };
}

// The journal is fsynced under POSIX ownership, as for every managed intent;
// the public managed command refuses Windows before any native work.
const testPosix = test.skipIf(process.platform === 'win32');

testPosix(
  'creates one verified administrator holding exactly the declared hash, journals first and replays without a write',
  async () =>
    fixture(async (f) => {
      let creates = 0;
      f.setBeforeCreate(() => {
        creates++;
        expect(JSON.parse(readFileSync(f.journal, 'utf8'))).toEqual({
          schemaVersion: 1,
          phase: 'pending',
          origin,
          email: address,
        });
      });
      const operatorSessions = f.sessionsOf(f.operator.id);
      const result = await f.run({ email: address.toUpperCase() });
      expect(creates).toBe(1);
      expect(result).toMatchObject({
        email: address,
        created: true,
        credentialUpdated: false,
      });
      const user = f.database.user.find((row) => row.id === result.userId)!;
      expect(user).toMatchObject({
        email: address,
        name: 'Break-glass administrator',
        emailVerified: true,
      });
      expect(f.credentialsOf(result.userId)).toEqual([
        expect.objectContaining({
          accountId: result.userId,
          password: f.hash,
        }),
      ]);
      expect(
        f.database.account.filter((row) => row.userId === result.userId),
      ).toHaveLength(1);
      expect(JSON.parse(readFileSync(f.journal, 'utf8'))).toEqual({
        schemaVersion: 1,
        phase: 'ready',
        origin,
        email: address,
        userId: result.userId,
      });
      // Native sign-in accepts the declared credential; this capability never signs in.
      expect(f.sessionsOf(result.userId)).toHaveLength(0);
      expect(await f.signIn(address, password)).toBe(200);
      expect(f.sessionsOf(f.operator.id)).toEqual(operatorSessions);
      const bytes = readFileSync(f.journal);
      const before = f.snapshot();
      const replay = await f.run();
      expect(replay).toEqual({ ...result, created: false });
      expect(creates).toBe(1);
      expect(f.snapshot()).toEqual(before);
      expect(readFileSync(f.journal)).toEqual(bytes);
      expect(JSON.stringify([result, bytes.toString()])).not.toContain(f.hash);
    }),
);

testPosix(
  'a changed declared hash replaces the credential and ends only that account’s sessions',
  async () =>
    fixture(async (f) => {
      const first = await f.run();
      expect(await f.signIn(address, password)).toBe(200);
      expect(f.sessionsOf(first.userId)).toHaveLength(1);
      const operatorSessions = f.sessionsOf(f.operator.id);
      const bytes = readFileSync(f.journal);
      const rotated = 'Rotated!Break-Glass2';
      const hash = await hashPassword(rotated);
      const result = await f.run({ passwordHash: hash });
      expect(result).toEqual({
        userId: first.userId,
        email: address,
        created: false,
        credentialUpdated: true,
      });
      expect(f.sessionsOf(first.userId)).toHaveLength(0);
      expect(f.sessionsOf(f.operator.id)).toEqual(operatorSessions);
      expect(f.credentialsOf(first.userId)).toEqual([
        expect.objectContaining({ password: hash }),
      ]);
      expect(await f.signIn(address, password)).toBe(401);
      expect(await f.signIn(address, rotated)).toBe(200);
      expect(readFileSync(f.journal)).toEqual(bytes);
    }),
);

testPosix(
  'never takes over an account at the address that this deployment did not create',
  async () =>
    fixture(async (f) => {
      // Someone else's account: it can sign in, so an administrator role
      // would be theirs to use whatever credential the deploy later sets.
      await f.signUp(address, 'synthetic-previous-password');
      const existing = f.database.user.find((row) => row.email === address)!;
      const before = f.snapshot();
      await expect(f.run()).rejects.toThrow(
        'belongs to an account this deployment did not create',
      );
      expect(readdirSync(f.root)).toEqual([]);
      expect(f.snapshot()).toEqual(before);
      // A pending journal of this deployment does not make it ours either.
      const pending = {
        schemaVersion: 1,
        phase: 'pending',
        origin,
        email: address,
      };
      f.writeJournal(pending);
      await expect(f.run()).rejects.toThrow(
        'belongs to an account this deployment did not create',
      );
      expect(f.readJournal()).toEqual(pending);
      expect(f.snapshot()).toEqual(before);
      expect(f.sessionsOf(existing.id)).toHaveLength(1);
      expect(await f.signIn(address, password)).toBe(401);
    }),
);

testPosix(
  'an interruption after creating the account resumes by adopting that inert account',
  async () =>
    fixture(async (f) => {
      f.interrupt('afterCreate');
      await expect(f.run()).rejects.toThrow('provisioning failed');
      // Committed without its binding or credential: nothing can sign in as it.
      const [orphan, ...others] = f.database.user.filter(
        (row) => row.email === address,
      );
      expect(others).toEqual([]);
      expect(
        f.database.account.filter((row) => row.userId === orphan!.id),
      ).toEqual([]);
      expect(f.readJournal()).toEqual({
        schemaVersion: 1,
        phase: 'pending',
        origin,
        email: address,
      });
      const result = await f.run();
      expect(result).toEqual({
        userId: String(orphan!.id),
        email: address,
        created: true,
        credentialUpdated: false,
      });
      expect(f.credentialsOf(orphan!.id)).toEqual([
        expect.objectContaining({ password: f.hash }),
      ]);
      expect(f.readJournal()).toEqual({
        schemaVersion: 1,
        phase: 'ready',
        origin,
        email: address,
        userId: orphan!.id,
      });
      expect(await f.signIn(address, password)).toBe(200);
    }),
);

testPosix(
  'the account is bound before its credential, so an interrupted link resumes on it',
  async () =>
    fixture(async (f) => {
      f.interrupt('link');
      await expect(f.run()).rejects.toThrow('provisioning failed');
      const account = f.database.user.find((row) => row.email === address);
      expect(f.credentialsOf(account!.id)).toEqual([]);
      expect(f.readJournal()).toEqual({
        schemaVersion: 1,
        phase: 'pending',
        origin,
        email: address,
        userId: account!.id,
        credentialPending: 'linked',
      });
      expect(await f.run()).toEqual({
        userId: String(account!.id),
        email: address,
        created: true,
        credentialUpdated: false,
      });
      expect(f.database.user.filter((row) => row.email === address)).toEqual([
        account!,
      ]);
      expect(f.credentialsOf(account!.id)).toEqual([
        expect.objectContaining({ password: f.hash }),
      ]);
      expect(f.readJournal()).toMatchObject({ phase: 'ready' });
      expect(f.readJournal().credentialPending).toBeUndefined();
    }),
);

testPosix(
  'an interrupted readback resumes without writing the credential again',
  async () =>
    fixture(async (f) => {
      f.loseReadback();
      const error = await f.run().catch((value: unknown) => value);
      if (!(error instanceof Error)) throw error;
      expect(error.message).toBe(
        'Native break-glass administrator provisioning failed.',
      );
      expect(JSON.stringify(error)).not.toContain(password);
      expect(f.readJournal()).toMatchObject({
        phase: 'pending',
        credentialPending: 'linked',
      });
      const created = f.database.user.filter((row) => row.email === address);
      expect(created).toHaveLength(1);
      const before = f.snapshot();
      const result = await f.run();
      expect(result).toEqual({
        userId: String(created[0]!.id),
        email: address,
        created: true,
        credentialUpdated: false,
      });
      expect(f.snapshot()).toEqual(before);
      expect(f.readJournal()).toEqual({
        schemaVersion: 1,
        phase: 'ready',
        origin,
        email: address,
        userId: created[0]!.id,
      });
    }),
);

testPosix(
  'a rotation interrupted before its session sweep still ends the old sessions on replay',
  async () =>
    fixture(async (f) => {
      const first = await f.run();
      // A session opened with the password the rotation is meant to retire.
      expect(await f.signIn(address, password)).toBe(200);
      expect(f.sessionsOf(first.userId)).toHaveLength(1);
      const rotated = 'Rotated!Break-Glass2';
      const hash = await hashPassword(rotated);
      f.interrupt('sweep');
      await expect(f.run({ passwordHash: hash })).rejects.toThrow(
        'provisioning failed',
      );
      // The new credential is stored, the old session is not yet gone.
      expect(f.credentialsOf(first.userId)).toEqual([
        expect.objectContaining({ password: hash }),
      ]);
      expect(f.sessionsOf(first.userId)).toHaveLength(1);
      expect(f.readJournal()).toMatchObject({
        phase: 'ready',
        credentialPending: 'replaced',
      });
      const result = await f.run({ passwordHash: hash });
      expect(result).toEqual({
        userId: first.userId,
        email: address,
        created: false,
        credentialUpdated: true,
      });
      expect(f.sessionsOf(first.userId)).toHaveLength(0);
      expect(f.readJournal().credentialPending).toBeUndefined();
      expect(await f.signIn(address, password)).toBe(401);
      expect(await f.signIn(address, rotated)).toBe(200);
      // Once swept, a replay reports nothing changed.
      expect(await f.run({ passwordHash: hash })).toEqual({
        ...result,
        credentialUpdated: false,
      });
    }),
);

testPosix(
  'refuses the operator, another account, a missing retained account or a foreign journal before a native write',
  async () =>
    fixture(async (f) => {
      const before = f.snapshot();
      await expect(f.run({ email: operatorEmail })).rejects.toThrow(
        'belongs to the deploy operator',
      );
      expect(readdirSync(f.root)).toEqual([]);
      const ready = {
        schemaVersion: 1,
        phase: 'ready',
        origin,
        email: address,
        userId: 'retained-break-glass',
      };
      f.writeJournal(ready);
      await expect(f.run()).rejects.toThrow(
        'no longer holds its address; no replacement was created',
      );
      expect(f.snapshot()).toEqual(before);
      await f.signUp(address, 'synthetic-previous-password');
      const other = f.snapshot();
      await expect(f.run()).rejects.toThrow(
        'belongs to an account other than the retained administrator',
      );
      for (const change of [
        { email: 'other-break-glass@example.org' },
        { origin: 'https://foreign.example.org' },
      ]) {
        f.writeJournal({ ...ready, ...change });
        await expect(f.run()).rejects.toThrow(
          'differs from the declared address',
        );
      }
      expect(f.snapshot()).toEqual(other);
    }),
);

testPosix(
  'a hostname migration admits the previous origin’s completed journal and a pending one at the new origin',
  async () =>
    fixture(async (f) => {
      const previous = 'https://old.example.org';
      const first = await f.run();
      const ready = JSON.parse(readFileSync(f.journal, 'utf8'));
      f.writeJournal({ ...ready, origin: previous, phase: 'pending' });
      await expect(f.run({ migrateOriginFrom: previous })).rejects.toThrow(
        'differs from the declared address',
      );
      f.writeJournal({ ...ready, origin: previous });
      await expect(f.run()).rejects.toThrow(
        'differs from the declared address',
      );
      expect(await f.run({ migrateOriginFrom: previous })).toEqual({
        ...first,
        created: false,
      });
      expect(JSON.parse(readFileSync(f.journal, 'utf8'))).toEqual(ready);
      f.writeJournal({ ...ready, phase: 'pending' });
      await f.run({ migrateOriginFrom: previous });
      expect(JSON.parse(readFileSync(f.journal, 'utf8'))).toEqual(ready);
    }),
);

testPosix(
  'foreign sessions, custom native hashing and malformed hashes hold without a write or disclosure',
  async () =>
    fixture(async (f) => {
      const before = f.snapshot();
      const personal = await f.signUp(
        'someone@example.org',
        'synthetic-person-password',
      );
      const withPerson = f.snapshot();
      for (const overrides of [
        { headers: new Headers() },
        { headers: personal },
        { operatorUserId: 'another-operator' },
      ]) {
        const error = await f.run(overrides).catch((value: unknown) => value);
        if (!(error instanceof Error)) throw error;
        expect(error.message).toBe(
          'Native break-glass administrator provisioning failed.',
        );
      }
      f.setPasswordOptions({
        password: { hash: async () => 'custom', verify: async () => true },
      });
      await expect(f.run()).rejects.toThrow('provisioning failed');
      expect(readdirSync(f.root)).toEqual([]);
      expect(f.snapshot()).toEqual(withPerson);
      const modules = f.modules();
      for (const passwordHash of [
        f.hash.toUpperCase(),
        `${f.hash}\n`,
        password,
      ]) {
        const error = await f
          .run({ passwordHash })
          .catch((value: unknown) => value);
        if (!(error instanceof Error)) throw error;
        expect(error.message).toBe('Invalid break-glass administrator input.');
        expect(JSON.stringify(error)).not.toContain(f.hash);
        expect(JSON.stringify(error)).not.toContain(password);
      }
      expect(f.modules()).toBe(modules);
      expect(before.user.some((row) => row.email === address)).toBe(false);
      expect(f.database.user.some((row) => row.email === address)).toBe(false);
    }),
);

describe('break-glass membership over the operator session', () => {
  function members(initial: { id: string; userId: string; role: string }[]) {
    const rows = initial.map((row) => ({
      ...row,
      organizationId: 'org-north',
    }));
    const calls: { path: string; method: string; body?: unknown }[] = [];
    const overrides: { list?: unknown; ignoreWrites?: boolean } = {};
    const context: Pick<
      NativeClientContext,
      'organization' | 'request' | 'requireJson'
    > = {
      organization: { id: 'org-north', slug: 'north' },
      request: async (path, method = 'GET', body) => {
        calls.push({ path, method, ...(body ? { body } : {}) });
        if (path === '/api/app/members?orgId=org-north' && method === 'GET')
          return Response.json(overrides.list ?? { members: rows });
        if (overrides.ignoreWrites) return Response.json({ ok: true });
        if (path === '/api/app/members?orgId=org-north' && method === 'POST') {
          const added = body as { userId: string; role: string };
          rows.push({
            id: `member-${added.userId}`,
            organizationId: 'org-north',
            ...added,
          });
          return Response.json({ memberId: `member-${added.userId}` });
        }
        // The native organization-scope check guards the by-member routes
        // too: a role change without `orgId` is answered 400 there.
        if (/^\/api\/app\/members\/[^?]+\/role$/.test(path))
          return Response.json(
            { error: '"orgId" is required', code: 'INVALID_QUERY' },
            { status: 400 },
          );
        const role = path.match(
          /^\/api\/app\/members\/([^/?]+)\/role\?orgId=org-north$/,
        );
        if (role && method === 'POST') {
          const row = rows.find(
            (value) => value.id === decodeURIComponent(role[1]!),
          )!;
          row.role = (body as { role: string }).role;
          return Response.json({ ok: true });
        }
        return Response.json({ error: 'unexpected' }, { status: 404 });
      },
      requireJson: async (response, operation) => {
        if (!response.ok) throw new Error(`${operation} failed`);
        return response.json();
      },
    };
    return { rows, calls, overrides, context };
  }
  const operator = { id: 'member-operator', userId: 'operator', role: 'owner' };

  test('adds an absent account as admin through the member door', async () => {
    const f = members([operator]);
    await reconcileBreakGlassMembership(f.context, 'break-glass');
    expect(f.calls).toEqual([
      { path: '/api/app/members?orgId=org-north', method: 'GET' },
      {
        path: '/api/app/members?orgId=org-north',
        method: 'POST',
        body: { userId: 'break-glass', role: 'admin' },
      },
      { path: '/api/app/members?orgId=org-north', method: 'GET' },
    ]);
    expect(f.rows.at(-1)).toMatchObject({
      userId: 'break-glass',
      role: 'admin',
    });
  });

  test.each(['member', 'editor', 'developer', 'disabled'])(
    'promotes a %s membership to admin',
    async (role) => {
      const f = members([
        operator,
        { id: 'member/glass', userId: 'break-glass', role },
      ]);
      await reconcileBreakGlassMembership(f.context, 'break-glass');
      expect(f.calls.map((call) => [call.method, call.path])).toEqual([
        ['GET', '/api/app/members?orgId=org-north'],
        ['POST', '/api/app/members/member%2Fglass/role?orgId=org-north'],
        ['GET', '/api/app/members?orgId=org-north'],
      ]);
      expect(f.calls[1]?.body).toEqual({ role: 'admin' });
      expect(f.rows[1]?.role).toBe('admin');
    },
  );

  test.each(['admin', 'owner', 'OWNER'])(
    'never modifies an existing %s membership',
    async (role) => {
      const f = members([
        operator,
        { id: 'member-glass', userId: 'break-glass', role },
      ]);
      await reconcileBreakGlassMembership(f.context, 'break-glass');
      expect(f.calls).toEqual([
        { path: '/api/app/members?orgId=org-north', method: 'GET' },
      ]);
      expect(f.rows[1]?.role).toBe(role);
    },
  );

  test.each([
    [
      'an ambiguous membership',
      {
        members: [
          {
            id: 'a',
            organizationId: 'org-north',
            userId: 'break-glass',
            role: 'member',
          },
          {
            id: 'b',
            organizationId: 'org-north',
            userId: 'break-glass',
            role: 'member',
          },
        ],
      },
      'Ambiguous',
    ],
    [
      'another organization’s members',
      {
        members: [
          {
            id: 'a',
            organizationId: 'org-foreign',
            userId: 'someone',
            role: 'owner',
          },
        ],
      },
      'Unexpected organization member response',
    ],
    ['a malformed list', { members: [{ id: 'a' }] }, 'Unexpected'],
  ])('refuses %s without a write', async (_name, list, message) => {
    const f = members([operator]);
    f.overrides.list = list;
    await expect(
      reconcileBreakGlassMembership(f.context, 'break-glass'),
    ).rejects.toThrow(message);
    expect(f.calls.every((call) => call.method === 'GET')).toBe(true);
  });

  test('refuses a membership that does not converge', async () => {
    const f = members([operator]);
    f.overrides.ignoreWrites = true;
    await expect(
      reconcileBreakGlassMembership(f.context, 'break-glass'),
    ).rejects.toThrow('did not converge');
  });
});
