// @vitest-environment node

/**
 * Using a template of the catalog, against the real shipped templates: what
 * the catalog lists and previews, what a create checks and builds, and how
 * it is written — in one transaction.
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const org = vi.hoisted(() => ({
  /** Templates the catalog holds besides the shipped ones. */
  extraTemplates: [] as unknown[],
  members: new Set<string>(),
  credentials: new Map<string, string[]>(),
  replacements: new Map<string, string>(),
  /** The newest version of each automation: its name and the template its
   * presentation names. */
  automations: [] as {
    name: string;
    template: string | null;
    bindings?: string[];
  }[],
  /** The projects the reader can open. */
  readable: [] as string[],
}));

vi.mock('../../../lib/automations/templates.ts', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('../../../lib/automations/templates.ts')
    >();
  return {
    ...actual,
    loadAutomationTemplates: (
      ...args: Parameters<typeof actual.loadAutomationTemplates>
    ) => [...actual.loadAutomationTemplates(...args), ...org.extraTemplates],
  };
});
vi.mock('../../auth/membership.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../auth/membership.ts')>()),
  findOrganizationMember: (
    _sql: unknown,
    organizationId: string,
    userId: string,
  ) =>
    Promise.resolve(
      org.members.has(userId)
        ? { id: 'm', organizationId, userId, role: 'member' }
        : null,
    ),
}));
vi.mock('../connector_credentials/service.ts', () => ({
  listCredentialsInService: () =>
    Promise.resolve(
      new Map(
        [...org.credentials].map(([connector, names]) => [
          connector,
          names.map((name, at) => ({ id: `cred_${at}`, name })),
        ]),
      ),
    ),
}));
vi.mock('./model-defaults.ts', () => ({
  resolveModelReplacements: vi.fn(
    (_sql: unknown, _org: string, models: string[]) =>
      Promise.resolve(
        new Map(
          models.flatMap((model) => {
            const to = org.replacements.get(model);
            return to === undefined ? [] : [[model, to] as const];
          }),
        ),
      ),
  ),
}));
vi.mock('./store.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./store.ts')>()),
  saveVersionInTx: vi.fn(() => Promise.resolve({ name: 'x', version: 1 })),
  deployInTx: vi.fn(() =>
    Promise.resolve({
      name: 'x',
      version: 1,
      previousVersion: null,
      kind: 'deploy',
      deploymentId: 'dep_1',
    }),
  ),
  setTriggerInTx: vi.fn(() =>
    Promise.resolve({
      trigger: { kind: 'event' },
      minted: 'tok_once',
      mintedHash: 'hash_once',
      rows: [{ tokenHash: 'hash_once' }],
      revoked: false,
      nextRunAt: null,
    }),
  ),
  answerTriggerWrite: vi.fn(() => Promise.resolve({ token: 'tok_once' })),
}));

import { parseAutomationPresentation } from '../../../lib/shared/schemas/automation_presentation.ts';
import type { ProjectAuthContext } from '../projects/service.ts';
import { resolveModelReplacements } from './model-defaults.ts';
import {
  answerTriggerWrite,
  AutomationError,
  deployInTx,
  saveVersionInTx,
  setTriggerInTx,
} from './store.ts';
import {
  commitTemplateInstance,
  listTemplateCards,
  prepareTemplateInstance,
  readTemplateDetail,
} from './templates.ts';

/** The transaction a fake `sql.begin` hands its callback. */
const TX = { tx: true };

interface Statement {
  text: string;
  values: unknown[];
}

const FRAGMENT = Symbol('fragment');
interface Fragment extends Statement {
  [FRAGMENT]: true;
}

function isFragment(value: unknown): value is Fragment {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { [FRAGMENT]?: true })[FRAGMENT] === true
  );
}

/** Every statement the catalog ran, its fragments inlined. */
const statements: Statement[] = [];

/** A database that inlines nested fragments the way postgres.js does and
 * answers the catalog's two reads — the newest version of each automation
 * the reader sees (installed nowhere, or in a project they can open), and
 * which of the projects an answer names they can open — and runs a
 * transaction's callback once. */
