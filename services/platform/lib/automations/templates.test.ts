import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { icons as lucideIcons } from '@iconify-json/lucide';
import { brandOfIcon } from '@tale/shared/schemas/automation-pack';
import type { TemplateAnswers } from '@tale/shared/schemas/automation-template';
import { afterAll, describe, expect, it, vi } from 'vitest';

import { loadConnectors } from '../connectors/registry';
import { runAutomationTests } from '../engine/api/tests';
import { setCodeRunner } from '../engine/core/runner';
import { nodeTypes } from '../engine/core/slots';
import type { Automation } from '../engine/core/types';
import { validate } from '../engine/core/validate';
import { compileSchema } from '../engine/core/validate/schema';
import { triggerInputWarnings } from '../engine/core/validate/trigger-input';
import { nodeVmRunner } from '../engine/runners/node-vm';
import {
  type AutomationTemplate,
  instantiateTemplate,
  loadAutomationTemplates,
  packsWithoutTemplate,
  templateAnswerIssues,
  templateWriteTargets,
} from './templates';
import { triggerInputSample } from './trigger-input';

const REPO = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  '../../../..',
);
const SYSTEM = path.join(REPO, 'configs/platform/system');
const CUSTOM = path.join(REPO, 'configs/platform/custom');

// The engine is assembled at module scope, as the pack suite does: a
// template naming an unregistered action must fail as a validation error.
setCodeRunner(nodeVmRunner());
const { connectors } = loadConnectors(SYSTEM);
const catalog = loadAutomationTemplates({
  root: SYSTEM,
  packsRoot: CUSTOM,
  // The shipped tree is held strict: a slug both roots ship fails here.
  strict: true,
});
const starters = catalog.filter((template) => template.source === 'starter');
const connectorNames = new Set(connectors.map((connector) => connector.name));

/** The connectors a document calls, from its node types. */
function connectorsUsedBy(automation: Automation): string[] {
  const used = new Set<string>();
  for (const node of automation.nodes) {
    if (!node.type.includes('.')) continue;
    used.add(node.type.slice(0, node.type.indexOf('.')));
  }
  return [...used].sort();
}

/** A validation issue as one readable line. */
function issueText(issue: {
  code: string;
  message: string;
  nodeId?: string;
}): string {
  return `${issue.nodeId ?? '-'} [${issue.code}] ${issue.message}`;
}

/** An answer to every question, as a creator might give it. */
function exampleAnswers(template: AutomationTemplate): TemplateAnswers {
  const answers: TemplateAnswers = {};
  for (const field of template.manifest.template.fields) {
    switch (field.kind) {
      case 'project':
        answers[field.id] = 'prj_example';
        break;
      case 'member':
        answers[field.id] = 'usr_example';
        break;
      case 'credential':
        answers[field.id] = 'Example credential';
        break;
      case 'choice':
        answers[field.id] = field.options.at(-1)?.value ?? '';
        break;
      case 'text':
        // A text answers with what the template offers: its default, else
        // the example its input shows, which fits the form it asks for.
        answers[field.id] = field.default ?? field.placeholder ?? 'example';
        break;
      case 'number':
        answers[field.id] = field.max;
        break;
      case 'toggle':
        answers[field.id] = field.default !== true;
        break;
      case 'list':
        answers[field.id] = ['first', 'second'];
        break;
      case 'schedule':
        answers[field.id] = {
          repeat: {
            frequency: 'weekly',
            interval: 1,
            weekdays: [1, 3, 5],
            times: ['09:30'],
          },
          timezone: 'Europe/Zurich',
        };
        break;
      default: {
        const exhaustive: never = field;
        throw new Error(`unhandled question ${String(exhaustive)}`);
      }
    }
  }
  return answers;
}

/** Every display text a template shows, by where it sits, with the
 * locale's own words or undefined. A choice's option labels are left out:
 * they are mostly product names (Gmail, Outlook), which read the same in
 * every language and fall back to the English. */
