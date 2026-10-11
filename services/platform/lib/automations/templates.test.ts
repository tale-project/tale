import path from 'node:path';

import type { TemplateAnswers } from '@tale/shared/schemas/automation-template';
import { describe, expect, it } from 'vitest';

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
  templateAnswerIssues,
  templateWritePointers,
} from './templates';
import { triggerInputSample } from './trigger-input';

const REPO = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  '../../../..',
);
const SYSTEM = path.join(REPO, 'configs/platform/system');

// The engine is assembled at module scope, as the pack suite does: a starter
// naming an unregistered action must fail as a validation error.
setCodeRunner(nodeVmRunner());
const { connectors } = loadConnectors(SYSTEM);
const templates = loadAutomationTemplates({ root: SYSTEM });
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
    if (field.kind === 'project') answers[field.id] = 'prj_example';
    if (field.kind === 'member') answers[field.id] = 'usr_example';
    if (field.kind === 'credential') answers[field.id] = 'Example credential';
    if (field.kind === 'choice') {
      answers[field.id] = field.options.at(-1)?.value ?? '';
    }
    if (field.kind === 'schedule') {
      answers[field.id] = {
        repeat: {
          frequency: 'weekly',
          interval: 1,
          weekdays: [1, 3, 5],
          times: ['09:30'],
        },
        timezone: 'Europe/Zurich',
      };
    }
  }
  return answers;
}

describe('the shipped starters', () => {
  it('are all discovered, each with a manifest and a document', () => {
    expect(templates.map((template) => template.slug)).toEqual([
      'answer-questions',
      'inbox-summary',
      'notify-reviewer',
      'triage-new-tasks',
      'webhook-create-task',
    ]);
  });

  for (const template of templates) {
    describe(template.slug, () => {
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

      it('writes every answer where its document holds a value', () => {
        for (const field of template.manifest.template.fields) {
          for (const pointer of templateWritePointers(
            template.automation,
            field,
          )) {
            expect(pointer, `${field.id} names a step`).not.toBeNull();
          }
        }
        expect(() =>
          instantiateTemplate(template, {
            name: 'example',
            answers: exampleAnswers(template),
          }),
        ).not.toThrow();
      });

      it('words every question in German and French', () => {
        for (const locale of ['de', 'fr']) {
          for (const field of template.manifest.template.fields) {
            expect(
              field.i18n?.[locale]?.label,
              `${field.id} ${locale}`,
            ).toBeDefined();
          }
          expect(template.manifest.i18n?.[locale]?.name).toBeDefined();
          expect(template.manifest.i18n?.[locale]?.description).toBeDefined();
          expect(
            template.manifest.template.i18n?.[locale]?.details,
          ).toBeDefined();
        }
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
        // Off until the person who deploys it turns it on.
        expect(trigger.enabled).toBe(false);
        const sample = triggerInputSample(trigger, Date.parse('2026-10-09'));
        expect(sample).not.toBeNull();
        if (sample === null) return;
        const inputs = template.automation.inputs;
        const check = inputs === undefined ? null : compileSchema(inputs);
        expect(triggerInputWarnings(check, sample)).toEqual([]);
      });
    });
  }
});

describe('creating from a starter', () => {
  const reviewer = templates.find(
    (template) => template.slug === 'notify-reviewer',
  );
  const inbox = templates.find((template) => template.slug === 'inbox-summary');
  const webhook = templates.find(
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
    expect(document.nodes[0]?.input).toMatchObject({ projectId: 'prj_ops' });
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
    // Unanswered, the starter's own schedule stands.
    expect(
      instantiateTemplate(inbox, {
        name: 'inbox',
        answers: { mailbox: 'gmail', recipient: 'usr_ada' },
      }).trigger,
    ).toMatchObject({ kind: 'schedule', timezone: 'UTC', enabled: false });
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

  it('takes the default of a choice left blank', () => {
    expect(
      templateAnswerIssues(inbox, { mailbox: '', recipient: 'usr_ada' }),
    ).toEqual([]);
    const { document } = instantiateTemplate(inbox, {
      name: 'inbox',
      answers: { recipient: 'usr_ada' },
    });
    expect(
      document.nodes.find((node) => node.id === 'inbox')?.input,
    ).toMatchObject({ connectorSlug: 'gmail' });
  });
});