const begin = vi.fn((callback: (tx: unknown) => Promise<unknown>) =>
  callback(TX),
);
const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
  let text = '';
  const flat: unknown[] = [];
  strings.forEach((part, index) => {
    text += part;
    if (index >= values.length) return;
    const value = values[index];
    if (isFragment(value)) {
      text += value.text;
      flat.push(...value.values);
    } else {
      text += '?';
      flat.push(value);
    }
  });
  text = text.replace(/\s+/g, ' ').trim();
  statements.push({ text, values: flat });
  const answer = (async () => {
    if (text.startsWith('SELECT a.name')) {
      return org.automations
        .filter(
          (automation) =>
            (automation.bindings ?? []).length === 0 ||
            (automation.bindings ?? []).some((id) => org.readable.includes(id)),
        )
        .map(({ name, template }) => ({ name, template }));
    }
    if (text.startsWith('SELECT id FROM app.projects')) {
      const asked = Array.isArray(flat[1]) ? flat[1].map(String) : [];
      return asked
        .filter((id) => org.readable.includes(id))
        .map((id) => ({ id }));
    }
    return [];
  })();
  const fragment: Fragment = { [FRAGMENT]: true, text, values: flat };
  return Object.assign(answer, fragment);
};
const sql = Object.assign(tag, { begin }) as unknown as Sql;

/** The reads that count what is in use. */
const usageReads = () =>
  statements.filter((row) => row.text.startsWith('SELECT a.name'));
/** The projects an answer was checked against, one read each. */
const projectChecks = () =>
  statements
    .filter((row) => row.text.startsWith('SELECT id FROM app.projects'))
    .map((row) => row.values[1]);

/** The project audience: its teams, with the legacy pair's fallback. */
const TEAMS =
  'CASE WHEN cardinality(team_ids) > 0 THEN team_ids ELSE array_remove(ARRAY[team_id] || shared_with_team_ids, NULL) END';
/** The projects the reader may open (`readableProjectsSql`), inlined. */
const RELATION = `( SELECT id AS project_id, key AS project_key, archived_at_ms AS project_archived_at_ms FROM app.projects WHERE org_id = ? AND ? AND (? OR archived_at_ms IS NULL) AND (? OR cardinality(${TEAMS}) = 0 OR ${TEAMS} && ?::text[]) )`;
/** An automation counts when it is installed nowhere or in a project the
 * reader can open, archived ones included. */
const VISIBLE_ONLY = `GROUP BY a.org_id, a.name HAVING NOT EXISTS ( SELECT 1 FROM app.automation_project_bindings b WHERE b.org_id = a.org_id AND b.automation_name = a.name ) OR EXISTS ( SELECT 1 FROM app.automation_project_bindings b JOIN ${RELATION} rp ON rp.project_id = b.project_id WHERE b.org_id = a.org_id AND b.automation_name = a.name )`;

/** The reader: a member of one team. */
const member: ProjectAuthContext = {
  organizationId: 'org_1',
  userId: 'usr_ada',
  role: 'member',
  teamIds: ['team_ops'],
};

beforeEach(() => {
  statements.length = 0;
  org.readable = ['prj_1'];
  org.extraTemplates = [];
  org.members = new Set(['usr_ada']);
  org.credentials = new Map();
  org.replacements = new Map();
  org.automations = [];
  vi.mocked(resolveModelReplacements).mockClear();
  vi.mocked(saveVersionInTx).mockClear();
  vi.mocked(deployInTx).mockClear();
  vi.mocked(setTriggerInTx).mockClear();
  begin.mockClear();
});

const reviewer = {
  organizationId: 'org_1',
  slug: 'notify-reviewer',
  name: 'tell-ada',
  displayName: 'Tell Ada',
  answers: { project: 'prj_1', reviewer: 'usr_ada' },
  viewer: member,
};