function wordedIn(
  template: AutomationTemplate,
  locale: string,
): [string, string | undefined][] {
  const { manifest } = template;
  const words: [string, string | undefined][] = [
    ['name', manifest.i18n?.[locale]?.name],
    ['description', manifest.i18n?.[locale]?.description],
    ['details', manifest.template.i18n?.[locale]?.details],
  ];
  for (const [at, step] of manifest.template.steps.entries()) {
    words.push([`steps[${at}].title`, step.i18n?.[locale]?.title]);
    if (step.detail !== undefined) {
      words.push([`steps[${at}].detail`, step.i18n?.[locale]?.detail]);
    }
  }
  for (const [at, outcome] of manifest.template.outcomes.entries()) {
    words.push([`outcomes[${at}]`, outcome.i18n?.[locale]?.text]);
  }
  for (const field of manifest.template.fields) {
    const own = field.i18n?.[locale];
    words.push([`${field.id}.label`, own?.label]);
    if (field.description !== undefined) {
      words.push([`${field.id}.description`, own?.description]);
    }
    if (field.kind === 'text' && field.default !== undefined) {
      words.push([`${field.id}.default`, own?.default]);
    }
    if (
      (field.kind === 'text' ||
        field.kind === 'list' ||
        field.kind === 'credential') &&
      field.placeholder !== undefined
    ) {
      words.push([`${field.id}.placeholder`, own?.placeholder]);
    }
  }
  return words;
}

describe('the template catalog', () => {
  it('holds the six starters', () => {
    expect(starters.map((template) => template.slug)).toEqual([
      'answer-questions',
      'inbox-summary',
      'notify-reviewer',
      'task-digest',
      'triage-new-tasks',
      'webhook-create-task',
    ]);
  });

  it('holds every shipped pack that is not hidden [AUTO-R57]', () => {
    // A pack is in the catalog through its template block; one without it
    // is offered nowhere, so a new organization could never have it.
    expect(packsWithoutTemplate({ packsRoot: CUSTOM })).toEqual([]);
  });

  it('says each template works only with templates it holds', () => {
    const slugs = new Set(catalog.map((template) => template.slug));
    for (const template of catalog) {
      for (const other of template.manifest.template.worksWith ?? []) {
        expect(slugs.has(other), `${template.slug} → ${other}`).toBe(true);
        expect(other).not.toBe(template.slug);
      }
    }
  });

  for (const template of catalog) {
    describe(template.slug, () => {
      it('shows a category, an icon the app draws, its steps and what it changes', () => {
        const { icon, category, template: block } = template.manifest;
        expect(category).toBeDefined();
        expect(icon, 'an icon').toBeDefined();
        if (icon === undefined) return;
        if (icon.startsWith('brand:')) {
          expect(brandOfIcon(icon)).not.toBeNull();
        } else {
          expect(
            lucideIcons.icons[icon] ?? lucideIcons.aliases?.[icon],
            `lucide has "${icon}"`,
          ).toBeDefined();
        }
        expect(block.steps.length).toBeGreaterThan(0);
        expect(block.outcomes.length).toBeGreaterThan(0);
      });

      it('words everything it shows in German and French', () => {
        for (const locale of ['de', 'fr']) {
          const missing = wordedIn(template, locale)
            .filter(([, words]) => words === undefined || words.trim() === '')
            .map(([where]) => where);
          expect(missing, locale).toEqual([]);
        }
      });

      it('writes every answer where its document or trigger holds a value', () => {
        for (const field of template.manifest.template.fields) {
          for (const write of templateWriteTargets(
            template.automation,
            field,
          )) {
            expect(write.pointer, `${field.id} names a step`).not.toBeNull();
          }
        }
        expect(() =>
          instantiateTemplate(template, {
            name: 'example',
            answers: exampleAnswers(template),
          }),
        ).not.toThrow();
      });

      it('makes, from any answers, an automation that validates and passes its tests', async () => {
        const answers = exampleAnswers(template);
        expect(templateAnswerIssues(template, answers)).toEqual([]);
        const instance = instantiateTemplate(template, {
          name: 'example',
          answers,
        });
        const { errors } = await validate(instance.document);
        expect(errors.map(issueText)).toEqual([]);
        const report = await runAutomationTests(instance.document);
        expect(report, JSON.stringify(report)).toMatchObject({ failed: 0 });
      });

      it('has a trigger whose runs its inputs take', () => {
        const { trigger } = instantiateTemplate(template, {
          name: 'example',
          answers: exampleAnswers(template),
        });
        if (trigger === undefined) return;
        // Off until the create that starts the automation turns it on.
        expect(trigger.enabled).toBe(false);
        const sample = triggerInputSample(trigger, Date.parse('2026-10-09'));
        expect(sample).not.toBeNull();
        if (sample === null) return;
        const inputs = template.automation.inputs;
        const check = inputs === undefined ? null : compileSchema(inputs);
        expect(triggerInputWarnings(check, sample)).toEqual([]);
      });

      it('names what the empty choice of an optional credential question means', () => {
        // "The default GitHub connection", "Every connected Gmail mailbox":
        // what empty means differs per template, so the template says it.
        for (const field of template.manifest.template.fields) {
          if (field.kind !== 'credential' || field.required !== false) continue;
          expect(field.placeholder, field.id).toBeDefined();
        }
      });

      it('asks when it runs, when a schedule starts it', () => {
        if (template.manifest.triggers?.[0]?.kind !== 'schedule') return;
        expect(
          template.manifest.template.fields.some(
            (field) => field.kind === 'schedule',
          ),
        ).toBe(true);
      });
    });
  }

  // The packs' own suite holds a pack's document; a starter's is held here.
  for (const template of starters) {
    describe(`the starter ${template.slug}`, () => {
      it('validates clean', async () => {
        const { errors } = await validate(template.automation);
        expect(errors.map(issueText)).toEqual([]);
      });

      it('carries its own tests and they all pass against the mocks', async () => {
        const report = await runAutomationTests(template.automation);
        expect(report).not.toHaveProperty('error');
        expect(report, JSON.stringify(report)).toMatchObject({ failed: 0 });
        expect('passed' in report ? report.passed : 0).toBeGreaterThan(0);
      });

      it('declares every connector its document calls', () => {
        const declared = new Set(template.manifest.requires?.connectors ?? []);
        for (const name of connectorsUsedBy(template.automation)) {
          expect(declared.has(name)).toBe(true);
        }
        for (const name of declared) expect(connectorNames).toContain(name);
      });

      it('names every node type the engine knows', () => {
        for (const node of template.automation.nodes) {
          expect(nodeTypes().has(node.type)).toBe(true);
        }
      });

      it('is addressed by its directory', () => {
        expect(template.automation.name).toBe(template.slug);
      });
    });
  }
});

