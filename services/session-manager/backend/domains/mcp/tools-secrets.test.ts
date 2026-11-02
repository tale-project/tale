import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import type { Secret } from '../../../lib/api/schemas.ts';
import { AppError } from '../../errors.ts';
import { FakeRemote, fakeLaunchSpec } from '../../testing/fake-browser.ts';
import {
  callTool,
  jsonOf,
  textOf,
  unframed,
} from '../../testing/mcp-client.ts';
import {
  secretFixture,
  sessionFixture,
  stubManager,
  summaryOf,
} from '../../testing/mcp-stub-manager.ts';
import type { Manager } from '../sessions/manager.ts';

const remotes: FakeRemote[] = [];

afterEach(() => {
  for (const remote of remotes.splice(0)) remote.close();
  vi.restoreAllMocks();
});

const first = sessionFixture({ id: 1, name: '0001' });
const other = sessionFixture({ id: 2, name: 'other' });

const login = secretFixture({
  id: 1,
  title: 'Shop',
  preview: 'me',
  fields: [
    { label: 'Username', value: 'me', hidden: false },
    { label: 'Password', value: 'hunter2', hidden: true },
  ],
});
const emails = secretFixture({
  id: 2,
  kind: 'personal',
  title: 'Me',
  session: { id: 1, name: '0001', status: 'running' },
  preview: 'a@example.com',
  fields: [
    { label: 'Email', value: 'a@example.com', hidden: false },
    { label: 'Email', value: 'b@example.com', hidden: false },
  ],
});

function setup(overrides: Partial<Manager> = {}) {
  const remote = new FakeRemote(fakeLaunchSpec());
  remotes.push(remote);
  const secrets: Secret[] = [emails, login];
  const manager = stubManager({
    listSessions: () => [other, first],
    remote: () => remote,
    getSecret: (id) => {
      const found = secrets.find((secret) => secret.id === id);
      if (found === undefined) {
        throw new AppError(
          404,
          'secret_not_found',
          'That secret does not exist.',
        );
      }
      return found;
    },
    ...overrides,
  });
  return { remote, manager, secrets };
}

describe('list_secrets', () => {
  it('lists secrets with the session they belong to, and never a masked value', async () => {
    const listSecrets = vi.fn(() => [emails, login].map(summaryOf));
    const { manager } = setup({ listSecrets });
    const listed = jsonOf(await callTool(manager, 'list_secrets'));
    expect(listed).toEqual([
      {
        id: 2,
        kind: 'personal',
        title: 'Me',
        scope: '0001',
        preview: 'a@example.com',
      },
      {
        id: 1,
        kind: 'credentials',
        title: 'Shop',
        scope: 'all sessions',
        preview: 'me',
      },
    ]);
    expect(JSON.stringify(listed)).not.toContain('hunter2');
    expect(listSecrets).toHaveBeenCalledExactlyOnceWith({
      kind: null,
      scope: 'all',
      includeGlobal: true,
    });
  });

  it('lists the secrets of one kind, or of one session', async () => {
    const listSecrets = vi.fn(() => []);
    const { manager } = setup({ listSecrets });
    await callTool(manager, 'list_secrets', { kind: 'credentials' });
    await callTool(manager, 'list_secrets', {
      session: '0001',
      include_global: false,
    });
    await callTool(manager, 'list_secrets', { session: 2 });
    expect(listSecrets.mock.calls).toEqual([
      [{ kind: 'credentials', scope: 'all', includeGlobal: true }],
      [{ kind: null, scope: 1, includeGlobal: false }],
      [{ kind: null, scope: 2, includeGlobal: true }],
    ]);
  });

  it('says so when it does not know the session or the kind', async () => {
    const { manager } = setup({ listSecrets: () => [] });
    const unknown = await callTool(manager, 'list_secrets', {
      session: 'nope',
    });
    expect(textOf(unknown)).toContain('There is no session “nope”');
    const kind = await callTool(manager, 'list_secrets', { kind: 'recipe' });
    expect(kind.isError).toBe(true);
    expect(textOf(kind)).toContain('- kind: ');
  });
});

