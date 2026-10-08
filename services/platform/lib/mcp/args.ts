import { automationSettingsSchema } from '@tale/shared/schemas/automation-settings';
import { taskSubjectContractSchema } from '@tale/shared/schemas/task-contract';
import { z } from 'zod';

import type { Method } from '../engine/api/methods';
import { KNOWLEDGE_QUERY_MAX } from '../knowledge/types';
import { automationPresentationSchema } from '../shared/schemas/automation_presentation';
import { triggerArgSchema } from './trigger-args';

/**
 * Every MCP tool's arguments, as the one zod schema the endpoint checks a
 * call against and generates the advertised JSON Schema from — the schema a
 * client reads in `tools/list` and the check its call meets cannot differ.
 *
 * Every object is strict, so a typo is refused by name instead of silently
 * dropped. A call that misses is refused as one tool error listing every
 * problem (`INVALID_ARGUMENTS`), never as a protocol error and never with
 * only the first problem. The four tools that take an AUTOMATION DOCUMENT
 * (validate, run, test, save) hold the call envelope around it and leave the
 * document an open object: its grammar is a page of rules the engine
 * teaches in band (`get_docs`) and validates itself, and a copy here would
 * be a second source of truth.
 *
 * No root-level `anyOf`/`oneOf`/`allOf`: some clients flatten them and lose
 * the alternatives (a guard in `tools.test.ts` holds it).
 */

const BLANK = 'must not be blank';

/** A string that must carry something: empty and whitespace alone are both
 * refused, where a missing field is — a blank used to reach the engine as
 * a confident "not found" or an empty search. */
function nonBlank() {
  return z.string().min(1, { error: BLANK }).regex(/\S/, { error: BLANK });
}

const automationName = (
  description = 'The automation name — a "/"-separated path, e.g. "billing/dunning-reminder".',
) => nonBlank().describe(description);

const runId = nonBlank().describe(
  'The run handle start_run and list_runs return.',
);

const savedVersion = (
  description = 'A saved version number — list_versions shows them.',
) => z.int({ error: 'must be a whole number' }).min(1).describe(description);

/** The REST `Idempotency-Key` rule, as a tool argument. */
const idempotencyKey = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[\x20-\x7e]*[\x21-\x7e][\x20-\x7e]*$/, {
    error: 'must be printable ASCII and not blank',
  })
  .describe(
    'Names this start so a retry of a timed-out call answers the run it already started (`duplicate: true`) instead of starting another — the same ledger as the REST `Idempotency-Key`: one key, one run, for a day; a repeat with a different input is refused (`IDEMPOTENCY_KEY_REUSED`). Printable ASCII, 1–255 characters.',
  );

/** No type: an automation's own `inputs` schema may take an array or a
 * scalar, and the engine validates the value against it. */
const runInput = z
  .unknown()
  .optional()
  .describe(
    "The run's input — any JSON value the automation's own inputs schema accepts; the engine validates it.",
  );

/** The automation document: an open object the engine validates. */
const automationDocument = z
  .record(z.string(), z.unknown(), {
    error: (issue) =>
      issue.input === undefined
        ? 'is required'
        : 'must be an object — the automation document',
  })
  .describe(
    'The automation document — name, inputs, nodes, output, tests. get_docs is the grammar; the engine validates it and answers with the problems.',
  );

const knowledgeQuery = (description: string) =>
  nonBlank().max(KNOWLEDGE_QUERY_MAX).describe(description);

/** A saved version, or the one that runs. */
const versionOrDeployed = (description: string) =>
  z
    .union([z.int().min(1), z.literal('deployed')], {
      error: 'must be a saved version number (1 or more) or "deployed"',
    })
    .optional()
    .describe(description);

/**
 * One of the version fields a save sends beside the document: an object,
 * `null` to store none, or left out to keep the latest version's. The value
 * is checked against the schema the app READS it with (`reader`), so nothing
 * is stored that a task screen or the automations list later fails to read;
 * every problem is listed under the field's path. The reader's shape is not
 * repeated in the advertised schema — a page of form rules no client needs
 * to see before it sends one.
 */
const versionField = (description: string, reader: z.ZodType) =>
  z
    .record(z.string(), z.unknown(), {
      error: 'must be an object, or null to store none',
    })
    .superRefine((value, ctx) => {
      const checked = reader.safeParse(value);
      if (checked.success) return;
      for (const issue of checked.error.issues) {
        ctx.addIssue({
          code: 'custom',
          path: issue.path,
          message: issue.message,
          params: { code: issue.code },
        });
      }
    })
    .nullable()
    .optional()
    .describe(description);

/** A list of project ids, at most 50. */
const projectIds = (description: string) =>
  z.array(nonBlank()).max(50).optional().describe(description);