describe('a catalog read from both roots', () => {
  const scratch = mkdtempSync(path.join(tmpdir(), 'tale-template-catalog-'));
  afterAll(() => rmSync(scratch, { recursive: true, force: true }));

  const document = [
    'version: 1',
    'name: same',
    'nodes:',
    '  - id: note',
    '    type: transform',
    '    code: return {};',
    '',
  ].join('\n');
  const manifest = (extra: string) =>
    [
      'name: Same',
      'category: tasks',
      'template:',
      '  details: Does one thing.',
      '  steps:',
      '    - title: Does it',
      '  outcomes:',
      '    - kind: creates',
      '      text: One thing.',
      '  fields: []',
      extra,
      '',
    ].join('\n');
  const plant = (dir: string, extra = '') => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'automation.yml'), manifest(extra));
    writeFileSync(path.join(dir, 'workflow.yml'), document);
  };

  it('refuses a slug both roots ship in the shipped tree, and keeps the starter at runtime', () => {
    plant(path.join(scratch, 'twice/system/automation-templates/same'));
    plant(path.join(scratch, 'twice/custom/automations/same'));
    const roots = {
      root: path.join(scratch, 'twice/system'),
      packsRoot: path.join(scratch, 'twice/custom'),
    };
    expect(() => loadAutomationTemplates({ ...roots, strict: true })).toThrow(
      /ships twice/,
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      expect(
        loadAutomationTemplates(roots).map((template) => [
          template.slug,
          template.source,
        ]),
      ).toEqual([['same', 'starter']]);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('ships twice'));
    } finally {
      warn.mockRestore();
    }
  });

  it('leaves out a hidden pack and one without a template block', () => {
    plant(path.join(scratch, 'apart/system/automation-templates/starter'));
    plant(path.join(scratch, 'apart/custom/automations/shown/one'));
    plant(
      path.join(scratch, 'apart/custom/automations/hidden/one'),
      'hidden: true',
    );
    const bare = path.join(scratch, 'apart/custom/automations/bare/one');
    mkdirSync(bare, { recursive: true });
    writeFileSync(path.join(bare, 'automation.yml'), 'name: Bare\n');
    writeFileSync(path.join(bare, 'workflow.yml'), document);
    const read = loadAutomationTemplates({
      root: path.join(scratch, 'apart/system'),
      packsRoot: path.join(scratch, 'apart/custom'),
    });
    expect(read.map((template) => [template.slug, template.source])).toEqual([
      ['shown/one', 'pack'],
      ['starter', 'starter'],
    ]);
    expect(
      packsWithoutTemplate({ packsRoot: path.join(scratch, 'apart/custom') }),
    ).toEqual(['bare/one']);
  });
});

