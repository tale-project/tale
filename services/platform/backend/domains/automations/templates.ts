import type {
  AutomationCategory,
  AutomationTrigger,
} from '@tale/shared/schemas/automation-pack';
import { automationSettingsSchema } from '@tale/shared/schemas/automation-settings';
import type {
  TemplateAnswers,
  TemplateField,
  TemplateOutcome,
  TemplateStep,
} from '@tale/shared/schemas/automation-template';
import type { ScheduleRule } from '@tale/shared/schemas/schedule-rule';
import { taskSubjectContractSchema } from '@tale/shared/schemas/task-contract';
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
  type LoadTemplatesOptions,
  type TemplateAnswerIssue,
} from '../../../lib/automations/templates.ts';
import { findConnector } from '../../../lib/connectors/catalog.ts';
import type { TestReport } from '../../../lib/engine/api/tests.ts';
import type { Automation } from '../../../lib/engine/core/types.ts';
import {
  automationPresentationSchema,
  type AutomationPresentation,
} from '../../../lib/shared/schemas/automation_presentation.ts';
import { findOrganizationMember } from '../../auth/membership.ts';
import { resolveBuiltinCatalogRoot } from '../../core/lib/config_store/builtin_catalog.ts';
import type { WriteOrigin } from '../../lib/write-origin.ts';
import { listCredentialsInService } from '../connector_credentials/service.ts';
import {
  readableProjectsAmong,
  readableProjectsSql,
} from '../projects/readable-projects.ts';
import type { ProjectAuthContext } from '../projects/service.ts';
import { resolveModelReplacements } from './model-defaults.ts';
import {
  answerTriggerWrite,
  assertTriggerValid,
  AutomationError,
  deployInTx,
  saveVersionInTx,
  setTriggerInTx,
  triggerWriteAnswer,
  type SetTriggerResult,
  type TriggerWritten,
} from './store.ts';

/**
 * Using a template of the catalog (`lib/automations/templates.ts`): the
 * catalog's cards and a template's preview, resolved against the
 * organization — which connectors it has, which credentials, which
 * automations already came from a template — and the create.
 *
 * The answers are checked twice over — on their own
 * (`templateAnswerIssues`) and against the organization: a project the
 * creator can open, a member of the organization, a credential in service —
 * and nothing is written while one fails. The models a template names get
 * the organization's served ones, and the version says so. The create
 * writes version 1, its deployment when it starts the automation, and its
 * trigger in ONE transaction: a create that fails anywhere leaves nothing.
 */

/** The catalog the backend reads: the system root its resolver finds, and
 * the builtin root a deployment bakes (`TALE_CONFIG_BUILTIN_DIR`). */
function catalogRoots(): LoadTemplatesOptions {
  return { packsRoot: resolveBuiltinCatalogRoot() };
}

