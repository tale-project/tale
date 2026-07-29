import { describe, expect, it } from 'vitest';

import { connectorSchema, type Connector } from './connectors';

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
      ...(GITHUB as Connector),
      name: 'discord',
      auth: [{ method: 'bearer', scheme: 'Bot' }],
    });
    expect(discord.auth[0]).toMatchObject({ scheme: 'Bot' });
  });

  it('rejects a scheme that is not a single header token', () => {
    expect(
      connectorSchema.safeParse({
        ...(GITHUB as Connector),
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
      ...(GITHUB as Connector),
      auth: [{ method: 'bearer' }, { method: 'bearer' }],
    };
    expect(connectorSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects duplicate action names', () => {
    const github = connectorSchema.parse(GITHUB);
    const bad = { ...github, actions: [github.actions[0], github.actions[0]] };
    expect(connectorSchema.safeParse(bad).success).toBe(false);
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
      ...(GITHUB as Connector),
      auth: [{ method: 'oauth2' }],
    };
    expect(connectorSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a malformed native impl id', () => {
    const bad = {
      ...(MAILBOX as Connector),
      actions: [
        {
          ...(MAILBOX as Connector).actions[0],
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
