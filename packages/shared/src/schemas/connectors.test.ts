import { describe, expect, it } from 'vitest';

import {
  CONNECTOR_SCENARIO_KINDS,
  connectorScenarioSchema,
  connectorSchema,
  MINIMUM_SCENARIO_KINDS,
} from './connectors';

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

  it('declares the git host a credential opens: fixed, or the endpoint of a per-credential connector', () => {
    const github = connectorSchema.parse({
      ...connectorSchema.parse(GITHUB),
      git: { host: 'github.com', username: 'x-access-token' },
    });
    expect(github.git).toEqual({
      host: 'github.com',
      username: 'x-access-token',
    });
    const forgejo = {
      ...connectorSchema.parse(GITHUB),
      name: 'forgejo',
      endpointMode: 'per-credential',
      git: { host: 'endpoint', username: 'x-access-token' },
    };
    expect(connectorSchema.safeParse(forgejo).success).toBe(true);
    // Only a per-credential connector has a credential endpoint to take.
    expect(
      connectorSchema.safeParse({ ...forgejo, endpointMode: 'fixed' }).success,
    ).toBe(false);
    // A host is a lower-case host name, never a URL or a pattern.
    for (const host of ['https://github.com', 'GitHub.com', '*.example.com']) {
      expect(
        connectorSchema.safeParse({
          ...github,
          git: { host, username: 'x-access-token' },
        }).success,
      ).toBe(false);
    }
    expect(
      connectorSchema.safeParse({
        ...github,
        git: { host: 'github.com', username: 'two words' },
      }).success,
    ).toBe(false);
  });

  it('refuses a git host on a connector that is the platform itself', () => {
    expect(
      connectorSchema.safeParse({
        ...connectorSchema.parse(MAILBOX),
        name: 'tasks',
        auth: [{ method: 'platform' }],
        git: { host: 'github.com', username: 'x-access-token' },
      }).success,
    ).toBe(false);
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

  it('labels the options of a select field, in English and per locale, and only its own values', () => {
    const mailbox = connectorSchema.parse(MAILBOX);
    const field = {
      key: 'security',
      label: 'Connection security',
      type: 'string',
      enum: ['tls', 'starttls'],
    };
    const labelled = connectorSchema.parse({
      ...mailbox,
      configFields: [
        {
          ...field,
          optionLabels: { tls: 'Implicit TLS', starttls: 'STARTTLS' },
          // A translation may name some of the options; the rest fall back.
          i18n: { de: { optionLabels: { tls: 'Implizites TLS' } } },
        },
      ],
    });
    expect(labelled.configFields[0]?.optionLabels).toEqual({
      tls: 'Implicit TLS',
      starttls: 'STARTTLS',
    });
    expect(labelled.configFields[0]?.i18n?.de?.optionLabels).toEqual({
      tls: 'Implizites TLS',
    });

    const refusals = (configField: object) =>
      connectorSchema
        .safeParse({ ...mailbox, configFields: [configField] })
        .error?.issues.map(({ path, message }) => ({ path, message }));
    // A label for a value the field does not take, in English or translated.
    expect(refusals({ ...field, optionLabels: { ssl: 'SSL' } })).toEqual([
      {
        path: ['configFields', 0, 'optionLabels', 'ssl'],
        message:
          'optionLabels names "ssl", which is not one of the field\'s enum values',
      },
    ]);
    expect(
      refusals({ ...field, i18n: { fr: { optionLabels: { ssl: 'SSL' } } } }),
    ).toEqual([
      {
        path: ['configFields', 0, 'i18n', 'fr', 'optionLabels', 'ssl'],
        message:
          'optionLabels names "ssl", which is not one of the field\'s enum values',
      },
    ]);
    // A field without options has none to label.
    expect(
      refusals({
        key: 'imapHost',
        label: 'IMAP server',
        type: 'string',
        optionLabels: { tls: 'Implicit TLS' },
      }),
    ).toEqual([
      {
        path: ['configFields', 0, 'optionLabels', 'tls'],
        message:
          'optionLabels names "tls", which is not one of the field\'s enum values',
      },
    ]);
    expect(refusals({ ...field, optionLabels: { tls: '' } })).toHaveLength(1);
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

  describe('an app that signs in as itself (client-credentials)', () => {
    const graphApp = {
      method: 'client-credentials',
      tokenUrl:
        'https://login.microsoftonline.com/{tenantId}/oauth2/v2.0/token',
      scopes: ['https://graph.microsoft.com/.default'],
    };
    const mailbox = {
      key: 'mailbox',
      label: 'Mailbox',
      type: 'string',
      requiredFor: ['client-credentials'],
    };

    it('accepts a token URL naming the tenant, beside a consent grant', () => {
      const parsed = connectorSchema.parse({
        ...connectorSchema.parse(GITHUB),
        configFields: [mailbox],
        auth: [
          {
            method: 'oauth2',
            authorizeUrl:
              'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
            tokenUrl:
              'https://login.microsoftonline.com/common/oauth2/v2.0/token',
            scopes: ['Mail.Read'],
            configScopes: { mailbox: ['Mail.Read.Shared'] },
          },
          graphApp,
        ],
      });
      expect(parsed.auth[1]).toEqual(graphApp);
      expect(parsed.configFields[0]?.requiredFor).toEqual([
        'client-credentials',
      ]);
    });

    it('keeps a setting declared fixed for the credential’s life', () => {
      const parsed = connectorSchema.parse({
        ...connectorSchema.parse(GITHUB),
        configFields: [{ ...mailbox, requiredFor: undefined, fixed: true }],
      });
      expect(parsed.configFields[0]?.fixed).toBe(true);
      expect(
        connectorSchema.safeParse({
          ...connectorSchema.parse(GITHUB),
          configFields: [{ ...mailbox, requiredFor: undefined, fixed: 'yes' }],
        }).success,
      ).toBe(false);
    });

    it('declares a setting that takes a mail address, on a string field only', () => {
      const parsed = connectorSchema.parse({
        ...connectorSchema.parse(GITHUB),
        configFields: [{ ...mailbox, requiredFor: undefined, format: 'email' }],
      });
      expect(parsed.configFields[0]?.format).toBe('email');
      for (const field of [
        { ...mailbox, requiredFor: undefined, format: 'uuid' },
        { key: 'port', label: 'Port', type: 'number', format: 'email' },
      ])
        expect(
          connectorSchema.safeParse({
            ...connectorSchema.parse(GITHUB),
            configFields: [field],
          }).success,
        ).toBe(false);
    });

    it('refuses a token URL the client secret would travel to in the clear', () => {
      const bad = {
        ...connectorSchema.parse(GITHUB),
        auth: [{ ...graphApp, tokenUrl: 'http://login.example.com/token' }],
      };
      expect(connectorSchema.safeParse(bad).success).toBe(false);
    });

    it('refuses extra scopes keyed on a setting the connector does not declare', () => {
      const bad = {
        ...connectorSchema.parse(GITHUB),
        auth: [
          {
            method: 'oauth2',
            authorizeUrl:
              'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
            tokenUrl:
              'https://login.microsoftonline.com/common/oauth2/v2.0/token',
            configScopes: { mailbox: ['Mail.Read.Shared'] },
          },
        ],
      };
      expect(connectorSchema.safeParse(bad).success).toBe(false);
    });

    it('refuses a setting required for a method the connector does not accept', () => {
      const bad = {
        ...connectorSchema.parse(GITHUB),
        configFields: [mailbox],
      };
      expect(connectorSchema.safeParse(bad).success).toBe(false);
    });
  });

  it('accepts one live prelude for the whole connector', () => {
    const parsed = connectorSchema.parse({
      ...connectorSchema.parse(GITHUB),
      livePrelude: "const root = 'https://api.github.com';",
    });
    expect(parsed.livePrelude).toBe("const root = 'https://api.github.com';");
    expect(
      connectorSchema.safeParse({
        ...connectorSchema.parse(GITHUB),
        livePrelude: '',
      }).success,
    ).toBe(false);
  });

  it('rejects unknown top-level and action fields (strict)', () => {
    const github = connectorSchema.parse(GITHUB);
    expect(connectorSchema.safeParse({ ...github, extra: 1 }).success).toBe(
      false,
    );
  });
});

describe('the scenarios an action ships [CONN-R33]', () => {
  /** A case of each shape the kinds take, on made-up data. */
  const SHAPES: [string, Record<string, unknown>][] = [
    [
      'a success, with the output the service answers',
      {
        name: 'found',
        kind: 'success',
        description: 'The repository exists and the credential may read it.',
        output: { full_name: 'example-org/demo' },
      },
    ],
    [
      'an empty answer, with an output that holds nothing',
      {
        name: 'no_repos',
        kind: 'empty',
        description: 'The organisation has no repository yet.',
        output: [],
      },
    ],
    [
      'an empty answer of null',
      {
        name: 'unset',
        kind: 'empty',
        description: 'The record holds no value.',
        output: null,
      },
    ],
    [
      'an error, with the status it carries and the input it answers',
      {
        name: 'not_found',
        kind: 'error',
        description: 'No repository goes by that name.',
        when: { owner: 'example-org', page: 2, archived: false },
        error: { message: 'Not Found', status: 404 },
      },
    ],
    [
      'an error that carries no status',
      {
        name: 'unreachable',
        kind: 'error',
        description: 'The service does not answer.',
        error: { message: 'fetch failed' },
      },
    ],
    [
      'a refusal',
      {
        name: 'archived',
        kind: 'refusal',
        description: 'The repository is archived and takes no issue.',
        error: {
          message: 'Repository was archived so is read-only.',
          status: 403,
        },
      },
    ],
    [
      'a duplicate answered with a second record',
      {
        name: 'same_title',
        kind: 'duplicate',
        description:
          'An issue of this title is open; the service opens another.',
        output: {
          number: 102,
          url: 'https://example.com/example-org/demo/issues/102',
        },
      },
    ],
    [
      'a duplicate answered with a refusal',
      {
        name: 'already_open',
        kind: 'duplicate',
        description: 'The service refuses the same issue twice.',
        error: { message: 'Validation Failed', status: 422 },
      },
    ],
    [
      'the longest name, description and message, and the lowest status',
      {
        name: `a${'b'.repeat(49)}`,
        kind: 'error',
        description: 'd'.repeat(500),
        error: { message: 'm'.repeat(2000), status: 400 },
      },
    ],
    [
      'a name of a letter and a digit, and the highest status',
      {
        name: 'e5',
        kind: 'refusal',
        description: 'The service is down.',
        error: { message: 'Service Unavailable', status: 599 },
      },
    ],
    [
      'a when of any JSON',
      {
        name: 'second_page',
        kind: 'success',
        description: 'The second page of open issues.',
        when: {
          labels: ['bug'],
          filter: { state: 'open' },
          cursor: null,
        },
        output: { items: [] },
      },
    ],
  ];

  it.each(SHAPES)('accepts %s, and keeps it whole', (_shape, scenario) => {
    expect(connectorScenarioSchema.parse(scenario)).toEqual(scenario);
  });

  const OUTPUT = { full_name: 'example-org/demo' };
  const ERROR = { message: 'Not Found', status: 404 };
  const ANSWER_MISSING = 'a scenario answers with either an output or an error';

  it.each<[string, Record<string, unknown>, Record<string, unknown>]>([
    [
      'both an output and an error',
      { kind: 'duplicate', output: OUTPUT, error: ERROR },
      { path: ['error'], message: ANSWER_MISSING },
    ],
    [
      'neither an output nor an error',
      { kind: 'duplicate' },
      { path: [], message: ANSWER_MISSING },
    ],
    [
      'a success that answers with an error',
      { kind: 'success', error: ERROR },
      { path: ['error'], message: 'a success scenario answers with an output' },
    ],
    [
      'an empty answer that is an error',
      { kind: 'empty', error: ERROR },
      { path: ['error'], message: 'an empty scenario answers with an output' },
    ],
    [
      'an error that answers with an output',
      { kind: 'error', output: OUTPUT },
      { path: ['output'], message: 'an error scenario answers with an error' },
    ],
    [
      'a refusal that answers with an output',
      { kind: 'refusal', output: OUTPUT },
      { path: ['output'], message: 'a refusal scenario answers with an error' },
    ],
  ])('refuses %s, naming the answer', (_case, shape, issue) => {
    const result = connectorScenarioSchema.safeParse({
      name: 'found',
      description: 'The repository exists.',
      ...shape,
    });
    expect(result.error?.issues).toEqual([expect.objectContaining(issue)]);
  });

  it.each([
    ['in camelCase', 'notFound'],
    ['with an upper-case letter', 'Found'],
    ['led by a digit', '1st_page'],
    ['led by an underscore', '_found'],
    ['with a dash', 'not-found'],
    ['with a space', 'not found'],
    ['that is empty', ''],
    ['of 51 characters', `a${'b'.repeat(50)}`],
  ])('refuses a name %s', (_case, name) => {
    const result = connectorScenarioSchema.safeParse({
      name,
      kind: 'success',
      description: 'The repository exists.',
      output: OUTPUT,
    });
    expect(result.error?.issues).toEqual([
      expect.objectContaining({
        path: ['name'],
        message:
          'must be snake_case (lower-case, digits, underscores), at most 50 characters',
      }),
    ]);
  });

  it.each<[string, Record<string, unknown>, Record<string, unknown>]>([
    [
      'a kind it does not name',
      { kind: 'timeout' },
      { path: ['kind'], code: 'invalid_value' },
    ],
    [
      'no description',
      { description: undefined },
      { path: ['description'], code: 'invalid_type' },
    ],
    [
      'an empty description',
      { description: '' },
      { path: ['description'], code: 'too_small' },
    ],
    [
      'a description past 500 characters',
      { description: 'd'.repeat(501) },
      { path: ['description'], code: 'too_big' },
    ],
    [
      'a status below 400',
      { error: { message: 'Moved', status: 399 } },
      { path: ['error', 'status'], code: 'too_small' },
    ],
    [
      'a status past 599',
      { error: { message: 'Odd', status: 600 } },
      { path: ['error', 'status'], code: 'too_big' },
    ],
    [
      'a status that is not a whole number',
      { error: { message: 'Not Found', status: 404.5 } },
      { path: ['error', 'status'], code: 'invalid_type' },
    ],
    [
      'a status given as text',
      { error: { message: 'Not Found', status: '404' } },
      { path: ['error', 'status'], code: 'invalid_type' },
    ],
    [
      'an error without a message',
      { error: { status: 404 } },
      { path: ['error', 'message'], code: 'invalid_type' },
    ],
    [
      'an empty message',
      { error: { message: '' } },
      { path: ['error', 'message'], code: 'too_small' },
    ],
    [
      'a message past 2000 characters',
      { error: { message: 'm'.repeat(2001) } },
      { path: ['error', 'message'], code: 'too_big' },
    ],
    [
      'a key a scenario does not take',
      { delayMs: 100 },
      { path: [], code: 'unrecognized_keys', keys: ['delayMs'] },
    ],
    [
      'a key an error does not take',
      { error: { message: 'Not Found', code: 'E_NOT_FOUND' } },
      { path: ['error'], code: 'unrecognized_keys', keys: ['code'] },
    ],
    [
      'a when given as a list',
      { when: ['example-org'] },
      { path: ['when'], code: 'invalid_type' },
    ],
    [
      'a when given as text',
      { when: 'example-org' },
      { path: ['when'], code: 'invalid_type' },
    ],
  ])('refuses %s', (_case, change, issue) => {
    const result = connectorScenarioSchema.safeParse({
      name: 'not_found',
      kind: 'error',
      description: 'No repository goes by that name.',
      error: ERROR,
      ...change,
    });
    expect(result.error?.issues).toEqual([expect.objectContaining(issue)]);
  });

  /** GitHub with `scenarios` on its read action, `get_repo`. */
  function withScenarios(scenarios: unknown) {
    const github = connectorSchema.parse(GITHUB);
    const [create, read] = github.actions;
    return { ...github, actions: [create, { ...read, scenarios }] };
  }
  const scenario = (name: string) => ({
    name,
    kind: 'success',
    description: 'The repository exists.',
    output: OUTPUT,
  });

  it('takes scenarios on an action, which stay optional', () => {
    const github = connectorSchema.parse(GITHUB);
    const [create, read] = github.actions;
    const write = [
      {
        name: 'created',
        kind: 'success',
        description: 'The issue is opened.',
        output: {
          number: 101,
          url: 'https://example.com/example-org/demo/issues/101',
        },
      },
      {
        name: 'archived',
        kind: 'refusal',
        description: 'The repository is archived and takes no issue.',
        error: {
          message: 'Repository was archived so is read-only.',
          status: 403,
        },
      },
      {
        name: 'same_title',
        kind: 'duplicate',
        description: 'The service refuses the same issue twice.',
        error: { message: 'Validation Failed', status: 422 },
      },
    ];
    const reads = [
      scenario('found'),
      {
        name: 'empty_name',
        kind: 'empty',
        description: 'The repository has no full name.',
        output: { full_name: '' },
      },
      {
        name: 'not_found',
        kind: 'error',
        description: 'No repository goes by that name.',
        when: { owner: 'nobody' },
        error: ERROR,
      },
    ];
    const parsed = connectorSchema.parse({
      ...github,
      actions: [
        { ...create, scenarios: write },
        { ...read, scenarios: reads },
      ],
    });
    expect(parsed.actions[0]?.scenarios).toEqual(write);
    expect(parsed.actions[1]?.scenarios).toEqual(reads);
    // An action that ships none stays valid and has none.
    expect(github.actions[0]?.scenarios).toBeUndefined();
    expect(
      connectorSchema.parse(withScenarios([])).actions[1]?.scenarios,
    ).toEqual([]);
  });

  it('takes up to 50 scenarios on an action, and a name again on another action', () => {
    const fifty = Array.from({ length: 50 }, (_, i) => scenario(`case_${i}`));
    expect(connectorSchema.safeParse(withScenarios(fifty)).success).toBe(true);
    const github = connectorSchema.parse(GITHUB);
    const [create, read] = github.actions;
    expect(
      connectorSchema.safeParse({
        ...github,
        actions: [
          { ...create, scenarios: [scenario('found')] },
          { ...read, scenarios: [scenario('found')] },
        ],
      }).success,
    ).toBe(true);
  });

  it.each<[string, unknown, Record<string, unknown>]>([
    [
      'two scenarios of one name',
      [scenario('found'), { ...scenario('found'), kind: 'duplicate' }],
      {
        path: ['actions', 1, 'scenarios'],
        message: 'scenario names must be unique per action',
      },
    ],
    [
      'more than 50 scenarios',
      Array.from({ length: 51 }, (_, i) => scenario(`case_${i}`)),
      { path: ['actions', 1, 'scenarios'], code: 'too_big' },
    ],
    [
      'scenarios keyed by name instead of listed',
      { found: scenario('found') },
      { path: ['actions', 1, 'scenarios'], code: 'invalid_type' },
    ],
    [
      'a scenario that answers twice',
      [{ ...scenario('found'), error: ERROR }],
      {
        path: ['actions', 1, 'scenarios', 0, 'error'],
        message: ANSWER_MISSING,
      },
    ],
  ])('refuses an action with %s, naming where', (_case, scenarios, issue) => {
    const result = connectorSchema.safeParse(withScenarios(scenarios));
    expect(result.error?.issues).toEqual([expect.objectContaining(issue)]);
  });

  it('names the kinds each action ships at least, by its effect', () => {
    expect(CONNECTOR_SCENARIO_KINDS).toEqual([
      'success',
      'empty',
      'error',
      'refusal',
      'duplicate',
    ]);
    expect(MINIMUM_SCENARIO_KINDS).toEqual({
      read: ['success', 'empty', 'error'],
      write: ['success', 'refusal', 'duplicate'],
    });
  });
});