describe('the catalog', () => {
  it('lists every template with what it does, needs and changes, and what starts it [AUTO-R57]', async () => {
    const cards = await listTemplateCards(sql, 'org_1', member);
    expect(cards.map((card) => card.slug)).toEqual(
      expect.arrayContaining([
        'answer-questions',
        'inbox-summary',
        'notify-reviewer',
        'task-digest',
        'triage-new-tasks',
        'webhook-create-task',
      ]),
    );
    const card = cards.find((entry) => entry.slug === 'notify-reviewer');
    expect(card).toMatchObject({
      name: 'Tell the reviewer',
      scope: 'project',
      icon: 'bell-ring',
      category: 'notifications',
      // The platform's own connectors are always there.
      connectors: [
        { slug: 'task', connected: true, platform: true },
        { slug: 'notify', connected: true, platform: true },
      ],
      trigger: { kind: 'event', event: 'task.status_changed' },
      steps: expect.arrayContaining([
        expect.objectContaining({ title: 'Tells the reviewer' }),
      ]),
      outcomes: expect.arrayContaining([
        expect.objectContaining({ kind: 'sends' }),
        expect.objectContaining({ kind: 'never' }),
      ]),
      worksWith: [],
      inUse: 0,
    });
    expect(card?.i18n.de).toMatchObject({
      name: 'Reviewer benachrichtigen',
      details: expect.stringContaining('In Prüfung'),
    });
    // Where an answer goes stays on the server.
    expect(card?.fields.map((field) => field.id)).toEqual([
      'project',
      'reviewer',
      'message',
    ]);
    for (const field of card?.fields ?? [])
      expect(field).not.toHaveProperty('writes');
  });

  it('names the schedule a scheduled template starts from', async () => {
    const card = (await listTemplateCards(sql, 'org_1', member)).find(
      (entry) => entry.slug === 'inbox-summary',
    );
    expect(card?.trigger).toEqual({
      kind: 'schedule',
      repeat: {
        frequency: 'weekly',
        interval: 1,
        weekdays: [1, 2, 3, 4, 5],
        times: ['08:00'],
      },
      cron: null,
      timezone: 'UTC',
    });
  });

  it('counts the automations each template made that the reader sees [AUTO-R62]', async () => {
    org.automations = [
      { name: 'tell-ada', template: 'notify-reviewer' },
      { name: 'tell-ben', template: 'notify-reviewer', bindings: ['prj_1'] },
      // Installed only in a project the reader cannot open: they do not see
      // it in the list, so the catalog does not count it either.
      { name: 'tell-eve', template: 'notify-reviewer', bindings: ['prj_9'] },
      { name: 'my-own', template: null },
    ];
    const cards = await listTemplateCards(sql, 'org_1', member);
    const inUse = (slug: string) =>
      cards.find((card) => card.slug === slug)?.inUse;
    expect(inUse('notify-reviewer')).toBe(2);
    expect(inUse('task-digest')).toBe(0);
    // The projects the reader can open join the count (#5201): no
    // statement carries a list of their ids.
    const [usage] = usageReads();
    expect(usage?.text).toContain(VISIBLE_ONLY);
    expect(usage?.text).not.toContain('ANY(');
  });

  it.each([
    {
      who: 'an owner in no team every project [PROJ-R1]',
      reader: { ...member, role: 'owner', teamIds: [] },
      grant: [true, true, true, []],
    },
    {
      who: 'a member the projects of their teams [PROJ-R2]',
      reader: member,
      grant: [true, true, false, ['team_ops']],
    },
    {
      who: 'a disabled seat no project [PROJ-R2]',
      reader: { ...member, role: 'disabled' },
      grant: [false, true, false, ['team_ops']],
    },
  ] satisfies {
    who: string;
    reader: ProjectAuthContext;
    grant: unknown[];
  }[])(
    'counts what is in use in the projects the reader opens: $who',
    async ({ reader, grant }) => {
      await listTemplateCards(sql, 'org_1', reader);
      // The organization · then the relation: the organization · not a
      // disabled seat · archived projects kept · admin · teams.
      expect(usageReads().map((row) => row.values)).toEqual([
        ['org_1', 'org_1', ...grant],
      ]);
    },
  );

  it('counts the copy of a pack an earlier release installed [AUTO-R62]', async () => {
    // Before templates, every organization got the pack under the name of
    // its document; that copy names no template.
    org.extraTemplates = [
      {
        slug: 'example/sync',
        dir: '/nowhere',
        source: 'pack',
        automation: { version: 1, name: 'example-sync', nodes: [] },
        manifest: {
          name: 'Sync',
          category: 'issues',
          template: {
            details: 'Syncs.',
            steps: [{ title: 'Syncs' }],
            outcomes: [{ kind: 'creates', text: 'Tasks.' }],
            fields: [],
          },
        },
      },
    ];
    org.automations = [
      { name: 'example-sync', template: null },
      { name: 'my-sync', template: 'example/sync' },
    ];
    const card = (await listTemplateCards(sql, 'org_1', member)).find(
      (entry) => entry.slug === 'example/sync',
    );
    expect(card?.inUse).toBe(2);
  });

  it('previews a template with the document it creates and the credentials it can name', async () => {
    org.credentials.set('gmail', ['Support inbox']);
    const detail = await readTemplateDetail(
      sql,
      'org_1',
      'notify-reviewer',
      member,
    );
    expect(detail.document.nodes.map((node) => node.id)).toEqual([
      'task',
      'notify',
    ]);
    expect(detail.credentials).toEqual({});
    await expect(
      readTemplateDetail(sql, 'org_1', 'nothing-here', member),
    ).rejects.toMatchObject({ code: 'TEMPLATE_NOT_FOUND', status: 404 });
  });
});