describe('using a starter', () => {
  const reviewer = starters.find(
    (template) => template.slug === 'notify-reviewer',
  );
  const inbox = starters.find((template) => template.slug === 'inbox-summary');
  const webhook = starters.find(
    (template) => template.slug === 'webhook-create-task',
  );
  if (reviewer === undefined || inbox === undefined || webhook === undefined) {
    throw new Error('a starter these cases read is missing');
  }
  const notifyInput = (document: Automation) =>
    document.nodes.find((node) => node.id === 'notify')?.input;

  it('writes each answer where its question says, a list placeholder as a list of one', () => {
    const { document, projectId } = instantiateTemplate(reviewer, {
      name: 'tell-ada',
      answers: {
        project: 'prj_1',
        reviewer: 'usr_ada',
        message: '  Please look at this one.  ',
      },
    });
    expect(document.name).toBe('tell-ada');
    expect(projectId).toBe('prj_1');
    expect(notifyInput(document)).toMatchObject({
      to: ['usr_ada'],
      message: 'Please look at this one.',
      // What no question names stays as shipped.
      title: '{{ nodes.task.output.title }}',
    });
    // The shipped document is never touched.
    expect(notifyInput(reviewer.automation)).toMatchObject({
      to: ['run-starter'],
    });
  });

  it('takes a blank text in the creator’s language', () => {
    for (const [locale, words] of [
      ['de', 'Diese Aufgabe ist bereit für deine Prüfung.'],
      ['de-CH', 'Diese Aufgabe ist bereit für deine Prüfung.'],
      ['fr', 'Cette tâche est prête pour ta relecture.'],
      ['it', 'This task is ready for your review.'],
      [undefined, 'This task is ready for your review.'],
    ] as const) {
      const { document } = instantiateTemplate(reviewer, {
        name: 'tell-ada',
        answers: { project: 'prj_1', reviewer: 'usr_ada', message: ' ' },
        ...(locale !== undefined && { locale }),
      });
      expect(notifyInput(document)).toMatchObject({ message: words });
    }
  });

  it('writes the project wherever a step needs its id too', () => {
    const { document, projectId } = instantiateTemplate(webhook, {
      name: 'alerts',
      answers: { project: 'prj_ops' },
    });
    expect(projectId).toBe('prj_ops');
    expect(
      document.nodes.find((node) => node.id === 'upsert')?.input,
    ).toMatchObject({ projectId: 'prj_ops' });
  });

  it('sets the schedule it was given, and leaves the trigger off', () => {
    const repeat = {
      frequency: 'daily' as const,
      interval: 1,
      times: ['17:00'],
    };
    const { trigger, document } = instantiateTemplate(inbox, {
      name: 'evening-inbox',
      answers: {
        mailbox: 'outlook',
        recipient: 'usr_ada',
        schedule: { repeat, timezone: 'Europe/Zurich' },
      },
      // The answer's own zone wins over the creator's.
      timezone: 'America/New_York',
    });
    expect(trigger).toEqual({
      kind: 'schedule',
      repeat,
      timezone: 'Europe/Zurich',
      enabled: false,
    });
    expect(
      document.nodes.find((node) => node.id === 'inbox')?.input,
    ).toMatchObject({ connectorSlug: 'outlook' });
  });

  it('runs a schedule nobody answered in the creator’s time zone [AUTO-R60]', () => {
    const answers = { mailbox: 'gmail', recipient: 'usr_ada' };
    expect(
      instantiateTemplate(inbox, {
        name: 'inbox',
        answers,
        timezone: 'Europe/Zurich',
      }).trigger,
    ).toMatchObject({
      kind: 'schedule',
      repeat: { frequency: 'weekly', times: ['08:00'] },
      timezone: 'Europe/Zurich',
      enabled: false,
    });
    // A zone that does not exist leaves the shipped one.
    expect(
      instantiateTemplate(inbox, {
        name: 'inbox',
        answers,
        timezone: 'Mars/Olympus',
      }).trigger,
    ).toMatchObject({ timezone: 'UTC' });
    expect(
      instantiateTemplate(inbox, { name: 'inbox', answers }).trigger,
    ).toMatchObject({ timezone: 'UTC' });
  });

  it('takes a cron expression and the missed-runs choice the schedule field writes', () => {
    const { trigger } = instantiateTemplate(inbox, {
      name: 'evening-inbox',
      answers: {
        mailbox: 'gmail',
        recipient: 'usr_ada',
        schedule: {
          cron: '30 17 * * 1-5',
          timezone: 'Europe/Zurich',
          catchUp: 'skip',
        },
      },
    });
    // The declared rule gives way: a schedule names a rule or a cron.
    expect(trigger).toEqual({
      kind: 'schedule',
      cron: '30 17 * * 1-5',
      timezone: 'Europe/Zurich',
      catchUp: 'skip',
      enabled: false,
    });
    expect(
      templateAnswerIssues(inbox, {
        mailbox: 'gmail',
        recipient: 'usr_ada',
        schedule: {
          repeat: { frequency: 'daily', interval: 1, times: ['17:00'] },
          cron: '0 17 * * *',
          timezone: 'Europe/Zurich',
        },
      }).map((issue) => [issue.field, issue.code]),
    ).toEqual([['schedule', 'invalid']]);
  });

  it('names every answer it cannot use', () => {
    expect(
      templateAnswerIssues(inbox, {
        mailbox: 'pigeon',
        title: 'x'.repeat(201),
        schedule: {
          repeat: { frequency: 'daily', interval: 1, times: [] },
          timezone: 'Europe/Zurich',
        },
        colour: 'blue',
      }).map((issue) => [issue.field, issue.code]),
    ).toEqual([
      ['colour', 'unexpected'],
      ['mailbox', 'invalid'],
      ['recipient', 'required'],
      ['schedule', 'invalid'],
      ['title', 'too_long'],
    ]);
  });

  it('asks which mailbox to summarize, guessing none', () => {
    expect(
      templateAnswerIssues(inbox, { mailbox: '', recipient: 'usr_ada' }).map(
        (issue) => [issue.field, issue.code],
      ),
    ).toEqual([['mailbox', 'required']]);
  });
});

