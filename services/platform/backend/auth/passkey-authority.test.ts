// @vitest-environment node

import { createHash } from 'node:crypto';

import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import {
  createPasskeyAuthority,
  qualifyingPasskeyIds,
  setSessionMintAuthority,
  sessionMintAuthority,
  clearSessionMintAuthority,
} from './passkey-authority.ts';

const FENCE = Date.UTC(2001, 0, 1);
const EPOCH = 'org_session_factor_inventory:2001-01-01T00:00:00.000Z';
const hash = (value: string) =>
  createHash('sha256').update(value).digest('hex');

function database(answer: (text: string, values: unknown[]) => unknown[]) {
  const queries: { text: string; values: unknown[] }[] = [];
  let transactions = 0;
  const tag = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?');
    queries.push({ text, values });
    return answer(text, values);
  };
  const sql = Object.assign(tag, {
    begin: async (run: (tx: unknown) => unknown) => {
      transactions += 1;
      return run(tag);
    },
  }) as unknown as Sql;
  return { sql, queries, transactions: () => transactions };
}

describe('cutover custody inventory boundary', () => {
  it('does not inventory or refuse historic sessions before operator activation', async () => {
    const db = database(() => []);
    const service = createPasskeyAuthority(db.sql, null);
    await service.inventory();
    await service.inventory();
    expect(db.transactions()).toBe(1);
    expect(db.queries.some((query) => query.text.includes('INSERT'))).toBe(
      false,
    );
  });

  it('requires an already-reached fence before it opens the inventory transaction', async () => {
    const db = database(() => []);
    await expect(
      createPasskeyAuthority(db.sql, Date.now() + 60_000).inventory(),
    ).rejects.toThrow('already have been reached');
    expect(db.transactions()).toBe(0);
  });

  it('captures exact session/user refusals and public credential custody before one epoch ledger', async () => {
    const db = database((text, values) =>
      text.includes('FROM "passkey"') && values[0] === ''
        ? [
            {
              id: 'credential-a',
              userId: 'user-a',
              credentialID: 'public-handle-a',
            },
          ]
        : [],
    );
    const service = createPasskeyAuthority(db.sql, FENCE);
    await Promise.all([service.inventory(), service.inventory()]);
    expect(db.transactions()).toBe(1);
    const capture = db.queries.findIndex((query) =>
      query.text.includes('INSERT INTO app.auth_legacy_session_refusals'),
    );
    const factor = db.queries.findIndex((query) =>
      query.text.includes('INSERT INTO app.auth_factor_authorities'),
    );
    const ledger = db.queries.findIndex((query) =>
      query.text.includes('INSERT INTO app.boot_repairs'),
    );
    expect(capture).toBeGreaterThan(0);
    expect(factor).toBeGreaterThan(capture);
    expect(ledger).toBeGreaterThan(factor);
    expect(db.queries[capture]?.text).toContain('FOR UPDATE OF s, a');
    expect(db.queries[capture]?.text).toContain(
      's."independentIdentityVerifiedAt" IS NULL',
    );
    expect(db.queries[factor]?.values).toEqual([
      hash('public-handle-a'),
      'credential-a',
      'user-a',
    ]);
    expect(db.queries[ledger]?.values).toEqual([EPOCH]);
    expect(
      db.queries.every(
        (query) =>
          !/\b(?:UPDATE|DELETE) "(?:user|session|account|passkey)"/.test(
            query.text,
          ),
      ),
    ).toBe(true);
  });

  it.each([null, FENCE + 1])(
    'refuses an absent or changed flag after custody was recorded: %s',
    async (fence) => {
      const db = database((text) =>
        text.includes('FROM app.boot_repairs') ? [{ name: EPOCH }] : [],
      );
      await expect(
        createPasskeyAuthority(db.sql, fence).inventory(),
      ).rejects.toThrow('does not match');
      expect(db.queries.some((query) => query.text.includes('INSERT'))).toBe(
        false,
      );
    },
  );

  it('does not reclassify factors when a second instance sees the same epoch', async () => {
    const db = database((text) =>
      text.includes('FROM app.boot_repairs') ? [{ name: EPOCH }] : [],
    );
    await createPasskeyAuthority(db.sql, FENCE).inventory();
    expect(
      db.queries.some(
        (query) =>
          query.text.includes('FROM "passkey"') ||
          query.text.includes('INSERT'),
      ),
    ).toBe(false);
  });

  it('lets the maintained boot retry after an inventory transaction refuses', async () => {
    let refuse = true;
    const db = database((text) => {
      if (refuse && text.includes('FROM app.boot_repairs'))
        throw new Error('owned fixture refusal');
      return text.includes('FROM app.boot_repairs') ? [{ name: EPOCH }] : [];
    });
    const service = createPasskeyAuthority(db.sql, FENCE);
    await expect(service.inventory()).rejects.toThrow('owned fixture refusal');
    refuse = false;
    await expect(service.inventory()).resolves.toBeUndefined();
    expect(db.transactions()).toBe(2);
  });
});