function loadCatalog(): AutomationTemplate[] {
  return loadAutomationTemplates(catalogRoots());
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

/** A question as the catalog shows it: where its answer goes stays on the
 * server. */
export type TemplateFieldView = DistributiveOmit<TemplateField, 'writes'>;

/** What starts a template's automation — a schedule names its rule, the
 * setup's start. */
export type TemplateTriggerView =
  | { kind: 'event'; event: string | null }
  | { kind: 'webhook' }
  | {
      kind: 'schedule';
      repeat: ScheduleRule | null;
      cron: string | null;
      timezone: string | null;
    }
  | null;

/** One template as the catalog lists it. */
export interface AutomationTemplateCard {
  /** Its directory below its catalog root: `task-digest`,
   * `gmail/sync-emails`. */
  slug: string;
  name: string;
  description?: string;
  /** A lucide name, or `brand:<slug>` for a product's logo. */
  icon?: string;
  category: AutomationCategory;
  /** Proper-noun chips (Gmail, GitHub), never translated. */
  labels: string[];
  details: string;
  /** The display words per locale; absent locales read the English ones. */
  i18n: Record<
    string,
    { name?: string; description?: string; details?: string }
  >;
  /** `project`: the automation is created in a project and serves it. */
  scope: 'org' | 'project';
  /** How it works, in order, each worded per locale. */
  steps: TemplateStep[];
  /** What it creates, changes or sends, and what it never does. */
  outcomes: TemplateOutcome[];
  /** The templates it works with, by slug. */
  worksWith: string[];
  fields: TemplateFieldView[];
  /** What must be connected for it to run, and whether it is. A connector
   * of the platform's own surface (`platform`) always is. */
  connectors: { slug: string; connected: boolean; platform: boolean }[];
  /** What starts it. */
  trigger: TemplateTriggerView;
  /** How many of the organization's automations came from it. */
  inUse: number;
}

/** One template as its preview shows it: the card, the document it
 * creates — the read-only flow — and the credentials its questions can
 * name. */
export interface AutomationTemplateDetail extends AutomationTemplateCard {
  document: Automation;
  /** The credentials in service, by connector, of every connector a
   * question asks a credential of: names only. */
  credentials: Record<string, { name: string }[]>;
}

function fieldView(field: TemplateField): TemplateFieldView {
  if (!('writes' in field)) return field;
  const { writes: _writes, ...view } = field;
  return view;
}

function triggerView(
  trigger: AutomationTrigger | undefined,
): TemplateTriggerView {
  if (trigger === undefined) return null;
  if (trigger.kind === 'event') {
    return { kind: 'event', event: trigger.event ?? null };
  }
  if (trigger.kind === 'webhook') return { kind: 'webhook' };
  return {
    kind: 'schedule',
    repeat: trigger.repeat ?? null,
    cron: trigger.cron ?? null,
    timezone: trigger.timezone ?? null,
  };
}

function isPlatformConnector(slug: string): boolean {
  return (
    findConnector(slug)?.auth.some((method) => method.method === 'platform') ??
    false
  );
}

/**
 * How many of the organization's automations came from each template, of
 * those the reader sees (`automationVisible`, the listing's own rule:
 * installed nowhere, or in a project the reader can read, archived ones
 * included — the readable projects joined in the statement, #5201): the
 * template a version of the automation was made from, or — for a pack an
 * earlier release installed in every organization, before templates — the
 * pack's own automation name.
 */
async function templateUsage(
  sql: Sql,
  organizationId: string,
  catalog: readonly AutomationTemplate[],
  reader: ProjectAuthContext,
): Promise<Map<string, number>> {
  const rows = await sql<{ name: string; template: string | null }[]>`
    SELECT a.name,
           (array_agg(a.template_slug ORDER BY a.version DESC)
              FILTER (WHERE a.template_slug IS NOT NULL))[1] AS template
    FROM app.automations a
    WHERE a.org_id = ${organizationId}
    GROUP BY a.org_id, a.name
    HAVING NOT EXISTS (
             SELECT 1 FROM app.automation_project_bindings b
             WHERE b.org_id = a.org_id AND b.automation_name = a.name
           )
        OR EXISTS (
             SELECT 1 FROM app.automation_project_bindings b
             JOIN ${readableProjectsSql(sql, reader, { includeArchived: true })} rp
               ON rp.project_id = b.project_id
             WHERE b.org_id = a.org_id AND b.automation_name = a.name
           )
  `;
  const byPackName = new Map(
    catalog
      .filter((template) => template.source === 'pack')
      .map((template) => [template.automation.name, template.slug]),
  );
  const usage = new Map<string, number>();
  for (const row of rows) {
    const slug = row.template ?? byPackName.get(row.name);
    if (slug === undefined) continue;
    usage.set(slug, (usage.get(slug) ?? 0) + 1);
  }
  return usage;
}

/** One template as the catalog lists it; `connected` holds the connectors
 * the organization has a credential in service for. */
function templateCard(
  template: AutomationTemplate,
  connected: ReadonlySet<string>,
  inUse: number,
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
    category: manifest.category,
    labels: manifest.labels ?? [],
    details: manifest.template.details,
    i18n,
    scope: manifest.scope ?? 'org',
    steps: manifest.template.steps,
    outcomes: manifest.template.outcomes,
    worksWith: manifest.template.worksWith ?? [],
    fields: manifest.template.fields.map(fieldView),
    connectors: (manifest.requires?.connectors ?? []).map((slug) => {
      const platform = isPlatformConnector(slug);
      return { slug, connected: platform || connected.has(slug), platform };
    }),
    trigger: triggerView(manifest.triggers?.[0]),
    inUse,
  };
}