const runStatus = z.enum([
  'queued',
  'running',
  'waiting',
  'success',
  'failed',
  'cancelled',
]);

/** The arguments of every engine method — exhaustive over `Method`. */
export const ENGINE_TOOL_ARGS = {
  get_docs: z.strictObject({}),
  get_catalog: z.strictObject({
    kind: z
      .enum(['transform', 'llm', 'agent', 'subautomation', 'connector'])
      .optional()
      .describe('Only node types of this kind.'),
    compact: z
      .boolean()
      .optional()
      .describe(
        'Names and descriptions only — no input schemas. The full catalog is large (over 100 KB); prefer search_catalog or compact for discovery.',
      ),
  }),
  search_catalog: z.strictObject({
    query: nonBlank().describe(
      'Capability keywords — verbs and objects, e.g. "send email".',
    ),
  }),
  validate_automation: z.strictObject({ automation: automationDocument }),
  run_automation: z.strictObject({
    automation: automationDocument,
    input: runInput,
    mode: z
      .enum(['mock', 'live'])
      .optional()
      .describe('mock (default) runs against deterministic mocks.'),
  }),
  test_automation: z
    .strictObject({
      automation: automationDocument
        .optional()
        .describe(
          'A draft to test — the automation document with its tests: block. Leave it out to test a saved version (name).',
        ),
      name: automationName(
        'A saved automation to test instead of a draft; its verdict is recorded on the version.',
      ).optional(),
      version: versionOrDeployed(
        'Which saved version of name to test — the latest when omitted, "deployed" for the live one.',
      ),
    })
    .superRefine((value, ctx) => {
      if ((value.automation === undefined) === (value.name === undefined)) {
        ctx.addIssue({
          code: 'custom',
          path: value.automation === undefined ? ['automation'] : ['name'],
          message:
            value.automation === undefined
              ? 'is required unless name is given'
              : 'cannot be given together with automation',
          params: { code: 'exactly_one_of' },
        });
      }
      if (value.version !== undefined && value.name === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['version'],
          message: 'needs name',
          params: { code: 'requires' },
        });
      }
    }),
  save_automation: z.strictObject({
    automation: automationDocument,
    message: nonBlank()
      .max(500)
      .optional()
      .describe('Why this version — shown in the version history.'),
    baseVersion: savedVersion(
      'The version your edit started from (get_automation answers it). If another version was saved since, the save is refused with the latest version number instead of overwriting it. Always pass it.',
    ).optional(),
    create: z
      .boolean()
      .optional()
      .describe(
        'true: refuse the save when an automation of that name already exists (a new automation, never a new version of someone else’s).',
      ),
    projectId: nonBlank()
      .optional()
      .describe(
        'Install a NEW automation in this project with its first version; you need edit access to it. Ignored for an automation that exists.',
      ),
    settings: versionField(
      'The settings form the task screen shows. Leave it out to keep the latest version’s; null stores none.',
      automationSettingsSchema,
    ),
    taskContract: versionField(
      'The task contract (how tasks start and review this automation). Leave it out to keep the latest version’s; null stores none.',
      taskSubjectContractSchema,
    ),
    presentation: versionField(
      'The display name, description and icon on the automations list. Leave it out to keep the latest version’s; null stores none on this version, and the list keeps showing the newest earlier one.',
      automationPresentationSchema,
    ),
  }),
  get_automation: z.strictObject({
    name: automationName(),
    version: versionOrDeployed(
      'Read this saved version instead of the latest one; "deployed" reads the version that actually runs (list_automations shows deployedVersion).',
    ),
  }),
  list_automations: z.strictObject({}),
  deploy_automation: z.strictObject({
    name: automationName(),
    version: savedVersion(
      'The saved version to promote — list_versions shows them. An older version rolls back.',
    ),
    expectedDeployedVersion: z
      .int({ error: 'must be a whole number, or null' })
      .min(1)
      .nullable()
      .optional()
      .describe(
        'The version you read as live (list_versions answers deployedVersion; null while nothing is deployed). If another one is live now, the deploy is refused and nothing changes.',
      ),
  }),
  delete_automation: z.strictObject({
    name: automationName(),
    expectedLatestVersion: savedVersion(
      'The latest version you read (get_automation answers latestVersion). If a version was saved since, the delete is refused and nothing is removed.',
    ),
  }),
  set_trigger: z.strictObject({
    name: automationName(),
    trigger: triggerArgSchema,
  }),
  run_deployed: z.strictObject({
    name: automationName(),
    input: runInput,
    idempotencyKey: idempotencyKey.optional(),
  }),
  start_run: z.strictObject({
    name: automationName(),
    input: runInput,
    mode: z
      .enum(['live', 'mock'])
      .optional()
      .describe(
        'live (default): the deployed version, with real effects — needs the owner, admin or developer role. mock: any saved version against the deterministic mocks, recorded in the run history; any member may start one. Use mock while testing.',
      ),
    version: savedVersion(
      'The saved version to run. A live run takes only the deployed one (the default); a mock run takes any, the latest saved when omitted.',
    ).optional(),
    projectId: nonBlank()
      .optional()
      .describe(
        'The project the run operates in — its task and document tools act there. The caller must have edit access to this active project. Omit only for an organization-wide automation or when the host already pins a project. A bound automation requires an explicit allowed project.',
      ),
    idempotencyKey: idempotencyKey.optional(),
  }),
  list_runs: z.strictObject({
    name: automationName(
      "Only this automation's runs. Omit for every run the caller can read in the current scope.",
    ).optional(),
    limit: z
      .int({ error: 'must be a whole number' })
      .min(1)
      .max(200)
      .optional()
      .describe('How many runs to return (default 50).'),
    mode: z
      .enum(['live', 'mock'])
      .optional()
      .describe('Only live runs, or only mock runs.'),
    statuses: z
      .array(runStatus)
      .min(1)
      .optional()
      .describe('Only runs in one of these statuses.'),
    cursor: nonBlank()
      .optional()
      .describe(
        'The nextCursor the previous page answered — the next older page. Pass it unchanged, with the same filters.',
      ),
  }),
  get_run: z.strictObject({ runId }),
  cancel_run: z.strictObject({ runId }),
  answer_run_ask: z.strictObject({
    runId,
    askId: nonBlank().describe(
      'The question to answer — get_run answers it while the run waits on one (waitingFor: "ask").',
    ),
    answer: nonBlank()
      .max(20_000)
      .describe(
        'Your answer, in words — the run resumes on it as the person’s answer.',
      ),
  }),
  list_versions: z.strictObject({ name: automationName() }),
  set_automation_projects: z
    .strictObject({
      name: automationName(),
      add: projectIds(
        'Install it in these projects (you need edit access to each).',
      ),
      remove: projectIds(
        'Remove it from these projects (you need edit access to each).',
      ),
    })
    .superRefine((value, ctx) => {
      if ((value.add?.length ?? 0) + (value.remove?.length ?? 0) === 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['add'],
          message: 'name at least one project in add or remove',
          params: { code: 'nothing_to_change' },
        });
      }
    }),
  list_triggers: z.strictObject({
    name: automationName(
      "Only this automation's trigger. Omit for every trigger in the organization.",
    ).optional(),
  }),
  delete_trigger: z.strictObject({ name: automationName() }),
} satisfies Record<Method, z.ZodObject>;