describe('factor qualification remains realm bound', () => {
  it('retains inventoried legacy/global factors and only the matching org factor', async () => {
    const credentials = [
      'legacy',
      'global',
      'org-a',
      'org-b',
      'pending',
      'unknown',
    ].map((id) => ({ id, userId: 'user-a', credentialID: `public-${id}` }));
    const db = database((text, values) => {
      if (text.includes('FROM "passkey"'))
        return values[1] === '' ? credentials : [];
      return credentials
        .filter((row) => row.id !== 'unknown')
        .map((row) => ({
          fingerprint: hash(row.credentialID),
          credentialId: row.id,
          userId: row.userId,
          organizationId: row.id.startsWith('org-') ? row.id : null,
          authority: row.id.startsWith('org-')
            ? 'organization'
            : row.id === 'legacy'
              ? 'legacy_compatible'
              : 'global',
          state: row.id === 'pending' ? 'pending' : 'bound',
        }));
    });
    expect(
      await qualifyingPasskeyIds(db.sql, 'user-a', 'org-a', FENCE),
    ).toEqual(['legacy', 'global', 'org-a']);
    expect(
      await qualifyingPasskeyIds(db.sql, 'user-a', undefined, FENCE),
    ).toEqual(['legacy', 'global']);
    expect(await qualifyingPasskeyIds(db.sql, 'user-a', 'org-a', null)).toEqual(
      ['legacy', 'global', 'org-a', 'unknown'],
    );
  });

  it('does not qualify custody bound to another credential row or user', async () => {
    const db = database((text, values) =>
      text.includes('FROM "passkey"')
        ? values[1] === ''
          ? [{ id: 'id-a', userId: 'user-a', credentialID: 'public-a' }]
          : []
        : [
            {
              fingerprint: hash('public-a'),
              credentialId: 'other-id',
              userId: 'other-user',
              organizationId: null,
              authority: 'legacy_compatible',
              state: 'bound',
            },
          ],
    );
    expect(
      await qualifyingPasskeyIds(db.sql, 'user-a', 'org-a', FENCE),
    ).toEqual([]);
  });
});

describe('mint hints are private and survive library context merging', () => {
  it('uses the same genuine request and never copies body fields or process state', () => {
    const request = new Request(
      'https://tale.example.invalid/api/auth/passkey/verify-authentication',
    );
    const ctx = { request, context: {} };
    const mint = {
      userId: 'user-a',
      organizationId: 'org-a',
      trustedRole: 'member',
      signedInByProxy: true,
      independentIdentityVerifiedAt: null,
    };
    setSessionMintAuthority(ctx, mint);
    expect(sessionMintAuthority({ request, context: { other: true } })).toEqual(
      mint,
    );
    expect(
      sessionMintAuthority({
        request: new Request(request),
        context: { ...mint },
      }),
    ).toBeNull();
    clearSessionMintAuthority(ctx);
    expect(sessionMintAuthority(ctx)).toBeNull();
  });

  it('refuses a hint that does not say whether a proxy signed in', () => {
    const request = new Request(
      'https://tale.example.invalid/api/auth/passkey/verify-authentication',
    );
    const ctx = { request, context: {} };
    setSessionMintAuthority(ctx, {
      userId: 'user-a',
      organizationId: 'org-a',
      trustedRole: 'member',
      signedInByProxy: 'true',
      independentIdentityVerifiedAt: null,
    } as never);
    expect(sessionMintAuthority(ctx)).toBeNull();
  });
});