/** The catalog of the organization `organizationId` as `reader` sees it:
 * what is in use counts the automations they can see. */
export async function listTemplateCards(
  sql: Sql,
  organizationId: string,
  reader: ProjectAuthContext,
): Promise<AutomationTemplateCard[]> {
  const catalog = loadCatalog();
  const credentials = await listCredentialsInService(sql, organizationId);
  const usage = await templateUsage(sql, organizationId, catalog, reader);
  const connected = new Set(credentials.keys());
  return catalog.map((template) =>
    templateCard(template, connected, usage.get(template.slug) ?? 0),
  );
}

/** One template's preview in the organization `organizationId` as
 * `reader` sees it; refuses a slug the catalog does not hold
 * (`TEMPLATE_NOT_FOUND`). */
export async function readTemplateDetail(
  sql: Sql,
  organizationId: string,
  slug: string,
  reader: ProjectAuthContext,
): Promise<AutomationTemplateDetail> {
  const catalog = loadCatalog();
  const template = catalog.find((candidate) => candidate.slug === slug);
  if (template === undefined) {
    throw new AutomationError(
      'TEMPLATE_NOT_FOUND',
      'There is no template by that name.',
      404,
    );
  }
  const inService = await listCredentialsInService(sql, organizationId);
  const usage = await templateUsage(sql, organizationId, catalog, reader);
  const credentials: AutomationTemplateDetail['credentials'] = {};
  for (const field of template.manifest.template.fields) {
    if (field.kind !== 'credential') continue;
    credentials[field.connector] = (inService.get(field.connector) ?? []).map(
      (credential) => ({ name: credential.name }),
    );
  }
  return {
    ...templateCard(
      template,
      new Set(inService.keys()),
      usage.get(template.slug) ?? 0,
    ),
    document: template.automation,
    credentials,
  };
}

/** What the organization says about the answers: a project the creator
 * cannot open, someone who is not a member, a credential not in service. */
