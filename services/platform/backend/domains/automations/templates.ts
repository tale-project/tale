import type { AutomationTrigger } from '@tale/shared/schemas/automation-pack';
import type {
  TemplateAnswers,
  TemplateField,
} from '@tale/shared/schemas/automation-template';
import type { Sql } from 'postgres';

import {
  applyModelDefaults,
  llmModelSteps,
  modelDefaultsMessage,
} from '../../../lib/automations/model-defaults.ts';
import {
  findAutomationTemplate,
  instantiateTemplate,
  loadAutomationTemplates,
  templateAnswerIssues,
  type AutomationTemplate,
  type TemplateAnswerIssue,
} from '../../../lib/automations/templates.ts';
import { findConnector } from '../../../lib/connectors/catalog.ts';
import type { Automation } from '../../../lib/engine/core/types.ts';
import { findOrganizationMember } from '../../auth/membership.ts';
import {
  listActiveCredentials,
  listConnectedConnectorSlugs,
} from '../connector_credentials/service.ts';
import { resolveModelReplacements } from './model-defaults.ts';
import { AutomationError, assertTriggerValid } from './store.ts';

/**
 * Creating an automation from a shipped starter
 * (`configs/platform/system/automation-templates/`): the gallery's listing,
 * and the checks and the document a create needs. The answers are checked
 * twice over — on their own (`templateAnswerIssues`) and against the
 * organization: a project the creator can open, a member of the
 * organization, a credential in service — and nothing is written while one
 * fails. The models the starter names get the organization's served ones,
 * as a seeded pack's do, and the version says so.
 */

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

/** A question as the gallery shows it: where its answer goes stays on the
 * server. */
export type TemplateFieldView = DistributiveOmit<TemplateField, 'writes'>;

/** One starter as the gallery lists it. */
export interface AutomationTemplateCard {
  slug: string;
  name: string;
  description?: string;
  icon?: string;
  details: string;
  /** The display words per locale; absent locales read the English ones. */
  i18n: Record<
    string,
    { name?: string; description?: string; details?: string }
  >;
  /** `project`: the automation is created in a project and serves it. */
  scope: 'org' | 'project';
  fields: TemplateFieldView[];
  /** What must be connected for it to run, and whether it is. A connector
   * of the platform's own surface always is. */
  connectors: { slug: string; connected: boolean }[];
  /** What starts it — a schedule names its rule, the picker's start. */
  trigger:
    | { kind: 'event'; event: string | null }
    | { kind: 'webhook' }
    | {
        kind: 'schedule';
        repeat: Record<string, unknown> | null;
        timezone: string | null;
      }
    | null;
  /** Its steps, in order, for the gallery's "how it works". */
  steps: { id: string; type: string }[];
}

function fieldView(field: TemplateField): TemplateFieldView {
  if (!('writes' in field)) return field;
  const { writes: _writes, ...view } = field;
  return view;
}

function triggerView(
  trigger: AutomationTrigger | undefined,
): AutomationTemplateCard['trigger'] {
  if (trigger === undefined) return null;
  if (trigger.kind === 'event') {
    return { kind: 'event', event: trigger.event ?? null };
  }
  if (trigger.kind === 'webhook') return { kind: 'webhook' };
  return {
    kind: 'schedule',
    repeat: trigger.repeat ?? null,
    timezone: trigger.timezone ?? null,
  };
}

function isPlatformConnector(slug: string): boolean {
  return (
    findConnector(slug)?.auth.some((method) => method.method === 'platform') ??
    false
  );
}

/** One starter as the gallery lists it; `connected` holds the connectors
 * the organization has a credential in service for. */
function templateCard(
  template: AutomationTemplate,
  connected: ReadonlySet<string>,
): AutomationTemplateCard {
  const { manifest } = template;
  const i18n: AutomationTemplateCard['i18n'] = {};
  for (const locale of new Set([
    ...Object.keys(manifest.i18n ?? {}),
    ...Object.keys(manifest.template.i18n ?? {}),
  ])) {
    i18n[locale] = {
      ...manifest.i18n?.[locale],
      ...manifest.template.i18n?.[locale],
    };
  }
  return {
    slug: template.slug,
    name: manifest.name,
    ...(manifest.description !== undefined && {
      description: manifest.description,
    }),
    ...(manifest.icon !== undefined && { icon: manifest.icon }),
    details: manifest.template.details,
    i18n,
    scope: manifest.scope ?? 'org',
    fields: manifest.template.fields.map(fieldView),
    connectors: (manifest.requires?.connectors ?? []).map((slug) => ({
      slug,
      connected: isPlatformConnector(slug) || connected.has(slug),
    })),
    trigger: triggerView(manifest.triggers?.[0]),
    steps: template.automation.nodes.map((node) => ({
      id: node.id,
      type: node.type,
    })),
  };
}

/** The starters, as the gallery of `organizationId` lists them. */
export async function listTemplateCards(
  sql: Sql,
  organizationId: string,
): Promise<AutomationTemplateCard[]> {
  const connected = new Set(
    await listConnectedConnectorSlugs(sql, organizationId),
  );
  return loadAutomationTemplates().map((template) =>
    templateCard(template, connected),
  );
}

