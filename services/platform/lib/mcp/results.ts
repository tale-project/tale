import { z } from 'zod';

/**
 * What every read tool answers, as the zod schema `tools/list` advertises as
 * its `outputSchema` and the answer carries as `structuredContent`.
 *
 * A client that knows the schema validates every answer against it and
 * refuses the call when one does not match (the MCP SDKs do), so these hold
 * only what every answer of the tool carries: the keys a reader needs to
 * find its way, typed, and every object open to the fields the answers
 * also carry or will carry. A refusal is not an answer: it is flagged
 * `isError` and carries no structured content, so it is never held to the
 * schema.
 */

/** One validation issue: the stable code and the sentence; its location,
 * params and related nodes ride along. */
const issue = z.looseObject({ code: z.string(), message: z.string() });

/** One run as the run tools list it. */
const runSummary = z.looseObject({
  runId: z.string(),
  status: z.string(),
});

export const READ_TOOL_RESULTS = {
  get_docs: z.looseObject({ docs: z.string() }),
  get_catalog: z.looseObject({
    node_types: z.array(z.looseObject({ type: z.string(), kind: z.string() })),
    hint: z.string().optional(),
  }),
  search_catalog: z.looseObject({
    matches: z.array(z.looseObject({ type: z.string() })),
    hint: z.string().optional(),
  }),
  validate_automation: z.looseObject({
    valid: z.boolean(),
    errors: z.array(issue),
    warnings: z.array(issue),
    analysis: z.looseObject({}).optional(),
    types: z.looseObject({}).optional(),
  }),
  get_automation: z.looseObject({
    meta: z.looseObject({ version: z.number() }),
    automation: z.looseObject({}),
  }),
  list_automations: z.looseObject({
    automations: z.array(z.looseObject({ name: z.string() })),
  }),
  list_runs: z.looseObject({ runs: z.array(runSummary) }),
  get_run: z.looseObject({ run: runSummary }),
  list_versions: z.looseObject({
    deployedVersion: z.number().nullable(),
    versions: z.array(z.looseObject({ version: z.number() })),
  }),
  list_triggers: z.looseObject({
    triggers: z.array(z.looseObject({ name: z.string(), kind: z.string() })),
  }),
  search_capabilities: z.looseObject({
    capabilities: z.array(z.looseObject({ id: z.string() })),
  }),
  get_knowledge: z.looseObject({
    status: z.literal('ok'),
    passages: z.array(z.looseObject({})),
  }),
} satisfies Record<string, z.ZodObject>;