/** The arguments of the platform tools — answered by the platform itself,
 * not the automation engine. */
export const PLATFORM_TOOL_ARGS = {
  get_automation_metrics: z.strictObject({
    periodDays: z
      .union([z.literal(7), z.literal(30), z.literal(90)], {
        error: 'must be 7, 30 or 90',
      })
      .optional()
      .describe(
        'The window, in days (default 7); compared with the window before it.',
      ),
    mode: z
      .enum(['live', 'mock'])
      .optional()
      .describe('Which runs to count: live (the default) or mock.'),
  }),
} satisfies Record<string, z.ZodObject>;

/** The arguments of the organization's capability tools. */
export const CAPABILITY_TOOL_ARGS = {
  search_capabilities: z.strictObject({
    query: knowledgeQuery(
      'What you want to do, in the words a person would use.',
    ),
    limit: z
      .int({ error: 'must be a whole number' })
      .min(1)
      .optional()
      .describe('How many matches to return (default 8).'),
  }),
  invoke_capability: z.strictObject({
    id: nonBlank().describe(
      'The capability id from search_capabilities, e.g. "automation.billing/dunning-reminder".',
    ),
    input: z
      .unknown()
      .optional()
      .describe(
        "Arguments — any JSON value the capability's own input schema accepts; the surface validates them.",
      ),
    credential: nonBlank()
      .optional()
      .describe(
        "Which stored credential to act as. Omit to use the organization's default.",
      ),
    idempotencyKey: idempotencyKey.optional(),
  }),
  get_knowledge: z.strictObject({
    query: knowledgeQuery(
      'What to look for, in the words a person would use (at most 2,000 characters — the REST search’s cap).',
    ),
    limit: z
      .int({ error: 'must be a whole number' })
      .min(1)
      .max(50)
      .optional()
      .describe('How many passages to return (default 10).'),
    corpus: z
      .enum(['private', 'public-web', 'all', 'documents', 'web'])
      .optional()
      .describe(
        "Which knowledge to search: the organization's own documents ('private' — the REST search spells it 'documents'), its crawled web pages ('public-web' — REST: 'web'), or both ('all', the default). Either spelling is taken.",
      ),
  }),
} satisfies Record<string, z.ZodObject>;