describe('creating from a template', () => {
  it('builds the automation the answers make, named as asked, its trigger off [AUTO-R44]', async () => {
    const prepared = await prepareTemplateInstance(sql, {
      ...reviewer,
      locale: 'de',
    });
    expect(prepared.document.name).toBe('tell-ada');
    expect(
      prepared.document.nodes.find((node) => node.id === 'notify')?.input,
    ).toMatchObject({
      to: ['usr_ada'],
      message: 'Diese Aufgabe ist bereit für deine Prüfung.',
    });
    expect(prepared).toMatchObject({
      projectId: 'prj_1',
      trigger: {
        kind: 'event',
        event: 'task.status_changed',
        enabled: false,
      },
      message: 'Created from the template "Tell the reviewer".',
    });
  });

  it('keeps what the template says about the automation, and where it came from [AUTO-R58]', async () => {
    const prepared = await prepareTemplateInstance(sql, {
      ...reviewer,
      locale: 'de-CH',
    });
    expect(prepared.presentation).toEqual({
      name: 'Tell Ada',
      description: expect.stringContaining('In Prüfung'),
      icon: 'bell-ring',
      requiredConnectors: ['task', 'notify'],
    });
    // Where it came from is kept beside the presentation, not in it.
    expect(prepared.templateSlug).toBe('notify-reviewer');
  });

  it('writes a presentation the previous release still reads [AUTO-R58]', async () => {
    // The previous release reads a presentation with exactly these keys and
    // refuses one with any other: an automation made from a template must
    // keep its name and its Inbox view after a rollback.
    const PREVIOUS_RELEASE_KEYS = new Set([
      'name',
      'description',
      'icon',
      'labels',
      'i18n',
      'builtinViews',
      'requiredConnectors',
    ]);
    for (const slug of ['notify-reviewer', 'inbox-summary', 'task-digest']) {
      const prepared = await prepareTemplateInstance(sql, {
        ...reviewer,
        slug,
        answers:
          slug === 'notify-reviewer'
            ? reviewer.answers
            : slug === 'inbox-summary'
              ? { mailbox: 'gmail', recipient: 'usr_ada' }
              : { project: 'prj_1', recipient: 'usr_ada' },
      });
      for (const key of Object.keys(prepared.presentation)) {
        expect(PREVIOUS_RELEASE_KEYS.has(key), `${slug}: ${key}`).toBe(true);
      }
      expect(parseAutomationPresentation(prepared.presentation)).not.toBeNull();
    }
  });

  it('gives a model the organization does not serve one it does, and says so [AUTO-R44]', async () => {
    org.replacements.set('anthropic/claude-haiku-4-5', 'openai/gpt-5-mini');
    const prepared = await prepareTemplateInstance(sql, {
      ...reviewer,
      slug: 'triage-new-tasks',
      answers: { project: 'prj_1' },
    });
    expect(
      prepared.document.nodes.find((node) => node.id === 'triage'),
    ).toMatchObject({ model: 'openai/gpt-5-mini' });
    expect(prepared.message).toMatch(
      /^Created from the template "Triage new tasks"\. .+/,
    );
  });

  it('runs a schedule nobody answered in the creator’s time zone [AUTO-R60]', async () => {
    const prepared = await prepareTemplateInstance(sql, {
      ...reviewer,
      slug: 'inbox-summary',
      answers: { mailbox: 'gmail', recipient: 'usr_ada' },
      timezone: 'Europe/Zurich',
    });
    expect(prepared.trigger).toMatchObject({
      kind: 'schedule',
      timezone: 'Europe/Zurich',
      enabled: false,
    });
  });

  it('refuses every answer the organization cannot take, and builds nothing [AUTO-R45]', async () => {
    const refusal = prepareTemplateInstance(sql, {
      ...reviewer,
      answers: { project: 'prj_hidden', reviewer: 'usr_stranger' },
    });
    await expect(refusal).rejects.toBeInstanceOf(AutomationError);
    await expect(refusal).rejects.toMatchObject({
      code: 'TEMPLATE_ANSWERS_INVALID',
      status: 400,
      data: {
        fields: [
          expect.objectContaining({ field: 'project', code: 'unknown' }),
          expect.objectContaining({ field: 'reviewer', code: 'unknown' }),
        ],
      },
    });
    expect(resolveModelReplacements).not.toHaveBeenCalled();
    // The project an answer names is asked alone, never every project the
    // creator can open.
    expect(projectChecks()).toEqual([['prj_hidden']]);
  });

  it('names what the answers lack on their own too [AUTO-R45]', async () => {
    await expect(
      prepareTemplateInstance(sql, {
        ...reviewer,
        answers: { project: 'prj_1' },
      }),
    ).rejects.toMatchObject({
      code: 'TEMPLATE_ANSWERS_INVALID',
      data: {
        fields: [
          expect.objectContaining({ field: 'reviewer', code: 'required' }),
        ],
      },
    });
  });

  it('refuses a schedule its trigger could never run on, against the schedule question', async () => {
    await expect(
      prepareTemplateInstance(sql, {
        ...reviewer,
        slug: 'inbox-summary',
        answers: {
          mailbox: 'gmail',
          recipient: 'usr_ada',
          schedule: { cron: 'every so often', timezone: 'Europe/Zurich' },
        },
      }),
    ).rejects.toMatchObject({
      code: 'TEMPLATE_ANSWERS_INVALID',
      data: {
        fields: [
          expect.objectContaining({ field: 'schedule', code: 'invalid' }),
        ],
      },
    });
    expect(resolveModelReplacements).not.toHaveBeenCalled();
  });

  it('refuses a template that does not exist', async () => {
    await expect(
      prepareTemplateInstance(sql, { ...reviewer, slug: 'nothing-here' }),
    ).rejects.toMatchObject({ code: 'TEMPLATE_NOT_FOUND', status: 404 });
  });
});