/** A template held only by this suite: one of each kind of question,
 * writing into a step and into the trigger's fixed input. */
function syncTemplate(): AutomationTemplate {
  const automation: Automation = {
    version: 1,
    name: 'sync',
    nodes: [
      {
        id: 'sync',
        type: 'transform',
        input: {
          labels: [],
          query: '',
          limit: 10,
          includeClosed: false,
          credential: 'name',
        },
        code: 'return input;',
      },
    ],
  };
  return {
    slug: 'example/sync',
    dir: '/nowhere',
    source: 'pack',
    automation,
    manifest: {
      name: 'Sync',
      category: 'issues',
      triggers: [
        {
          kind: 'schedule',
          repeat: { frequency: 'hourly', interval: 1, minute: 0 },
          timezone: 'UTC',
          input: { owner: 'your-organization', repo: 'your-repository' },
        },
      ],
      template: {
        details: 'Syncs.',
        steps: [{ title: 'Syncs' }],
        outcomes: [{ kind: 'creates', text: 'Tasks.' }],
        fields: [
          {
            id: 'owner',
            kind: 'text',
            label: 'Owner',
            pattern: '[A-Za-z0-9-]+',
            writes: [{ trigger: true, pointer: '/input/owner' }],
          },
          {
            id: 'repo',
            kind: 'text',
            label: 'Repository',
            writes: [{ trigger: true, pointer: '/input/repo' }],
          },
          {
            id: 'limit',
            kind: 'number',
            label: 'Issues per run',
            min: 1,
            max: 50,
            default: 25,
            writes: [{ node: 'sync', pointer: '/input/limit' }],
          },
          {
            id: 'closed',
            kind: 'toggle',
            label: 'Closed issues too',
            writes: [{ node: 'sync', pointer: '/input/includeClosed' }],
          },
          {
            id: 'labels',
            kind: 'list',
            label: 'Labels',
            maxItems: 3,
            itemMaxLength: 10,
            writes: [
              { node: 'sync', pointer: '/input/labels' },
              { node: 'sync', pointer: '/input/query' },
            ],
          },
          {
            id: 'account',
            kind: 'credential',
            label: 'Account',
            connector: 'github',
            required: false,
            writes: [{ node: 'sync', pointer: '/input/credential' }],
          },
        ],
      },
    },
  };
}

