// @vitest-environment node

/**
 * Creating from a shipped starter, against the real starters: what the
 * gallery lists, and what a create checks and saves.
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const org = vi.hoisted(() => ({
  members: new Set<string>(),
  connected: [] as string[],
  credentials: new Map<string, string[]>(),
  replacements: new Map<string, string>(),
}));

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
  listConnectedConnectorSlugs: () => Promise.resolve(org.connected),
  listActiveCredentials: (_sql: unknown, _org: string, connector: string) =>
    Promise.resolve(
      (org.credentials.get(connector) ?? []).map((name) => ({ name })),
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

import { resolveModelReplacements } from './model-defaults.ts';
import { AutomationError } from './store.ts';
import { listTemplateCards, prepareTemplateInstance } from './templates.ts';

const sql = {} as Sql;

beforeEach(() => {
  org.members = new Set(['usr_ada']);
  org.connected = [];
  org.credentials = new Map();
  org.replacements = new Map();
  vi.mocked(resolveModelReplacements).mockClear();
});

const reviewer = {
  organizationId: 'org_1',
  slug: 'notify-reviewer',
  name: 'tell-ada',
  displayName: 'Tell Ada',
  answers: { project: 'prj_1', reviewer: 'usr_ada' },
  visibleProjectIds: ['prj_1'],
};

describe('the starters the gallery lists', () => {
  it('lists each with its questions, what it needs and what starts it', async () => {
    const cards = await listTemplateCards(sql, 'org_1');
    expect(cards.map((card) => card.slug)).toEqual([
      'answer-questions',
      'inbox-summary',
      'notify-reviewer',
      'triage-new-tasks',
      'webhook-create-task',
    ]);
    const card = cards.find((entry) => entry.slug === 'notify-reviewer');
    expect(card).toMatchObject({
      name: 'Tell the reviewer',
      scope: 'project',
      icon: 'bell-ring',
      // The platform's own connectors are always there.
      connectors: [
        { slug: 'task', connected: true },
        { slug: 'notify', connected: true },
      ],
      trigger: { kind: 'event', event: 'task.status_changed' },
      steps: [
        { id: 'task', type: 'task.get' },
        { id: 'notify', type: 'notify.member' },
      ],
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

  it('names the schedule a scheduled starter starts from', async () => {
    const card = (await listTemplateCards(sql, 'org_1')).find(
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
      timezone: 'UTC',
    });
  });
});

describe('creating from a starter', () => {
  it('builds the automation the answers make, named as asked, its trigger off', async () => {
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
      message: 'Created from the starter "Tell the reviewer".',
      presentation: {
        name: 'Tell Ada',
        description: expect.stringContaining('In Prüfung'),
        icon: 'bell-ring',
        requiredConnectors: ['task', 'notify'],
      },
    });
  });

  it('gives a model the organization does not serve one it does, and says so', async () => {
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
      /^Created from the starter "Triage new tasks"\. .+/,
    );
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
  });

  it('names what the answers lack on their own too', async () => {
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

  it('refuses a starter that does not exist', async () => {
    await expect(
      prepareTemplateInstance(sql, { ...reviewer, slug: 'nothing-here' }),
    ).rejects.toMatchObject({ code: 'TEMPLATE_NOT_FOUND', status: 404 });
  });
});