async function referenceIssues(
  sql: Sql,
  template: AutomationTemplate,
  args: {
    organizationId: string;
    answers: TemplateAnswers;
    viewer: ProjectAuthContext;
  },
): Promise<TemplateAnswerIssue[]> {
  const issues: TemplateAnswerIssue[] = [];
  let inService: Map<string, { id: string; name: string }[]> | undefined;
  for (const field of template.manifest.template.fields) {
    const answer = args.answers[field.id];
    if (typeof answer !== 'string' || answer.trim() === '') continue;
    const value = answer.trim();
    if (
      field.kind === 'project' &&
      !(await readableProjectsAmong(sql, args.viewer, [value])).has(value)
    ) {
      // A project hidden from the creator answers like one that is not
      // there — that project asked alone, never every one they read.
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
    if (field.kind === 'credential') {
      inService ??= await listCredentialsInService(sql, args.organizationId);
      if (
        !(inService.get(field.connector) ?? []).some(
          (credential) => credential.name === value,
        )
      ) {
        issues.push({
          field: field.id,
          code: 'unknown',
          message: `There is no ${field.connector} credential of that name in service.`,
        });
      }
    }
  }
  return issues;
}

/** What a create from a template saves: the document, its first version's
 * words and package data, the project it is installed in and its
 * trigger. */
export interface PreparedTemplateInstance {
  document: Automation;
  message: string;
  presentation: AutomationPresentation;
  /** The template it is made from, kept beside the presentation. */
  templateSlug: string;
  /** The connectors it needs that the organization has no credential in
   * service for, its own platform's left out: it cannot start yet. */
  missingConnectors: string[];
  taskContract?: unknown;
  settings?: unknown;
  projectId?: string;
  trigger?: AutomationTrigger;
}

/** A manifest half the version keeps, in the shape its schema reads, or a
 * packaging defect the catalog suite would have caught. */
function packageHalf<T>(
  value: unknown,
  schema: { safeParse: (v: unknown) => { success: boolean; data?: T } },
  what: string,
  slug: string,
): T | undefined {
  if (value === undefined) return undefined;
  const parsed = schema.safeParse(value);
  if (!parsed.success || parsed.data === undefined) {
    throw new Error(
      `[automations] template "${slug}" has an unreadable ${what}`,
    );
  }
  return parsed.data;
}

/**
 * Check the answers and build what a create from the template `slug`
 * saves, named `name` and shown as `displayName`. Refuses a template that
 * does not exist (`TEMPLATE_NOT_FOUND`) and answers it cannot use
 * (`TEMPLATE_ANSWERS_INVALID`, each named in `data.fields`); writes
 * nothing. `timezone` is the creator's: a schedule the answers leave alone
 * runs in it.
 */
export async function prepareTemplateInstance(
  sql: Sql,
  args: {
    organizationId: string;
    slug: string;
    name: string;
    displayName: string;
    answers: TemplateAnswers;
    /** The creator's language, for the defaults the template words in it. */
    locale?: string;
    /** The creator's time zone. */
    timezone?: string;
    /** The creator: a project answer must be one they can read. */
    viewer: ProjectAuthContext;
  },
): Promise<PreparedTemplateInstance> {
  const template = findAutomationTemplate(args.slug, catalogRoots());
  if (template === null) {
    throw new AutomationError(
      'TEMPLATE_NOT_FOUND',
      'There is no template by that name.',
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
    ...(args.timezone !== undefined && { timezone: args.timezone }),
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
    (args.locale === undefined
      ? undefined
      : manifest.i18n?.[args.locale]?.description) ??
    (base === undefined ? undefined : manifest.i18n?.[base]?.description) ??
    manifest.description;
  // The person names it; what the template declares about how it shows
  // and what it opens comes with it. Where it came from is kept beside the
  // presentation (`template_slug`): the presentation stays the shape an
  // older image reads.
  const presentation = automationPresentationSchema.parse({
    name: args.displayName,
    ...(description !== undefined && { description }),
    ...(manifest.icon !== undefined && { icon: manifest.icon }),
    ...(manifest.labels !== undefined && { labels: manifest.labels }),
    ...(manifest.builtinViews !== undefined && {
      builtinViews: manifest.builtinViews,
    }),
    ...(manifest.requires?.connectors !== undefined && {
      requiredConnectors: manifest.requires.connectors,
    }),
  });
  const inService = await listCredentialsInService(sql, args.organizationId);
  const missingConnectors = (manifest.requires?.connectors ?? []).filter(
    (slug) => !isPlatformConnector(slug) && !inService.has(slug),
  );
  const taskContract = packageHalf(
    manifest.subjects?.task,
    taskSubjectContractSchema,
    'subjects.task',
    template.slug,
  );
  const settings = packageHalf(
    manifest.settings,
    automationSettingsSchema,
    'settings',
    template.slug,
  );
  return {
    document: seeded.document,
    message:
      // The version's message is the system's, in English like the rest.
      `Created from the template "${manifest.name}".` +
      (seeded.changes.length === 0
        ? ''
        : ` ${modelDefaultsMessage(seeded.changes)}`),
    presentation,
    templateSlug: template.slug,
    missingConnectors,
    ...(taskContract !== undefined && { taskContract }),
    ...(settings !== undefined && { settings }),
    ...(instance.projectId !== undefined && { projectId: instance.projectId }),
    ...(instance.trigger !== undefined && { trigger: instance.trigger }),
  };
}

/** What the engine's checks said of the document a create saves: the
 * version's message and its tests' verdict. */
export interface CheckedTemplateSave {
  message?: string;
  testsPassed?: boolean;
  testReport?: TestReport;
}

/** What a create from a template made. */
export interface CreatedFromTemplate {
  name: string;
  version: number;
  /** Version 1 is live: the create started the automation. */
  deployed: boolean;
  /** The template's trigger as it was set — on when the create started the
   * automation — with a webhook's token, minted now and shown once. */
  trigger?: SetTriggerResult & { enabled: boolean };
}

/**
 * What the trigger write of a committed create answers. The create has
 * happened by then: a failure to read the warnings (what the deployed
 * version would make of what the trigger sends) must not answer it as a
 * failure, nor lose the webhook token it minted — the token is shown once.
 */
async function answerAfterCommit(
  sql: Sql,
  args: { organizationId: string; name: string },
  written: TriggerWritten,
): Promise<SetTriggerResult> {
  try {
    return await answerTriggerWrite(sql, args, written);
  } catch (error) {
    console.warn(
      `[automations] ${args.organizationId}/${args.name}: the trigger's warnings could not be read after the create`,
      error instanceof Error ? error.message : error,
    );
    return triggerWriteAnswer(written);
  }
}

/**
 * Write what a create from a template made, after the engine checked the
 * document and ran its tests: version 1 (installed in its project), with
 * `start` its deployment, and its trigger — on with `start`, off without —
 * in ONE transaction, so a refusal anywhere (a name already taken, a
 * deploy gate, a trigger the store refuses) leaves no automation behind,
 * and certainly none half started.
 */
export async function commitTemplateInstance(
  sql: Sql,
  args: {
    organizationId: string;
    name: string;
    origin: WriteOrigin;
    prepared: PreparedTemplateInstance;
    checked: CheckedTemplateSave;
    start: boolean;
  },
): Promise<CreatedFromTemplate> {
  const { organizationId, name, origin, prepared, checked } = args;
  if (args.start && checked.testsPassed === false) {
    throw new AutomationError(
      'AUTOMATION_DEPLOY_REJECTED',
      'The automation cannot start: its own tests fail.',
      409,
    );
  }
  // Started, it would run against a service nobody connected: every run
  // would fail. The app never asks; a direct call is refused the same way.
  if (args.start && prepared.missingConnectors.length > 0) {
    throw new AutomationError(
      'TEMPLATE_CONNECTION_MISSING',
      `Connect ${prepared.missingConnectors.join(', ')} before it can start; it can be created as a draft now.`,
      409,
      { connectors: prepared.missingConnectors },
    );
  }
  const written = await sql.begin(async (tx) => {
    const saved = await saveVersionInTx(tx, {
      organizationId,
      name,
      document: prepared.document,
      origin,
      create: true,
      message: checked.message ?? prepared.message,
      presentation: prepared.presentation,
      templateSlug: prepared.templateSlug,
      ...(checked.testsPassed !== undefined && {
        testsPassed: checked.testsPassed,
      }),
      ...(checked.testReport !== undefined && {
        testReport: checked.testReport,
      }),
      ...(prepared.taskContract !== undefined && {
        taskContract: prepared.taskContract,
      }),
      ...(prepared.settings !== undefined && { settings: prepared.settings }),
      ...(prepared.projectId !== undefined && {
        projectId: prepared.projectId,
      }),
    });
    if (args.start) {
      await deployInTx(tx, {
        organizationId,
        name,
        version: saved.version,
        origin,
        ...(checked.testsPassed !== undefined && {
          testsPassed: checked.testsPassed,
        }),
        ...(checked.testReport !== undefined && {
          testReport: checked.testReport,
        }),
      });
    }
    const trigger =
      prepared.trigger === undefined
        ? undefined
        : await setTriggerInTx(tx, {
            organizationId,
            name,
            trigger: { ...prepared.trigger, enabled: args.start },
            origin,
          });
    return { version: saved.version, trigger };
  });
  const trigger =
    written.trigger === undefined
      ? undefined
      : {
          ...(await answerAfterCommit(
            sql,
            { organizationId, name },
            written.trigger,
          )),
          enabled: args.start,
        };
  return {
    name,
    version: written.version,
    deployed: args.start,
    ...(trigger !== undefined && { trigger }),
  };
}
