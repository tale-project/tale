import { REPLAY_KINDS } from '@tale/shared/automation-replay';
import { checkReplayRequest } from '@tale/shared/schemas/automation-replay';
import { automationSettingsSchema } from '@tale/shared/schemas/automation-settings';
import { expectedConfigurationHashSchema } from '@tale/shared/schemas/configuration';
import {
  SETTINGS_KINDS,
  settingsKindDescriptor,
} from '@tale/shared/schemas/settings-kinds';
import { taskSubjectContractSchema } from '@tale/shared/schemas/task-contract';
import { z } from 'zod';

import type { Method } from '../engine/api/methods';
import { RUN_STATUSES } from '../engine/api/run-statuses';
import { KNOWLEDGE_QUERY_MAX } from '../knowledge/types';
import { automationPresentationSchema } from '../shared/schemas/automation_presentation';
import { MCP_DOC_TOPICS } from './docs/topics';
import { CATALOG_KINDS } from './resources';
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
      const checked = reader.safeParse(value, { reportInput: true });
      if (checked.success) return;
      for (const issue of checked.error.issues) {
        // Re-raised as the reader's own kind of problem WITHOUT its
        // sentence, so the call's parse phrases it in the house words like
        // every other argument's (and splits unknown keys one per issue);
        // a rule the reader states itself keeps its own sentence.
        if (issue.code === 'custom') {
          ctx.addIssue({ ...issue });
          continue;
        }
        // Pushed as is, not through `addIssue`, which would fill a missing
        // field's absent `input` with the whole object and turn "is
        // required" into "must be …".
        const { message: _sentence, ...problem } = issue;
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a finalized issue without its sentence is a raw issue; `input` stays as the reader reported it
        ctx.issues.push(problem as z.core.$ZodRawIssue);
      }
    })
    .nullable()
    .optional()
    .describe(description);

/** A problem a cross-field rule finds: where, its stable code, and why. */
interface CrossFieldIssue {
  readonly path: readonly string[];
  readonly code: string;
  readonly message: string;
}

/**
 * A rule over several arguments at once, run whatever else the parse found
 * wrong — zod skips a refinement once a field has failed, and the agent
 * would learn of this problem only on its next call. It reads the arguments
 * as sent (any field may still be malformed), and runs whenever they are an
 * object.
 */
function crossField(
  rule: (args: Readonly<Record<string, unknown>>) => CrossFieldIssue[],
): z.core.$ZodCheck<unknown> {
  const check = z.superRefine((value: unknown, ctx) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value))
      return;
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a plain object, checked above
    for (const issue of rule(value as Record<string, unknown>)) {
      ctx.addIssue({
        code: 'custom',
        path: [...issue.path],
        message: issue.message,
        params: { code: issue.code },
      });
    }
  });
  check._zod.def.when = (payload) =>
    typeof payload.value === 'object' &&
    payload.value !== null &&
    !Array.isArray(payload.value);
  return check;
}

/** A list of project ids, at most 50. */
const projectIds = (description: string) =>
  z.array(nonBlank()).max(50).optional().describe(description);

const runStatus = z.enum(RUN_STATUSES);

