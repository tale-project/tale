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
    name: z.string().optional(),
    version: z.number().optional(),
    latestVersion: z.number().optional(),
    deployedVersion: z.number().nullable().optional(),
    createdVia: z.string().nullable().optional(),
    clientName: z.string().nullable().optional(),
    projectIds: z.array(z.string()).optional(),
  }),
  list_automations: z.looseObject({
    automations: z.array(z.looseObject({ name: z.string() })),
  }),
  list_runs: z.looseObject({
    runs: z.array(runSummary),
    nextCursor: z.string().nullable(),
  }),
  get_run: z.looseObject({
    run: runSummary.extend({
      // The question a run waiting on a person asked: answer_run_ask takes
      // its askId.
      ask: z
        .looseObject({ askId: z.string(), question: z.string() })
        .optional(),
    }),
    // With include: ["record"], the run step by step.
    record: z
      .looseObject({
        format: z.number(),
        nodes: z.array(z.looseObject({ path: z.string(), status: z.string() })),
      })
      .optional(),
  }),
  get_run_node: z.looseObject({
    node: z.looseObject({
      path: z.string(),
      item: z.number(),
      pass: z.number(),
      status: z.string(),
    }),
  }),
  compare_runs: z.looseObject({
    diff: z.looseObject({
      a: z.looseObject({ id: z.string() }),
      b: z.looseObject({ id: z.string() }),
      nodes: z.array(z.looseObject({ path: z.string() })),
    }),
  }),
  list_versions: z.looseObject({
    deployedVersion: z.number().nullable(),
    versions: z.array(z.looseObject({ version: z.number() })),
    deployments: z
      .array(
        z.looseObject({
          version: z.number(),
          previousVersion: z.number().nullable(),
          deployedAt: z.number(),
        }),
      )
      .optional(),
  }),
  list_triggers: z.looseObject({
    triggers: z.array(z.looseObject({ name: z.string(), kind: z.string() })),
  }),
  get_automation_metrics: z.looseObject({
    summary: z.looseObject({ total: z.number(), successRate: z.number() }),
    previousSummary: z.looseObject({ total: z.number() }),
    series: z.array(z.looseObject({ dateKey: z.string() })),
    topAutomations: z.array(z.looseObject({ name: z.string() })),
  }),
  list_models: z.looseObject({
    models: z.array(
      z.looseObject({
        id: z.string(),
        providerSlug: z.string(),
        lane: z.string(),
        nodeTypes: z.array(z.string()),
      }),
    ),
    hint: z.string(),
  }),
  list_harnesses: z.looseObject({
    harnesses: z.array(
      z.looseObject({
        slug: z.string(),
        label: z.string(),
        default: z.boolean(),
      }),
    ),
    hint: z.string(),
  }),
  list_skills: z.looseObject({
    skills: z.array(z.looseObject({ slug: z.string() })),
    hint: z.string(),
  }),
  list_connectors: z.looseObject({
    connectors: z.array(
      z.looseObject({ slug: z.string(), connected: z.boolean() }),
    ),
    hint: z.string(),
  }),
  list_agent_secrets: z.looseObject({
    secrets: z.array(z.looseObject({ name: z.string() })),
    hint: z.string(),
  }),
  list_projects: z.looseObject({
    projects: z.array(
      z.looseObject({
        id: z.string(),
        name: z.string(),
        archived: z.boolean(),
        writable: z.boolean(),
      }),
    ),
    hint: z.string(),
  }),
  list_events: z.looseObject({
    events: z.array(
      z.looseObject({ name: z.string(), description: z.string() }),
    ),
    hint: z.string(),
  }),
  get_settings: z.looseObject({
    kinds: z
      .array(
        z.looseObject({
          kind: z.string(),
          available: z.boolean(),
          read: z.boolean(),
          write: z.boolean(),
        }),
      )
      .optional(),
    resources: z.array(
      z.looseObject({
        kind: z.string(),
        key: z.string(),
        id: z.string().nullable(),
        hash: z.string(),
      }),
    ),
    refused: z.array(
      z.looseObject({ kind: z.string(), code: z.string(), error: z.string() }),
    ),
    nextCursor: z.string().nullable(),
    hint: z.string(),
  }),
  plan_settings: z.looseObject({
    ok: z.boolean(),
    changes: z.array(
      z.looseObject({
        kind: z.string(),
        key: z.string(),
        op: z.string(),
        diff: z.array(z.looseObject({ path: z.string() })),
        effects: z.array(z.string()),
        risk: z.string(),
      }),
    ),
  }),
  search_capabilities: z.looseObject({
    capabilities: z.array(z.looseObject({ id: z.string() })),
  }),
  get_knowledge: z.looseObject({
    status: z.literal('ok'),
    passages: z.array(z.looseObject({})),
  }),
} satisfies Record<string, z.ZodObject>;