describe('get_secret', () => {
  it('has every value, the masked ones too', async () => {
    const { manager } = setup();
    expect(
      jsonOf(await callTool(manager, 'get_secret', { secret_id: 1 })),
    ).toEqual({
      id: 1,
      kind: 'credentials',
      title: 'Shop',
      scope: 'all sessions',
      fields: [
        { label: 'Username', value: 'me' },
        { label: 'Password', value: 'hunter2' },
      ],
    });
  });

  it('keeps two values of one label', async () => {
    const { manager } = setup();
    const secret = z
      .object({
        scope: z.string(),
        fields: z.array(z.object({ value: z.string() })),
      })
      .parse(jsonOf(await callTool(manager, 'get_secret', { secret_id: 2 })));
    expect(secret.scope).toBe('0001');
    expect(secret.fields.map((field) => field.value)).toEqual([
      'a@example.com',
      'b@example.com',
    ]);
  });

  it('says that a secret does not exist', async () => {
    const { manager } = setup();
    const result = await callTool(manager, 'get_secret', { secret_id: 9 });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('does not exist');
  });
});

describe('type_secret', () => {
  it('types a value into the field with a number, without saying it', async () => {
    const { manager, remote } = setup();
    const result = await callTool(manager, 'type_secret', {
      session: '0001',
      secret_id: 1,
      field: 'password',
      element: 1,
    });
    expect(textOf(result)).toBe('Typed the Password of “Shop”.');
    expect(textOf(result)).not.toContain('hunter2');
    expect(remote.events).toEqual([['fillElement', 1, 'hunter2', false]]);
  });

  it('types where the focus is, and presses Enter on request', async () => {
    const { manager, remote } = setup();
    await callTool(manager, 'type_secret', {
      session: '0001',
      secret_id: 1,
      field: 'Username',
      submit: true,
    });
    expect(remote.events).toEqual([
      ['text', 'me'],
      ['key', 'press', 'Enter'],
    ]);
  });

  it('picks among values with the same label', async () => {
    const { manager, remote } = setup();
    await callTool(manager, 'type_secret', {
      session: '0001',
      secret_id: 2,
      field: 'Email',
      occurrence: 2,
      element: 1,
    });
    await callTool(manager, 'type_secret', {
      session: '0001',
      secret_id: 2,
      field: 'EMAIL',
      element: 1,
    });
    expect(remote.events).toEqual([
      ['fillElement', 1, 'b@example.com', false],
      ['fillElement', 1, 'a@example.com', false],
    ]);
  });

  it('says which values the secret has when it has not the one asked for, never their content', async () => {
    const { manager, remote } = setup();
    const missing = await callTool(manager, 'type_secret', {
      session: '0001',
      secret_id: 1,
      field: 'PIN',
    });
    expect(missing.isError).toBe(true);
    expect(textOf(missing)).toBe(
      '“Shop” has no value “PIN”. It has: Username, Password.',
    );
    expect(textOf(missing)).not.toContain('hunter2');
    expect(remote.events).toEqual([]);
  });

  it('says how many values there are when the occurrence is not one of them', async () => {
    const { manager, remote } = setup();
    for (const occurrence of [3, 0, -1]) {
      const result = await callTool(manager, 'type_secret', {
        session: '0001',
        secret_id: 2,
        field: 'Email',
        occurrence,
      });
      expect(result.isError, String(occurrence)).toBe(true);
      expect(textOf(result)).toContain('2 value(s) named Email');
    }
    expect(remote.events).toEqual([]);
  });

  it('types a secret of a session only in that session', async () => {
    const { manager, remote } = setup();
    const result = await callTool(manager, 'type_secret', {
      session: 'other',
      secret_id: 2,
      field: 'Email',
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(
      '“Me” belongs to session 0001, not to this one.',
    );
    expect(remote.events).toEqual([]);
  });

  it('types a secret for every session in any session', async () => {
    const { manager, remote } = setup();
    await callTool(manager, 'type_secret', {
      session: 'other',
      secret_id: 1,
      field: 'Password',
    });
    expect(remote.events).toEqual([['text', 'hunter2']]);
  });

  it('says so when the session or the secret is not there, before it types anything', async () => {
    const { manager, remote } = setup();
    const noSession = await callTool(manager, 'type_secret', {
      session: 'nope',
      secret_id: 1,
      field: 'Password',
    });
    expect(textOf(noSession)).toContain('There is no session “nope”');
    const noSecret = await callTool(manager, 'type_secret', {
      session: '0001',
      secret_id: 9,
      field: 'Password',
    });
    expect(textOf(noSecret)).toContain('does not exist');
    expect(remote.events).toEqual([]);
  });

  it('tells about a dialog that the page opened, still without the value', async () => {
    const { manager, remote } = setup();
    vi.spyOn(remote, 'insertText').mockImplementation(async () => {
      remote.openDialog('alert', 'Typed!');
      await new Promise<void>(() => {});
    });
    const text = textOf(
      await callTool(manager, 'type_secret', {
        session: '0001',
        secret_id: 1,
        field: 'Password',
      }),
    );
    expect(text).toContain('Typed the Password of “Shop”.');
    expect(unframed(text)).toBe('An alert dialog: “Typed!”');
    expect(text).not.toContain('hunter2');
  });

  it('never returns the value, whatever the browser answers', async () => {
    const { manager, remote } = setup();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(remote, 'insertText').mockRejectedValue(new TypeError('x'));
    const result = await callTool(manager, 'type_secret', {
      session: '0001',
      secret_id: 1,
      field: 'Password',
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).not.toContain('hunter2');
  });
});

describe('create_secret', () => {
  const fields = [
    { label: 'Username', value: 'me' },
    { label: 'Password', value: 'hunter2' },
  ];

  it('stores a secret for every session', async () => {
    const createSecret = vi.fn(() => login);
    const { manager } = setup({ createSecret });
    const created = jsonOf(
      await callTool(manager, 'create_secret', {
        kind: 'credentials',
        title: 'Shop',
        fields,
      }),
    );
    expect(created).toEqual({ id: 1, title: 'Shop', preview: 'me' });
    expect(createSecret).toHaveBeenCalledExactlyOnceWith({
      kind: 'credentials',
      title: 'Shop',
      fields: [
        { label: 'Username', value: 'me' },
        { label: 'Password', value: 'hunter2' },
      ],
      sessionId: null,
    });
  });

  it('stores a secret for one session', async () => {
    const createSecret = vi.fn(() => emails);
    const { manager } = setup({ createSecret });
    await callTool(manager, 'create_secret', {
      kind: 'personal',
      title: 'Me',
      session: '0001',
      fields: [{ label: 'Email', value: 'a@example.com', hidden: false }],
    });
    expect(createSecret).toHaveBeenCalledWith({
      kind: 'personal',
      title: 'Me',
      fields: [{ label: 'Email', value: 'a@example.com', hidden: false }],
      sessionId: 1,
    });
  });

  it('keeps two values of one label and a value left out as empty', async () => {
    const createSecret = vi.fn(() => emails);
    const { manager } = setup({ createSecret });
    await callTool(manager, 'create_secret', {
      kind: 'personal',
      title: 'Me',
      fields: [{ label: 'Email' }, { label: 'Email', value: 'b@example.com' }],
    });
    expect(createSecret).toHaveBeenCalledWith(
      expect.objectContaining({
        fields: [
          { label: 'Email', value: '' },
          { label: 'Email', value: 'b@example.com' },
        ],
      }),
    );
  });

  it('passes on what the manager refuses', async () => {
    const { manager } = setup({
      createSecret() {
        throw new AppError(
          422,
          'secret_without_fields',
          'A secret needs at least one value.',
        );
      },
    });
    const result = await callTool(manager, 'create_secret', {
      kind: 'note',
      title: 'Empty',
      fields: [],
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('at least one value');
  });

  it('knows the kinds of the vault', async () => {
    const result = await callTool(setup().manager, 'create_secret', {
      kind: 'recipe',
      title: 'x',
      fields: [],
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('- kind: ');
  });

  it('does not repeat the values in a refusal of its arguments', async () => {
    const result = await callTool(setup().manager, 'create_secret', {
      kind: 'credentials',
      title: 'x',
      fields: [{ label: 'Password', value: 12345, secret: 'hunter2' }],
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).not.toContain('hunter2');
  });
});

describe('update_secret', () => {
  it('changes the title and the values only when they are given', async () => {
    const updateSecret = vi.fn<Manager['updateSecret']>(() => login);
    const { manager } = setup({ updateSecret });
    await callTool(manager, 'update_secret', {
      secret_id: 1,
      title: 'Shop login',
    });
    await callTool(manager, 'update_secret', {
      secret_id: 1,
      fields: [{ label: 'Note', value: 'x' }],
    });
    expect(updateSecret.mock.calls).toEqual([
      [1, { title: 'Shop login', fields: undefined, session: 'keep' }],
      [
        1,
        {
          title: undefined,
          fields: [{ label: 'Note', value: 'x' }],
          session: 'keep',
        },
      ],
    ]);
  });

  it('treats null as not given', async () => {
    const updateSecret = vi.fn<Manager['updateSecret']>(() => login);
    const { manager } = setup({ updateSecret });
    await callTool(manager, 'update_secret', {
      secret_id: 1,
      title: null,
      fields: null,
      session: null,
    });
    expect(updateSecret).toHaveBeenCalledWith(1, {
      title: undefined,
      fields: undefined,
      session: 'keep',
    });
  });

  it("makes a secret a session's own, or one for every session", async () => {
    const updateSecret = vi.fn<Manager['updateSecret']>(() => login);
    const { manager } = setup({ updateSecret });
    await callTool(manager, 'update_secret', { secret_id: 1, session: '0001' });
    await callTool(manager, 'update_secret', {
      secret_id: 2,
      for_every_session: true,
    });
    expect(
      updateSecret.mock.calls.map(([id, update]) => [id, update.session]),
    ).toEqual([
      [1, 1],
      [2, 'global'],
    ]);
  });

  it('prefers making it a secret for every session over a session', async () => {
    const updateSecret = vi.fn<Manager['updateSecret']>(() => login);
    const { manager } = setup({ updateSecret });
    await callTool(manager, 'update_secret', {
      secret_id: 1,
      session: 'other',
      for_every_session: true,
    });
    expect(updateSecret).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ session: 'global' }),
    );
  });

  it('answers with the secret as it is then, without its values', async () => {
    const updated = secretFixture({
      id: 1,
      title: 'Shop login',
      preview: 'me',
    });
    const { manager } = setup({ updateSecret: () => updated });
    const result = await callTool(manager, 'update_secret', { secret_id: 1 });
    expect(jsonOf(result)).toEqual({
      id: 1,
      title: 'Shop login',
      preview: 'me',
    });
    expect(textOf(result)).not.toContain('hunter2');
  });
});

describe('delete_secret', () => {
  it('deletes the secret and says so', async () => {
    const deleteSecret = vi.fn();
    const { manager } = setup({ deleteSecret });
    expect(
      textOf(await callTool(manager, 'delete_secret', { secret_id: 1 })),
    ).toBe('Deleted secret 1.');
    expect(deleteSecret).toHaveBeenCalledExactlyOnceWith(1);
  });

  it('says that a secret does not exist', async () => {
    const { manager } = setup({
      deleteSecret() {
        throw new AppError(
          404,
          'secret_not_found',
          'That secret does not exist.',
        );
      },
    });
    const result = await callTool(manager, 'delete_secret', { secret_id: 9 });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('does not exist');
  });
});