/** The arguments of every engine method — exhaustive over `Method`. */
export const ENGINE_TOOL_ARGS = {
  get_docs: z.strictObject({
    topic: z
      .enum(MCP_DOC_TOPICS)
      .optional()
      .describe(
        'Which reference: "authoring" (the default — the automation grammar and every method), "triggers" (what starts an automation, each kind\'s fields and the events), "validation" (how to read a validation result, and every issue code), "settings" (every kind of setting with its fields, the effects of a plan and every refusal) or "skill" (the Tale skill, SKILL.md). Each is also the resource tale://docs/<topic>.',
      ),
  }),
  get_catalog: z.strictObject({
    kind: z
      .enum(CATALOG_KINDS)
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
  validate_automation: z.strictObject({
    automation: automationDocument,
    detail: z
      .array(z.enum(['analysis', 'types']))
      .max(2)
      .optional()
      .describe(
        'What to answer beside the errors and warnings: "analysis" (which nodes run on which ways a run can go) and "types" (the shape of every value). Left out, both; [] answers the issues alone — the types of a large document run to tens of KB.',
      ),
  }),
  run_automation: z.strictObject({
    automation: automationDocument,
    input: runInput,
    mode: z
      .enum(['mock'])
      .optional()
      .describe(
        'Always "mock" here: the document runs against deterministic mocks, and nothing leaves Tale. To run it for real, save and deploy it, then run_deployed or start_run.',
      ),
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
    .check(
      crossField((args) => [
        ...((args.automation === undefined) === (args.name === undefined)
          ? [
              args.automation === undefined
                ? {
                    path: ['automation'],
                    code: 'exactly_one_of',
                    message: 'is required unless name is given',
                  }
                : {
                    path: ['name'],
                    code: 'exactly_one_of',
                    message: 'cannot be given together with automation',
                  },
            ]
          : []),
        ...(args.version !== undefined && args.name === undefined
          ? [{ path: ['version'], code: 'requires', message: 'needs name' }]
          : []),
      ]),
    ),
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
  get_run: z.strictObject({
    runId,
    detail: z
      .array(z.enum(['input', 'output', 'trace', 'effects']))
      .max(4)
      .optional()
      .describe(
        'What to answer beside the status: "input", "output", "trace", "effects". Left out, all of them; [] the status alone (and the question a waiting run asks) — poll a run with [], then read it whole once it finished.',
      ),
    include: z
      .array(z.enum(['record', 'travels']))
      .max(2)
      .optional()
      .describe(
        'What to add: "record" answers the run step by step under record — each step\'s status, why it ran or was skipped (each condition explained with the values it read), why it failed (failure.reason and its explanation), glimpses of its values; "travels" adds the data that travelled between steps.',
      ),
  }),
  get_run_node: z.strictObject({
    runId,
    node: nonBlank()
      .max(512)
      .describe(
        "The step's path, as record.nodes lists it: its id, or parent[item:pass]/id inside a subautomation; __start and __end for the run input and output.",
      ),
    item: z
      .number()
      .int()
      .min(-1)
      .optional()
      .describe(
        'The item of a step that runs per item; left out (-1) for the step itself.',
      ),
    pass: z
      .number()
      .int()
      .min(-1)
      .optional()
      .describe(
        'The pass of a step that repeats; left out (-1) for the step itself.',
      ),
  }),
  compare_runs: z.strictObject({
    a: nonBlank().describe('The earlier run: its runId.'),
    b: nonBlank().describe(
      'The later run of the same automation: steps are compared in the order its version runs them.',
    ),
  }),
  replay_run: z
    .strictObject({
      runId,
      kind: z
        .enum(REPLAY_KINDS)
        .describe(
          '"again" runs it with its own input, "edited" with input, "from" again from one step: the steps it finished outside that step and what it feeds are reused, the rest run anew.',
        ),
      from: nonBlank()
        .max(200)
        .optional()
        .describe(
          'kind "from": the step to run again from, as get_run {include: ["record"]} lists it.',
        ),
      version: z
        .union([
          z.enum(['same', 'deployed', 'latest']),
          z.number().int().min(1).max(1_000_000),
        ])
        .optional()
        .describe(
          'The version to run: the one the run ran ("same", the default), the deployed one, the latest saved one, or a version number. A live run needs the deployed version.',
        ),
      mode: z
        .enum(['mock', 'live'])
        .optional()
        .describe(
          'The run’s own mode by default. A fork of a mock run stays mock: its results were made up.',
        ),
      input: z
        .unknown()
        .optional()
        .describe('kind "edited": the input to run with.'),
      dryRun: z
        .boolean()
        .optional()
        .describe(
          'true: answer the plan — what it reuses, runs again and sends out a second time — and start nothing.',
        ),
      idempotencyKey: idempotencyKey.optional(),
    })
    .superRefine(checkReplayRequest),
  cancel_run: z.strictObject({ runId }),
  answer_run_ask: z.strictObject({
    runId,
    askId: nonBlank().describe(
      'The question to answer — get_run answers it as run.ask.askId while the run waits on one (waitingFor: "ask").',
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
    .check(
      crossField((args) => {
        // A list that is not one has its own issue; it still names something.
        const named = (list: unknown): number =>
          list === undefined ? 0 : Array.isArray(list) ? list.length : 1;
        return named(args.add) + named(args.remove) === 0
          ? [
              {
                path: ['add'],
                code: 'nothing_to_change',
                message: 'name at least one project in add or remove',
              },
            ]
          : [];
      }),
    ),
  list_triggers: z.strictObject({
    name: automationName(
      "Only this automation's trigger. Omit for every trigger in the organization.",
    ).optional(),
  }),
  delete_trigger: z.strictObject({ name: automationName() }),
} satisfies Record<Method, z.ZodObject>;

/** A filter over a listing's names and descriptions. */
const listingQuery = (description: string) =>
  nonBlank().max(200).optional().describe(description);

/** A settings kind, as the shared descriptors name them. */
const settingsKind = z
  .enum(SETTINGS_KINDS.map((descriptor) => descriptor.kind))
  .describe('The kind of setting; get_settings without kinds lists them.');

/** A resource's id within its kind. */
const settingsId = nonBlank().max(600);

/**
 * One settings change. Which operations and actions a kind takes is the
 * kind's own (`settings-kinds.ts`), so a call that names one it does not
 * take is refused with the others, before anything is read.
 */
const settingsChange = z
  .strictObject({
    kind: settingsKind,
    id: settingsId
      .optional()
      .describe(
        "The resource's id within its kind, as get_settings answers it. Left out for a kind with one resource.",
      ),
    op: z
      .enum(['set', 'delete', 'act'])
      .describe(
        "set: replace the resource with config, creating it when absent; delete: remove it; act: run one of the kind's actions on it.",
      ),
    config: z
      .unknown()
      .optional()
      .describe(
        'With set: the whole config the resource should hold, as get_settings answers it. A secret stays the masked value it read, which keeps what is stored.',
      ),
    act: nonBlank()
      .max(64)
      .optional()
      .describe("With act: the action, one of the kind's acts."),
    args: z.unknown().optional().describe('With act: what the action takes.'),
  })
  .superRefine((change, ctx) => {
    const { acts, ops } = settingsKindDescriptor(change.kind);
    const issue = (path: string, code: string, message: string) =>
      ctx.addIssue({ code: 'custom', path: [path], message, params: { code } });
    if (change.op === 'act') {
      if (acts.length === 0) {
        issue(
          'op',
          'op_not_supported',
          `${change.kind} takes ${ops.join(' or ')}`,
        );
      } else if (change.act === undefined) {
        issue('act', 'required', 'is required with op "act"');
      } else if (!acts.includes(change.act)) {
        issue(
          'act',
          'act_unknown',
          `is not an action of ${change.kind}: ${acts.join(', ')}`,
        );
      }
    } else {
      if (!ops.includes(change.op)) {
        issue(
          'op',
          'op_not_supported',
          `${change.kind} takes ${[...ops, ...(acts.length > 0 ? ['act'] : [])].join(' or ')}`,
        );
      }
      if (change.act !== undefined) {
        issue('act', 'not_allowed', 'is taken only with op "act"');
      }
      if (change.args !== undefined) {
        issue('args', 'not_allowed', 'is taken only with op "act"');
      }
    }
    if (change.op === 'set' && change.config === undefined) {
      issue(
        'config',
        'required',
        'is required with op "set": the whole config the resource should hold',
      );
    }
    if (change.op !== 'set' && change.config !== undefined) {
      issue('config', 'not_allowed', 'is taken only with op "set"');
    }
  });

/** The changes of one plan or apply. */
const settingsChanges = (description: string) =>
  z.array(settingsChange).min(1).max(32).describe(description);

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
  list_models: z.strictObject({
    nodeType: z
      .enum(['llm', 'agent'])
      .optional()
      .describe(
        'Only the models a step of this type can use: an llm step takes a model a provider serves directly, an agent step a model offered to its runtime.',
      ),
    harness: nonBlank()
      .max(64)
      .optional()
      .describe(
        'Only the models offered to this agent runtime — the harness slug list_harnesses names.',
      ),
  }),
  list_harnesses: z.strictObject({}),
  list_skills: z.strictObject({
    projectId: nonBlank()
      .optional()
      .describe(
        "Also the team skills of this project — the ones a run in it can use. You need read access to it; list_projects shows the ids. Left out, the organization's own skills.",
      ),
  }),
  list_connectors: z.strictObject({
    query: listingQuery(
      'Only connectors whose slug, name or description contains this text.',
    ),
  }),
  list_agent_secrets: z.strictObject({}),
  list_projects: z.strictObject({
    query: listingQuery('Only projects whose name contains this text.'),
    includeArchived: z
      .boolean()
      .optional()
      .describe('Also archived projects (default false).'),
  }),
  list_events: z.strictObject({}),
  get_settings: z
    .strictObject({
      kinds: z
        .array(settingsKind)
        .min(1)
        .max(SETTINGS_KINDS.length)
        .optional()
        .describe(
          'The kinds to read. Left out, the catalog: every kind, what it is and what your role may do with it.',
        ),
      ids: z
        .array(settingsId)
        .min(1)
        .max(100)
        .optional()
        .describe('Only these resources, by id; with exactly one kind.'),
      cursor: nonBlank()
        .max(1000)
        .optional()
        .describe(
          'The nextCursor a read of one kind answered, for its next page.',
        ),
    })
    .superRefine((args, ctx) => {
      if (
        (args.ids !== undefined || args.cursor !== undefined) &&
        args.kinds?.length !== 1
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['kinds'],
          message: 'must name exactly one kind when ids or cursor is given',
          params: { code: 'one_kind' },
        });
      }
    }),
  plan_settings: z.strictObject({
    changes: settingsChanges(
      'The changes to plan, at most 32: each names its kind, its resource (id) and its operation; set sends the whole config the resource should hold.',
    ),
  }),
  apply_settings: z.strictObject({
    changes: settingsChanges(
      'The changes to make, at most 32 — the ones you planned and showed the person.',
    ),
    expected: z
      .record(nonBlank().max(700), expectedConfigurationHashSchema)
      .describe(
        'The hash each changed resource had when you read it, by its key (kind/id, or the kind alone for a kind with one resource); null for one you create. If any resource changed since, nothing is applied.',
      ),
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
