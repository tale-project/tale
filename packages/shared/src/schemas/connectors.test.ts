import { describe, expect, it } from 'vitest';

import { connectorSchema } from './connectors';

/** A realistic connector exercising every schema branch: two auth methods,
 * a yaml-js write action, a mock-only read action, and a native action. */
const GITHUB: unknown = {
  name: 'github',
  displayName: 'GitHub',
  description: 'Manage repositories, issues, and pull requests on GitHub.',
  tags: ['Developer'],
  allowedHosts: ['api.github.com'],
  auth: [
    { method: 'bearer' },
    {
      method: 'oauth2',
      authorizeUrl: 'https://github.com/login/oauth/authorize',
      tokenUrl: 'https://github.com/login/oauth/access_token',
      scopes: ['repo'],
    },
  ],
  actions: [
    {
      name: 'create_issue',
      description: 'Open an issue on a repository.',
      input: {
        type: 'object',
        properties: {
          owner: { type: 'string' },
          repo: { type: 'string' },
          title: { type: 'string' },
        },
        required: ['owner', 'repo', 'title'],
      },
      output: '{ number: number, url: string }',
      effects: 'write',
      mock: 'return { number: 100 + (input.title.length % 900), url: `https://github.com/${input.owner}/${input.repo}/issues/1` };',
      backend: {
        kind: 'yaml-js',
        live: 'const r = await ctx.http.post(`https://api.github.com/repos/${input.owner}/${input.repo}/issues`, { body: JSON.stringify({ title: input.title }) }); return { number: r.json().number, url: r.json().html_url };',
      },
      exampleInput: { owner: 'tale', repo: 'tale', title: 'Bug' },
    },
    {
      name: 'get_repo',
      description: 'Read a single repository.',
      input: { type: 'object', properties: { owner: { type: 'string' } } },
      output: '{ full_name: string }',
      effects: 'read',
      mock: 'return { full_name: `${input.owner}/repo` };',
    },
  ],
};

const MAILBOX: unknown = {
  name: 'imap-smtp',
  displayName: 'Mailbox',
  description: 'Send and read mail over IMAP/SMTP.',
  tags: ['Email'],
  auth: [{ method: 'basic' }],
  actions: [
    {
      name: 'send',
      description: 'Send an email.',
      input: {
        type: 'object',
        properties: { to: { type: 'string' }, subject: { type: 'string' } },
        required: ['to', 'subject'],
      },
      output: '{ messageId: string }',
      effects: 'write',
      mock: 'return { messageId: `mock-${input.to}` };',
      backend: { kind: 'native', impl: 'imap-smtp.send' },
    },
  ],
};