/** What the organization says about the answers: a project the creator
 * cannot open, someone who is not a member, a credential not in service. */
async function referenceIssues(
  sql: Sql,
  template: AutomationTemplate,
  args: {
    organizationId: string;
    answers: TemplateAnswers;
    visibleProjectIds: readonly string[];
  },
): Promise<TemplateAnswerIssue[]> {
  const issues: TemplateAnswerIssue[] = [];
  for (const field of template.manifest.template.fields) {
    const answer = args.answers[field.id];
    if (typeof answer !== 'string' || answer.trim() === '') continue;
    const value = answer.trim();
    if (field.kind === 'project' && !args.visibleProjectIds.includes(value)) {
      // A project hidden from the creator answers like one that is not
      // there.
      issues.push({
        field: field.id,
        code: 'unknown',
        message: 'There is no such project you can open.',
      });
    }
    if (
      field.kind === 'member' &&
      (await findOrganizationMember(sql, args.organizationId, value)) === null
    ) {
      issues.push({
        field: field.id,
        code: 'unknown',
        message: 'There is no such member of the organization.',
      });
    }
    if (
      field.kind === 'credential' &&
      !(
        await listActiveCredentials(sql, args.organizationId, field.connector)
      ).some((credential) => credential.name === value)
    ) {
      issues.push({
        field: field.id,
        code: 'unknown',
        message: `There is no ${field.connector} credential of that name in service.`,
      });
    }
  }
  return issues;
}

/** What a create from a starter saves: the document, its first version's
 * words and presentation, the project it is installed in and its trigger. */
export interface PreparedTemplateInstance {
  document: Automation;
  message: string;
  presentation: {
    name: string;
    description?: string;
    icon?: string;
    requiredConnectors?: string[];
  };
  projectId?: string;
  trigger?: AutomationTrigger;
}

/**
 * Check the answers and build what a create from the starter `slug` saves,
 * named `name` and shown as `displayName`. Refuses a starter that does not
 * exist (`TEMPLATE_NOT_FOUND`) and answers it cannot use
 * (`TEMPLATE_ANSWERS_INVALID`, each named in `data.fields`); writes nothing.
 */
export async function prepareTemplateInstance(
  sql: Sql,
  args: {
    organizationId: string;
    slug: string;
    name: string;
    displayName: string;
    answers: TemplateAnswers;
    /** The creator's language, for the defaults the starter words in it. */
    locale?: string;
    visibleProjectIds: readonly string[];
  },
): Promise<PreparedTemplateInstance> {
  const template = findAutomationTemplate(args.slug);
  if (template === null) {
    throw new AutomationError(
      'TEMPLATE_NOT_FOUND',
      'There is no starter by that name.',
      404,
    );
  }
  const issues = [
    ...templateAnswerIssues(template, args.answers, args.locale),
    ...(await referenceIssues(sql, template, args)),
  ];
  if (issues.length > 0) {
    throw new AutomationError(
      'TEMPLATE_ANSWERS_INVALID',
      'Some answers cannot be used.',
      400,
      { fields: issues },
    );
  }
  const instance = instantiateTemplate(template, {
    name: args.name,
    answers: args.answers,
    ...(args.locale !== undefined && { locale: args.locale }),
  });
  // The trigger is checked as its save will check it, before anything is
  // written: a schedule that could never start a run is the schedule
  // question's to answer again, not an automation left without its trigger.
  if (instance.trigger !== undefined) {
    try {
      assertTriggerValid(instance.trigger);
    } catch (error) {
      const asked = template.manifest.template.fields.find(
        (field) => field.kind === 'schedule',
      );
      if (
        asked === undefined ||
        !(error instanceof AutomationError) ||
        error.code !== 'AUTOMATION_TRIGGER_INVALID'
      ) {
        throw error;
      }
      throw new AutomationError(
        'TEMPLATE_ANSWERS_INVALID',
        'Some answers cannot be used.',
        400,
        {
          fields: [
            { field: asked.id, code: 'invalid', message: error.message },
          ],
        },
      );
    }
  }
  const models = [
    ...new Set(llmModelSteps(instance.document).map((step) => step.model)),
  ];
  const replacements =
    models.length === 0
      ? new Map<string, string>()
      : await resolveModelReplacements(sql, args.organizationId, models);
  const seeded = applyModelDefaults(
    instance.document,
    (model) => replacements.get(model) ?? null,
  );
  const { manifest } = template;
  const base = args.locale?.split('-')[0];
  const description =
    (base === undefined ? undefined : manifest.i18n?.[base]?.description) ??
    manifest.description;
  return {
    document: seeded.document,
    message:
      `Created from the starter "${manifest.name}".` +
      (seeded.changes.length === 0
        ? ''
        : ` ${modelDefaultsMessage(seeded.changes)}`),
    presentation: {
      name: args.displayName,
      ...(description !== undefined && { description }),
      ...(manifest.icon !== undefined && { icon: manifest.icon }),
      ...(manifest.requires?.connectors !== undefined && {
        requiredConnectors: manifest.requires.connectors,
      }),
    },
    ...(instance.projectId !== undefined && { projectId: instance.projectId }),
    ...(instance.trigger !== undefined && { trigger: instance.trigger }),
  };
}
