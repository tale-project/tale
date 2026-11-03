// The Secrets tab as the manager sees it: personal information, credentials,
// credit cards and notes, for every session or for one (how fields are cleaned
// is `vault.test.ts`).

import { afterEach, describe, expect, it } from 'vitest';

import type { SecretFieldIn } from '../../../lib/api/schemas.ts';
import {
  addProxy,
  createSession,
  createTestManager,
  refusalOf,
  waitForStatus,
} from '../../testing/harness.ts';
import type { TestManager } from '../../testing/harness.ts';
import { KIND_KEYS } from '../secrets/vault.ts';

const apps: TestManager[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function setup(options?: Parameters<typeof createTestManager>[0]): TestManager {
  const app = createTestManager(options);
  apps.push(app);
  return app;
}

type ListOptions = NonNullable<
  Parameters<TestManager['manager']['listSecrets']>[0]
>;

/** A value the types would not allow, as it arrives from a client. */
function fromJson<T>(text: string): T {
  const value: T = JSON.parse(text);
  return value;
}

const LOGIN = {
  kind: 'credentials',
  title: 'Shop login',
  fields: [
    { label: 'Website', value: 'https://shop.example' },
    { label: 'Username', value: 'yannick@example.com' },
    { label: 'Password', value: 'hunter2' },
  ],
} as const;

const CARD = {
  kind: 'card',
  title: 'Visa',
  fields: [
    { label: 'Cardholder', value: 'Y. Monney' },
    { label: 'Card number', value: '4242 4242 4242 4242' },
    { label: 'Expiry', value: '12/30' },
    { label: 'CVC', value: '123' },
  ],
} as const;

const NOTE = {
  kind: 'note',
  title: 'Todo',
  fields: [{ label: 'Note', value: 'buy milk' }],
} as const;

/** Two sessions, a and b, each on its own proxy. */
async function twoSessions(app: TestManager) {
  for (const n of [1, 2]) addProxy(app.manager, `192.0.2.${n}:8080`);
  const a = await createSession(app.manager, 'a');
  const b = await createSession(app.manager, 'b');
  return { a, b };
}

describe('the overview', () => {
  it('lists the kinds and counts the secrets', () => {
    const { manager } = setup();
    const meta = manager.meta();
    expect(meta.secretKinds.map((kind) => kind.key)).toEqual([...KIND_KEYS]);
    expect(meta.secretKinds.map((kind) => kind.label)).toEqual([
      'Personal information',
      'Credentials',
      'Credit card',
      'Note',
    ]);
    const password = meta.secretKinds[1].fields.find(
      (field) => field.label === 'Password',
    );
    expect(password).toEqual({
      label: 'Password',
      hidden: true,
      multiline: false,
    });
    expect(meta.counts.secrets).toBe(0);
    manager.createSecret(LOGIN);
    expect(manager.meta().counts.secrets).toBe(1);
  });

  it('hands out copies of the kinds, so that nobody changes the originals', () => {
    const { manager } = setup();
    const first = manager.meta().secretKinds;
    first[0].fields[0].label = 'changed';
    first.pop();
    expect(manager.meta().secretKinds).toHaveLength(4);
    expect(manager.meta().secretKinds[0].fields[0].label).toBe('Name');
  });
});

describe('a secret', () => {
  it('is created, read, updated and deleted', async () => {
    let now = new Date('2026-11-01T09:00:00Z');
    const { manager } = setup({ now: () => now });
    const created = manager.createSecret(LOGIN);
    expect([created.kind, created.title, created.session]).toEqual([
      'credentials',
      'Shop login',
      null,
    ]);
    // The preview has no password.
    expect(created.preview).toBe('https://shop.example · yannick@example.com');
    expect(created.fields.map((field) => [field.label, field.hidden])).toEqual([
      ['Website', false],
      ['Username', false],
      ['Password', true],
    ]);
    expect(created.createdAt).toBe(created.updatedAt);
    expect(created.createdAt).toBe('2026-11-01T09:00:00+00:00');

    const detail = manager.getSecret(created.id);
    expect(detail.fields[2]).toEqual({
      label: 'Password',
      value: 'hunter2',
      hidden: true,
    });

    now = new Date('2026-11-01T10:00:00Z');
    const retitled = manager.updateSecret(created.id, { title: 'Shop' });
    expect(retitled.title).toBe('Shop');
    expect(retitled.fields).toEqual(detail.fields); // fields untouched
    expect(retitled.createdAt).toBe('2026-11-01T09:00:00+00:00');
    expect(retitled.updatedAt).toBe('2026-11-01T10:00:00+00:00');

    const replaced = manager.updateSecret(created.id, {
      fields: [
        { label: 'Username', value: 'other' },
        { label: 'Password', value: 'new' },
      ],
    });
    expect(replaced.fields.map((field) => field.value)).toEqual([
      'other',
      'new',
    ]);
    expect(replaced.fields[1].hidden).toBe(true);
    expect(replaced.title).toBe('Shop');

    manager.deleteSecret(created.id);
    const gone = await refusalOf(() => manager.getSecret(created.id));
    expect([gone.status, gone.code]).toEqual([404, 'secret_not_found']);
    expect(gone.message).toBe(`Secret ${created.id} does not exist.`);
    expect((await refusalOf(() => manager.deleteSecret(created.id))).code).toBe(
      'secret_not_found',
    );
    expect(
      (await refusalOf(() => manager.updateSecret(999, { title: 'x' }))).status,
    ).toBe(404);
  });

  it('keeps a field that was shown or hidden on purpose when only the title changes', () => {
    const { manager } = setup();
    const created = manager.createSecret({
      kind: 'note',
      title: 'Notes',
      fields: [
        { label: 'Password', value: 'shown', hidden: false },
        { label: 'Plain', value: 'hidden', hidden: true },
      ],
    });
    expect(created.fields.map((field) => field.hidden)).toEqual([false, true]);
    const retitled = manager.updateSecret(created.id, { title: 'Other' });
    expect(retitled.fields.map((field) => field.hidden)).toEqual([false, true]);
  });

  it('cannot change its kind, and cleans its fields again when they are replaced', async () => {
    const { manager } = setup();
    const card = manager.createSecret(CARD);
    // As a card: the number is masked by the kind.
    const replaced = manager.updateSecret(card.id, {
      fields: [{ label: 'card NUMBER', value: '4242' }],
    });
    expect(replaced.kind).toBe('card');
    expect(replaced.fields[0].hidden).toBe(true);
    const refused = await refusalOf(() =>
      manager.updateSecret(card.id, { fields: [] }),
    );
    expect([refused.status, refused.code]).toEqual([422, 'invalid_secret']);
    expect(manager.getSecret(card.id).fields).toHaveLength(1); // unchanged
  });
});

describe('the lists', () => {
  it('hide masked values and filter by kind, newest first', async () => {
    const { manager } = setup();
    manager.createSecret(LOGIN);
    const card = manager.createSecret(CARD);
    manager.createSecret(NOTE);

    const everything = manager.listSecrets();
    expect(everything.map((secret) => secret.title)).toEqual([
      'Todo',
      'Visa',
      'Shop login',
    ]);
    const text = JSON.stringify(everything);
    expect(text).not.toContain('hunter2');
    expect(text).not.toContain('4242 4242');
    expect(card.preview).not.toContain('123');
    expect(everything.find((secret) => secret.title === 'Visa')?.preview).toBe(
      '•••• 4242 · Y. Monney · 12/30',
    );
    expect(Object.keys(everything[0]).sort()).toEqual([
      'id',
      'kind',
      'preview',
      'session',
      'title',
      'updatedAt',
    ]);

    expect(
      manager.listSecrets({ kind: 'card' }).map((secret) => secret.title),
    ).toEqual(['Visa']);
    const unknown = await refusalOf(() =>
      manager.listSecrets(fromJson<ListOptions>('{"kind": "diary"}')),
    );
    expect([unknown.status, unknown.code]).toEqual([422, 'invalid_kind']);
    expect(unknown.message).toBe(
      'The kind of secret must be one of: personal, credentials, card, note.',
    );
  });

  it('belong to every session or to one', async () => {
    const app = setup();
    const { a, b } = await twoSessions(app);
    const { manager } = app;
    const everyone = manager.createSecret({ ...LOGIN, title: 'For everyone' });
    const forA = manager.createSecret({
      ...CARD,
      title: 'Only a',
      sessionId: a.id,
    });
    manager.createSecret({ ...CARD, title: 'Only b', sessionId: b.id });
    expect(forA.session).toMatchObject({ id: a.id, name: 'a' });

    const titles = (options?: Parameters<typeof manager.listSecrets>[0]) =>
      manager.listSecrets(options).map((secret) => secret.title);
    expect(titles()).toEqual(['Only b', 'Only a', 'For everyone']);
    expect(titles({ scope: 'global' })).toEqual(['For everyone']);
    expect(titles({ scope: a.id })).toEqual(['Only a']);
    expect(titles({ scope: a.id, includeGlobal: true })).toEqual([
      'Only a',
      'For everyone',
    ]);
    const missing = await refusalOf(() => manager.listSecrets({ scope: 999 }));
    expect([missing.status, missing.code]).toEqual([404, 'session_not_found']);

    // The scope can change, back to everyone too.
    const moved = manager.updateSecret(everyone.id, { session: b.id });
    expect(moved.session?.id).toBe(b.id);
    const freed = manager.updateSecret(forA.id, { session: 'global' });
    expect(freed.session).toBeNull();
    expect(titles({ scope: 'global' })).toEqual(['Only a']);
    const kept = manager.updateSecret(forA.id, { title: 'Still global' });
    expect(kept.session).toBeNull(); // 'keep' is the default
    const badSession = await refusalOf(() =>
      manager.updateSecret(forA.id, { session: 999 }),
    );
    expect([badSession.status, badSession.code]).toEqual([
      404,
      'session_not_found',
    ]);
  });

  it('name the session by its current name and status', async () => {
    const app = setup();
    const { a } = await twoSessions(app);
    const secret = app.manager.createSecret({ ...NOTE, sessionId: a.id });
    await waitForStatus(app.manager, a.id, 'running');
    app.manager.renameSession(a.id, 'renamed');
    expect(app.manager.getSecret(secret.id).session).toEqual({
      id: a.id,
      name: 'renamed',
      status: 'running',
    });
    expect(app.manager.listSecrets()[0].session).toEqual({
      id: a.id,
      name: 'renamed',
      status: 'running',
    });
  });

  it('are deleted with their session, and only those', async () => {
    const app = setup();
    addProxy(app.manager, '192.0.2.1:8080');
    const session = await createSession(app.manager, 'a');
    app.manager.createSecret({ ...CARD, sessionId: session.id });
    const keep = app.manager.createSecret(LOGIN);
    await app.manager.deleteSession(session.id);
    expect(app.manager.listSecrets().map((secret) => secret.id)).toEqual([
      keep.id,
    ]);
    expect(app.manager.meta().counts.secrets).toBe(1);
  });
});

describe('a bad secret', () => {
  const bad: [
    string,
    Parameters<TestManager['manager']['createSecret']>[0],
    string,
    number,
  ][] = [
    ['without values', { ...LOGIN, fields: [] }, 'invalid_secret', 422],
    ['without a title', { ...LOGIN, title: '  ' }, 'invalid_secret', 422],
    [
      'with a value without a label',
      { ...LOGIN, fields: [{ label: '', value: 'x' }] },
      'invalid_secret',
      422,
    ],
    [
      'for a session that does not exist',
      { ...LOGIN, sessionId: 999 },
      'session_not_found',
      404,
    ],
    [
      'of a kind that does not exist',
      { ...LOGIN, ...fromJson<{ kind: 'note' }>('{"kind": "diary"}') },
      'invalid_kind',
      422,
    ],
  ];

  it.each(bad)('is refused: %s', async (_why, input, code, status) => {
    const { manager } = setup();
    const refusal = await refusalOf(() => manager.createSecret(input));
    expect([refusal.status, refusal.code]).toEqual([status, code]);
    expect(manager.listSecrets()).toEqual([]);
  });

  it('says why in the words of the vault', async () => {
    const { manager } = setup();
    const refusal = await refusalOf(() =>
      manager.createSecret({ ...NOTE, fields: [] as SecretFieldIn[] }),
    );
    expect(refusal.message).toBe('Fill in at least one value.');
  });
});

describe('an id beyond what the database can hold', () => {
  it('is simply unknown', async () => {
    const { manager } = setup();
    const huge = 10 ** 20;
    expect((await refusalOf(() => manager.getSecret(huge))).status).toBe(404);
    expect((await refusalOf(() => manager.deleteSecret(huge))).status).toBe(
      404,
    );
    expect((await refusalOf(() => manager.session(huge))).status).toBe(404);
    expect((await refusalOf(() => manager.proxy(huge))).status).toBe(404);
    expect((await refusalOf(() => manager.checkProxy(huge))).status).toBe(404);
    expect(
      (await refusalOf(() => manager.listSecrets({ scope: huge }))).code,
    ).toBe('session_not_found');
    const refused = await refusalOf(() =>
      manager.createSecret({ ...NOTE, sessionId: huge }),
    );
    expect(refused.status).toBe(404);
    expect(refused.message).toContain('does not exist');
  });
});