describe('proxy role ceilings survive a logged-out factor ceremony', () => {
  it('records the asserted ceiling when a scoped proxy session enrolls', async () => {
    const db = database((text) => {
      if (text.includes('FROM app.boot_repairs')) return [{ name: EPOCH }];
      if (text.includes('FROM "passkey"')) return [];
      return [];
    });
    const service = createPasskeyAuthority(db.sql, FENCE);
    const request = new Request(
      'https://tale.example.invalid/api/auth/passkey/verify-registration',
    );
    const ctx = {
      request,
      context: { session: { session: { authenticationDoor: 'session' } } },
    };
    setSessionMintAuthority(ctx, {
      userId: 'user-a',
      organizationId: 'org-a',
      trustedRole: 'member',
      signedInByProxy: true,
      independentIdentityVerifiedAt: null,
    });
    const callback = service.options.registration?.afterVerification;
    if (callback === undefined)
      throw new Error('registration callback missing');
    await callback({
      ctx,
      verification: {
        verified: true,
        registrationInfo: { credential: { id: 'proxy-public-handle' } },
      },
      user: { id: 'user-a' },
    } as never);
    const staged = db.queries.find((query) =>
      query.text.includes('INSERT INTO app.auth_factor_authorities'),
    );
    expect(staged?.values).toContain('member');
    expect(staged?.text).toContain('trusted_role');
  });

  // A passkey enrolled behind a proxy, as the case above stores it.
  const proxyEnrolledFactor = () =>
    database((text) => {
      if (text.includes('FROM app.boot_repairs')) return [{ name: EPOCH }];
      if (text.includes('FROM "passkey"'))
        return [
          { id: 'pk-a', userId: 'user-a', credentialID: 'proxy-public-handle' },
        ];
      if (text.includes('FROM app.auth_factor_authorities'))
        return [
          {
            credentialId: 'pk-a',
            userId: 'user-a',
            organizationId: 'org-a',
            trustedRole: 'member',
            authority: 'organization',
            state: 'bound',
          },
        ];
      return [];
    });
  const authenticate = async (
    db: ReturnType<typeof proxyEnrolledFactor>,
    ctx: { request: Request; context: object },
  ) => {
    const callback = createPasskeyAuthority(db.sql, FENCE).options
      .authentication?.afterVerification;
    if (callback === undefined)
      throw new Error('authentication callback missing');
    await callback({
      ctx,
      verification: { verified: true },
      clientData: { id: 'proxy-public-handle' },
    } as never);
  };

  it('restores the stored ceiling when a logged-out factor authenticates', async () => {
    const request = new Request(
      'https://tale.example.invalid/api/auth/passkey/verify-authentication',
    );
    const ctx = { request, context: {} };
    await authenticate(proxyEnrolledFactor(), ctx);
    // The ceiling stays, but its person signed in on Tale's own form, and
    // signs out in the app: no proxy will (#5259).
    expect(sessionMintAuthority(ctx)).toMatchObject({
      userId: 'user-a',
      organizationId: 'org-a',
      trustedRole: 'member',
      signedInByProxy: false,
    });
  });

  it("keeps a proxy's sign-in when its person authenticates under it", async () => {
    const request = new Request(
      'https://tale.example.invalid/api/auth/passkey/verify-authentication',
    );
    const ctx = { request, context: {} };
    setSessionMintAuthority(ctx, {
      userId: 'user-a',
      organizationId: 'org-a',
      trustedRole: 'member',
      signedInByProxy: true,
      independentIdentityVerifiedAt: null,
    });
    await authenticate(proxyEnrolledFactor(), ctx);
    expect(sessionMintAuthority(ctx)).toMatchObject({
      userId: 'user-a',
      organizationId: 'org-a',
      trustedRole: 'member',
      signedInByProxy: true,
    });
  });

  it('fails closed rather than persisting a malformed proxy ceiling', async () => {
    const db = database((text) =>
      text.includes('FROM app.boot_repairs') ? [{ name: EPOCH }] : [],
    );
    const service = createPasskeyAuthority(db.sql, FENCE);
    const request = new Request(
      'https://tale.example.invalid/api/auth/passkey/verify-registration',
    );
    const ctx = {
      request,
      context: { session: { session: { authenticationDoor: 'session' } } },
    };
    setSessionMintAuthority(ctx, {
      userId: 'user-a',
      organizationId: 'org-a',
      trustedRole: 'owner',
      signedInByProxy: true,
      independentIdentityVerifiedAt: null,
    });
    const callback = service.options.registration?.afterVerification;
    if (callback === undefined)
      throw new Error('registration callback missing');
    await expect(
      callback({
        ctx,
        verification: {
          verified: true,
          registrationInfo: { credential: { id: 'bad-handle' } },
        },
        user: { id: 'user-a' },
      } as never),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});