describe('writing what a template made', () => {
  const origin = { actor: 'usr_ada', via: 'app' } as const;

  it('creates, deploys and turns the trigger on in one transaction [AUTO-R61]', async () => {
    const prepared = await prepareTemplateInstance(sql, reviewer);
    const created = await commitTemplateInstance(sql, {
      organizationId: 'org_1',
      name: 'tell-ada',
      origin,
      prepared,
      checked: { message: prepared.message, testsPassed: true },
      start: true,
    });
    expect(begin).toHaveBeenCalledTimes(1);
    expect(saveVersionInTx).toHaveBeenCalledWith(
      TX,
      expect.objectContaining({
        name: 'tell-ada',
        create: true,
        projectId: 'prj_1',
        testsPassed: true,
        templateSlug: 'notify-reviewer',
      }),
    );
    expect(deployInTx).toHaveBeenCalledWith(
      TX,
      expect.objectContaining({ name: 'tell-ada', version: 1 }),
    );
    expect(setTriggerInTx).toHaveBeenCalledWith(
      TX,
      expect.objectContaining({
        trigger: expect.objectContaining({ kind: 'event', enabled: true }),
      }),
    );
    expect(created).toEqual({
      name: 'tell-ada',
      version: 1,
      deployed: true,
      trigger: { token: 'tok_once', enabled: true },
    });
  });

  it('creates a draft with its trigger off when it is not started [AUTO-R44]', async () => {
    const prepared = await prepareTemplateInstance(sql, reviewer);
    const created = await commitTemplateInstance(sql, {
      organizationId: 'org_1',
      name: 'tell-ada',
      origin,
      prepared,
      checked: {},
      start: false,
    });
    expect(deployInTx).not.toHaveBeenCalled();
    expect(setTriggerInTx).toHaveBeenCalledWith(
      TX,
      expect.objectContaining({
        trigger: expect.objectContaining({ enabled: false }),
      }),
    );
    expect(created).toMatchObject({ deployed: false });
  });

  it('starts nothing whose own tests fail, and writes nothing [AUTO-R61]', async () => {
    const prepared = await prepareTemplateInstance(sql, reviewer);
    await expect(
      commitTemplateInstance(sql, {
        organizationId: 'org_1',
        name: 'tell-ada',
        origin,
        prepared,
        checked: { testsPassed: false },
        start: true,
      }),
    ).rejects.toMatchObject({ code: 'AUTOMATION_DEPLOY_REJECTED' });
    expect(begin).not.toHaveBeenCalled();
  });

  it('refuses to start what needs a connector nobody connected, and creates the draft [AUTO-R61]', async () => {
    const prepared = {
      ...(await prepareTemplateInstance(sql, reviewer)),
      missingConnectors: ['gmail'],
    };
    await expect(
      commitTemplateInstance(sql, {
        organizationId: 'org_1',
        name: 'tell-ada',
        origin,
        prepared,
        checked: {},
        start: true,
      }),
    ).rejects.toMatchObject({
      code: 'TEMPLATE_CONNECTION_MISSING',
      data: { connectors: ['gmail'] },
    });
    expect(begin).not.toHaveBeenCalled();
    await expect(
      commitTemplateInstance(sql, {
        organizationId: 'org_1',
        name: 'tell-ada',
        origin,
        prepared,
        checked: {},
        start: false,
      }),
    ).resolves.toMatchObject({ deployed: false });
  });

  it('answers a committed create with its webhook token though its warnings cannot be read', async () => {
    vi.mocked(answerTriggerWrite).mockRejectedValueOnce(
      new Error('the read failed'),
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const prepared = await prepareTemplateInstance(sql, reviewer);
      await expect(
        commitTemplateInstance(sql, {
          organizationId: 'org_1',
          name: 'tell-ada',
          origin,
          prepared,
          checked: {},
          start: true,
        }),
      ).resolves.toMatchObject({
        deployed: true,
        trigger: { token: 'tok_once', enabled: true },
      });
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('stops at the first refusal inside the transaction, which then commits nothing [AUTO-R61]', async () => {
    vi.mocked(deployInTx).mockRejectedValueOnce(
      new AutomationError('AUTOMATION_DEPLOY_REJECTED', 'refused', 409),
    );
    const prepared = await prepareTemplateInstance(sql, reviewer);
    await expect(
      commitTemplateInstance(sql, {
        organizationId: 'org_1',
        name: 'tell-ada',
        origin,
        prepared,
        checked: {},
        start: true,
      }),
    ).rejects.toMatchObject({ code: 'AUTOMATION_DEPLOY_REJECTED' });
    // The version was written inside the transaction the refusal rolls
    // back; the trigger never was.
    expect(saveVersionInTx).toHaveBeenCalledTimes(1);
    expect(setTriggerInTx).not.toHaveBeenCalled();
  });
});
