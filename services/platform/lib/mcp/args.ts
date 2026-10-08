import { z } from 'zod';

import type { Method } from '../engine/api/methods';
import { KNOWLEDGE_QUERY_MAX } from '../knowledge/types';
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
  test_automation: z.strictObject({ automation: automationDocument }),
  save_automation: z.strictObject({
    automation: automationDocument,
    message: nonBlank()
      .optional()
      .describe('Why this version — shown in the version history.'),
  }),
  get_automation: z.strictObject({
    name: automationName(),
    version: z
      .union([z.int().min(1), z.literal('deployed')], {
        error: 'must be a saved version number (1 or more) or "deployed"',
      })
      .optional()
      .describe(
        'Read this saved version instead of the latest one; "deployed" reads the version that actually runs (list_automations shows deployedVersion).',
      ),
  }),
  list_automations: z.strictObject({}),
  deploy_automation: z.strictObject({
    name: automationName(),
    version: savedVersion(
      'The saved version to promote — list_versions shows them.',
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
    version: savedVersion(
      'Run this exact version instead of the deployed one. Rarely needed.',
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
  }),
  get_run: z.strictObject({ runId }),
  cancel_run: z.strictObject({ runId }),
  list_versions: z.strictObject({ name: automationName() }),
  list_triggers: z.strictObject({
    name: automationName(
      "Only this automation's trigger. Omit for every trigger in the organization.",
    ).optional(),
  }),
  delete_trigger: z.strictObject({ name: automationName() }),
} satisfies Record<Method, z.ZodObject>;

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