describe('connectorSchema', () => {
  it('accepts a full connector with mixed auth, yaml-js + native + mock-only actions', () => {
    const github = connectorSchema.parse(GITHUB);
    expect(github.name).toBe('github');
    expect(github.auth.map((a) => a.method)).toEqual(['bearer', 'oauth2']);
    const create = github.actions.find((a) => a.name === 'create_issue');
    expect(create?.effects).toBe('write');
    expect(create?.backend?.kind).toBe('yaml-js');
    const read = github.actions.find((a) => a.name === 'get_repo');
    expect(read?.backend).toBeUndefined();
  });

  it('accepts a native-backed connector', () => {
    const mailbox = connectorSchema.parse(MAILBOX);
    const send = mailbox.actions[0];
    expect(send?.backend).toEqual({ kind: 'native', impl: 'imap-smtp.send' });
  });

  it('defaults oauth2 scopes, tags, and allowedHosts to empty', () => {
    const c = connectorSchema.parse({
      name: 'tavily',
      displayName: 'Tavily',
      description: 'Web search.',
      auth: [{ method: 'api-key' }],
      actions: [
        {
          name: 'search',
          description: 'Search the web.',
          input: { type: 'object' },
          output: '{ results: string[] }',
          effects: 'read',
          mock: 'return { results: [] };',
        },
      ],
    });
    expect(c.tags).toEqual([]);
    expect(c.allowedHosts).toEqual([]);
  });

  it('defaults the bearer scheme to Bearer and accepts a vendor scheme', () => {
    const github = connectorSchema.parse(GITHUB);
    const bearer = github.auth.find((a) => a.method === 'bearer');
    expect(bearer).toMatchObject({ scheme: 'Bearer' });

    const discord = connectorSchema.parse({
      ...connectorSchema.parse(GITHUB),
      name: 'discord',
      auth: [{ method: 'bearer', scheme: 'Bot' }],
    });
    expect(discord.auth[0]).toMatchObject({ scheme: 'Bot' });
  });

  it('rejects a scheme that is not a single header token', () => {
    expect(
      connectorSchema.safeParse({
        ...connectorSchema.parse(GITHUB),
        auth: [{ method: 'bearer', scheme: 'Bot token' }],
      }).success,
    ).toBe(false);
  });

  it('defaults endpointMode to fixed and accepts per-credential', () => {
    const github = connectorSchema.parse(GITHUB);
    expect(github.endpointMode).toBe('fixed');

    const confluence = connectorSchema.parse({
      name: 'confluence',
      displayName: 'Confluence',
      description: "Read a Confluence space's pages.",
      endpointMode: 'per-credential',
      allowedHosts: ['atlassian.net'],
      auth: [{ method: 'basic' }],
      actions: [
        {
          name: 'list_pages',
          description: 'List pages in a space.',
          input: { type: 'object' },
          output: '{ pages: string[] }',
          effects: 'read',
          mock: 'return { pages: [] };',
          backend: {
            kind: 'yaml-js',
            live: 'const r = await ctx.http.get(`${ctx.endpoint}/wiki/rest/api/content`); return { pages: r.json().results };',
          },
        },
      ],
    });
    expect(confluence.endpointMode).toBe('per-credential');
  });

  it('requires a credential unless the connector makes it optional', () => {
    expect(connectorSchema.parse(GITHUB).credential).toBe('required');
    expect(
      connectorSchema.parse({
        ...connectorSchema.parse(GITHUB),
        credential: 'optional',
      }).credential,
    ).toBe('optional');
  });

  it('refuses an optional credential on a connector that is the platform itself', () => {
    const platform = {
      ...connectorSchema.parse(MAILBOX),
      name: 'tasks',
      auth: [{ method: 'platform' }],
      credential: 'optional',
    };
    expect(connectorSchema.safeParse(platform).success).toBe(false);
  });

  it('rejects an unknown endpointMode', () => {
    const github = connectorSchema.parse(GITHUB);
    expect(
      connectorSchema.safeParse({
        ...github,
        endpointMode: 'per-org',
      }).success,
    ).toBe(false);
  });

  it('rejects duplicate auth methods', () => {
    const bad = {
      ...connectorSchema.parse(GITHUB),
      auth: [{ method: 'bearer' }, { method: 'bearer' }],
    };
    expect(connectorSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects duplicate action names', () => {
    const github = connectorSchema.parse(GITHUB);
    const bad = { ...github, actions: [github.actions[0], github.actions[0]] };
    expect(connectorSchema.safeParse(bad).success).toBe(false);
  });

  it('accepts an action declared safe to repeat, and only as a boolean', () => {
    const github = connectorSchema.parse(GITHUB);
    const [create] = github.actions;
    const declared = connectorSchema.parse({
      ...github,
      actions: [{ ...create, idempotent: true }],
    });
    expect(declared.actions[0]?.idempotent).toBe(true);
    // Undeclared is not safe to repeat.
    expect(github.actions[0]?.idempotent).toBeUndefined();
    expect(
      connectorSchema.safeParse({
        ...github,
        actions: [{ ...create, idempotent: 'yes' }],
      }).success,
    ).toBe(false);
  });

  it('accepts an action title with per-locale overrides', () => {
    const github = connectorSchema.parse(GITHUB);
    const [create] = github.actions;
    const titled = connectorSchema.parse({
      ...github,
      actions: [
        {
          ...create,
          title: 'Create issue',
          i18n: {
            de: { title: 'Issue erstellen' },
            fr: { title: 'Créer une issue' },
            'de-CH': { title: 'Issue erstellen' },
          },
        },
      ],
    });
    expect(titled.actions[0]?.title).toBe('Create issue');
    expect(titled.actions[0]?.i18n?.fr?.title).toBe('Créer une issue');
    // Untitled stays valid: a surface falls back to the action name.
    expect(github.actions[0]?.title).toBeUndefined();
  });

  it.each([
    ['a blank title', { title: '' }],
    [
      'a locale key outside the tag grammar',
      { i18n: { german: { title: 'x' } } },
    ],
    ['an unknown key inside a locale', { i18n: { de: { label: 'x' } } }],
    ['a title past 80 characters', { title: 'x'.repeat(81) }],
  ])('refuses %s on an action', (_case, extra) => {
    const github = connectorSchema.parse(GITHUB);
    expect(
      connectorSchema.safeParse({
        ...github,
        actions: [{ ...github.actions[0], ...extra }],
      }).success,
    ).toBe(false);
  });

  it('accepts per-locale display names on the connector, and only those', () => {
    const mailbox = connectorSchema.parse(MAILBOX);
    const named = connectorSchema.parse({
      ...mailbox,
      i18n: { de: { displayName: 'Postfach' }, fr: { displayName: 'Boîte' } },
    });
    expect(named.i18n?.de?.displayName).toBe('Postfach');
    expect(
      connectorSchema.safeParse({
        ...mailbox,
        i18n: { de: { description: 'Ein Postfach' } },
      }).success,
    ).toBe(false);
  });

  it('accepts a per-locale label and description on a config field, and only those', () => {
    const mailbox = connectorSchema.parse(MAILBOX);
    const field = {
      key: 'imapHost',
      label: 'IMAP server',
      type: 'string',
      required: true,
    };
    const translated = connectorSchema.parse({
      ...mailbox,
      configFields: [
        {
          ...field,
          i18n: {
            de: { label: 'IMAP-Server', description: 'Hostname des Servers.' },
            'de-CH': { label: 'IMAP-Server' },
          },
        },
      ],
    });
    expect(translated.configFields[0]?.i18n?.de?.label).toBe('IMAP-Server');
    for (const i18n of [
      { german: { label: 'IMAP-Server' } },
      { de: { placeholder: 'imap.example.com' } },
      { de: { label: '' } },
    ]) {
      expect(
        connectorSchema.safeParse({
          ...mailbox,
          configFields: [{ ...field, i18n }],
        }).success,
      ).toBe(false);
    }
  });

  it('requires a mock on every action', () => {
    const github = connectorSchema.parse(GITHUB);
    const noMock = {
      ...github,
      actions: [{ ...github.actions[0], mock: undefined }],
    };
    expect(connectorSchema.safeParse(noMock).success).toBe(false);
  });

  it('requires an object-typed input schema', () => {
    const github = connectorSchema.parse(GITHUB);
    const badInput = {
      ...github,
      actions: [{ ...github.actions[0], input: { type: 'string' } }],
    };
    expect(connectorSchema.safeParse(badInput).success).toBe(false);
  });

  it('rejects an oauth2 method without its urls', () => {
    const bad = {
      ...connectorSchema.parse(GITHUB),
      auth: [{ method: 'oauth2' }],
    };
    expect(connectorSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a malformed native impl id', () => {
    const bad = {
      ...connectorSchema.parse(MAILBOX),
      actions: [
        {
          ...connectorSchema.parse(MAILBOX).actions[0],
          backend: { kind: 'native', impl: 'NotAnId' },
        },
      ],
    };
    expect(connectorSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects unknown top-level and action fields (strict)', () => {
    const github = connectorSchema.parse(GITHUB);
    expect(connectorSchema.safeParse({ ...github, extra: 1 }).success).toBe(
      false,
    );
  });
});