describe('using a template with every kind of question', () => {
  const template = syncTemplate();
  const syncInput = (document: Automation) =>
    document.nodes.find((node) => node.id === 'sync')?.input;

  it('takes the default of a choice left blank', () => {
    const withChoice = syncTemplate();
    const step = withChoice.automation.nodes.find((node) => node.id === 'sync');
    if (step?.input === undefined) throw new Error('the sync step is missing');
    step.input.state = 'open';
    withChoice.manifest.template.fields.push({
      id: 'state',
      kind: 'choice',
      label: 'Issues',
      default: 'all',
      options: [
        { value: 'open', label: 'Open ones' },
        { value: 'all', label: 'All of them' },
      ],
      writes: [{ node: 'sync', pointer: '/input/state' }],
    });
    const answers = { owner: 'tale-project', repo: 'tale', state: '' };
    expect(templateAnswerIssues(withChoice, answers)).toEqual([]);
    expect(
      syncInput(
        instantiateTemplate(withChoice, { name: 'sync-tale', answers })
          .document,
      ),
    ).toMatchObject({ state: 'all' });
  });

  it('writes answers into the trigger’s fixed input, every run receiving them [AUTO-R59]', () => {
    const { trigger, document } = instantiateTemplate(template, {
      name: 'sync-tale',
      answers: { owner: 'tale-project', repo: 'tale' },
    });
    expect(trigger).toMatchObject({
      kind: 'schedule',
      input: { owner: 'tale-project', repo: 'tale' },
      enabled: false,
    });
    // The manifest's trigger stays as shipped.
    expect(template.manifest.triggers?.[0]).toMatchObject({
      input: { owner: 'your-organization' },
    });
    // Defaults where nothing was answered: the number's, the toggle off,
    // no labels, and an optional credential left as shipped.
    expect(syncInput(document)).toEqual({
      labels: [],
      query: '',
      limit: 25,
      includeClosed: false,
      credential: 'name',
    });
  });

  it('writes a number, a toggle and a list in the shape their places take', () => {
    const { document } = instantiateTemplate(template, {
      name: 'sync-tale',
      answers: {
        owner: 'tale-project',
        repo: 'tale',
        limit: 50,
        closed: true,
        labels: [' bug ', '', 'ui', 'bug'],
        account: 'Work account',
      },
    });
    expect(syncInput(document)).toEqual({
      // A list place takes the list; a text place takes its items joined.
      labels: ['bug', 'ui'],
      query: 'bug, ui',
      limit: 50,
      includeClosed: true,
      credential: 'Work account',
    });
  });

  it('refuses a number outside its bounds, a text off its form and a list too long [AUTO-R45]', () => {
    expect(
      templateAnswerIssues(template, {
        owner: 'tale project',
        repo: '',
        limit: 51,
        closed: 'yes' as unknown as boolean,
        labels: ['a', 'b', 'c', 'd'],
      }).map((issue) => [issue.field, issue.code]),
    ).toEqual([
      ['owner', 'invalid'],
      ['repo', 'required'],
      ['limit', 'invalid'],
      ['closed', 'invalid'],
      ['labels', 'too_long'],
    ]);
    expect(
      templateAnswerIssues(template, {
        owner: 'tale',
        repo: 'tale',
        limit: 2.5,
        labels: ['far-too-long-a-label'],
      }).map((issue) => [issue.field, issue.code]),
    ).toEqual([
      ['limit', 'invalid'],
      ['labels', 'too_long'],
    ]);
  });
});
