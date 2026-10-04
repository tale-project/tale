/**
 * Workspace-tool names shared across runtimes. The dispatch bridge that
 * implements them is `'use node'`; the HTTP face that gates them is not — a
 * name both sides compare against therefore lives here, importable from
 * either.
 */

import { SANDBOX_TURN_MAX_GENERATED_IMAGES } from './session_constants';

/**
 * The ask-a-human tool of an automation agent turn: registers a question for
 * the run's operator, then the agent ends its turn and is resumed with the
 * answer. Granted ONLY on the workflow-agent lane — a chat turn's user is
 * already present, so asking "a human" there is just asking the chat.
 */
export const ASK_HUMAN_TOOL = 'ask_human';

/**
 * The baseline knowledge-retrieval pair every managed agent run is granted —
 * task-agent turns and automation agent turns alike: semantic search over the
 * organization's knowledge plus the windowed fetch of one source a hit named.
 * Read-only, and the grant alone never widens visibility: the dispatch
 * derives what a call may read from the SESSION's binding (a project-bound
 * run reads its project + the org hub; an org-level automation run reads the
 * hub only), so a run sees exactly what its deployment surface owns.
 */
export const KNOWLEDGE_READ_TOOLS = ['rag_search', 'rag_fetch'] as const;

/** The instructions line that makes the knowledge pair discoverable — the
 * shim only advertises generic `workspace_tool`, so the turn is told the
 * names (the same reason the ask_human guidance exists). Shared by every
 * lane that grants {@link KNOWLEDGE_READ_TOOLS}. */
export const KNOWLEDGE_TOOLS_GUIDANCE =
  "The organization's knowledge base is available through the " +
  '"workspace_tool" MCP tool: rag_search {query} finds the most relevant ' +
  "passages, rag_fetch {ref} reads one hit's full source (a document file " +
  'id or a crawled page URL). Use them when you need organization facts ' +
  'that are not in your staged files; call workspace_status to see ' +
  'everything granted.';

/**
 * The image-generation tool. Granted to a managed agent turn — a project
 * agent's task run or an automation's agent step — only while the
 * organization's `image_generation` policy is on AND a model resolves for
 * it; never to chat, and never user-grantable (it is in no
 * {@link AGENT_TOOL_CATALOG}: the organization's policy is the switch). The
 * dispatch lives in `node_only/sandbox/workspace_image_tool.ts`.
 */
export const IMAGE_GENERATION_TOOL = 'generate_image';

/**
 * The instructions line that makes {@link IMAGE_GENERATION_TOOL}
 * discoverable — on a turn granted it, and only there, so no turn is told
 * about a tool it cannot call. `outputDir` is the turn's own delivery box,
 * where saved images are collected as the turn's output.
 */
export function imageGenerationGuidance(outputDir: string): string {
  return (
    'You can create images: call the "workspace_tool" MCP tool with ' +
    `{tool: "${IMAGE_GENERATION_TOOL}", args: {prompt, path?, size?, ` +
    'count?, inputImages?}}. The platform generates them with the ' +
    "organization's image model and saves them into " +
    `${outputDir}/ — name a file there (no subfolders: only the box's top ` +
    'level is delivered) or a path under /agent/workspace/ — answering ' +
    'with the saved paths; call workspace_status for the argument details. ' +
    'Every image is billed to the organization and counts against this ' +
    `turn's spend allowance, at most ${SANDBOX_TURN_MAX_GENERATED_IMAGES} ` +
    'images a turn — create what the task needs, not variations for their ' +
    'own sake.'
  );
}

/**
 * The op a turn's session token serves: the exec whose run a platform-side
 * generation is booked under, and whose delivery box receives its files.
 * Written into the token scope as `turnOp` on a turn granted
 * {@link IMAGE_GENERATION_TOOL} and read by that tool's dispatch alone. It
 * names no person: the dispatch reads the person from the run on every call,
 * so a token that outlives its run generates nothing.
 */
export interface TurnOpRef {
  kind: 'task-agent' | 'workflow-agent';
  execId: string;
}

/** A token scope's `turnOp`, or `undefined` when it carries none (a token
 * minted before the field existed, or a turn not granted the tool). */
export function readTurnOpRef(value: unknown): TurnOpRef | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const record = value as { kind?: unknown; execId?: unknown };
  if (
    (record.kind === 'task-agent' || record.kind === 'workflow-agent') &&
    typeof record.execId === 'string' &&
    record.execId !== ''
  ) {
    return { kind: record.kind, execId: record.execId };
  }
  return undefined;
}

/**
 * Knowledge refs kept per recorded tool call (`sandboxToolCalls.knowledgeRefs`
 * — the read-set the provenance ledger folds into a run's settle entry).
 * Order-preserving truncation: the first N distinct refs of a result are the
 * ones a model most plausibly used, and an unbounded list would let one broad
 * search bloat the audit row. Shared here because the `'use node'` dispatch
 * truncates and the V8 ledger writer enforces the same bound.
 */
export const KNOWLEDGE_REFS_PER_CALL_CAP = 20;

/**
 * Every workspace tool a user may GRANT to an agent — the project-agent
 * dialog's Tools group and the automation agent node's `tools` field — on top
 * of the always-on baseline ({@link KNOWLEDGE_READ_TOOLS}, plus
 * {@link ASK_HUMAN_TOOL} on the automation lane). The catalog is the single
 * source the config mutations validate against and the pickers render from;
 * the dispatch handlers live in `node_only/sandbox/workspace_tools_bridge.ts`.
 *
 * `effect` is the honest badge: a `write` tool changes real org data, and the
 * grant itself IS the standing authorization — the async work lanes have no
 * per-call approval card, so a write grant must be a deliberate, explicit act.
 * Write tools are therefore never part of any lane's baseline.
 *
 * `module` groups the tools by the org domain they touch, so the equipment
 * picker can categorize them instead of showing one flat list. Ordered so a
 * module's reads precede its writes.
 */
export const AGENT_TOOL_CATALOG = [
  { name: 'task_find', effect: 'read', module: 'tasks' },
  { name: 'task_get', effect: 'read', module: 'tasks' },
  { name: 'task_create', effect: 'write', module: 'tasks' },
  { name: 'task_comment', effect: 'write', module: 'tasks' },
  { name: 'task_update_status', effect: 'write', module: 'tasks' },
  { name: 'task_update_metadata', effect: 'write', module: 'tasks' },
  { name: 'task_review', effect: 'write', module: 'tasks' },
  { name: 'task_start_agent', effect: 'write', module: 'tasks' },
  { name: 'task_upsert_by_external_ref', effect: 'write', module: 'tasks' },
  { name: 'document_find', effect: 'read', module: 'documents' },
  { name: 'document_create', effect: 'write', module: 'documents' },
  { name: 'knowledge_entry_find', effect: 'read', module: 'knowledge' },
  { name: 'contact_find', effect: 'read', module: 'contacts' },
  { name: 'product_find', effect: 'read', module: 'products' },
  { name: 'website_find', effect: 'read', module: 'websites' },
] as const;

/**
 * Grantable tools only a PROJECT AGENT's run can use: `task_start_agent`
 * puts another agent of the project to work on behalf of whoever the run
 * answers to (`domains/tasks/delegated-start.ts`). An automation starts
 * agents with its `task.start_agent` step instead. `task_update_metadata`
 * triages existing tasks without starting work; `task_review` decides an
 * independent native task review. The automation agent node
 * neither offers nor grants these project-only tools.
 */
export const PROJECT_AGENT_ONLY_TOOLS: readonly string[] = [
  'task_start_agent',
  'task_update_metadata',
  'task_review',
];

/** The grantable tools that change org data (status listings badge these). */
export const WRITE_EFFECT_TOOLS: readonly string[] = AGENT_TOOL_CATALOG.filter(
  (tool) => tool.effect === 'write',
).map((tool) => tool.name);

/**
 * Canonicalize a configured grant list: unknown names dropped, duplicates
 * folded, catalog order restored — so equipment rows and minted token scopes
 * carry one canonical spelling of the same grant set. The `automation` lane
 * also drops {@link PROJECT_AGENT_ONLY_TOOLS}.
 */
export function normalizeToolGrants(
  raw: readonly string[],
  lane: 'project_agent' | 'automation' = 'project_agent',
): string[] {
  const requested = new Set(raw);
  return AGENT_TOOL_CATALOG.filter(
    (tool) =>
      requested.has(tool.name) &&
      (lane === 'project_agent' ||
        !PROJECT_AGENT_ONLY_TOOLS.includes(tool.name)),
  ).map((tool) => tool.name);
}

/**
 * The instructions line that makes injected SECRETS discoverable: a model has
 * no way to know which environment variables carry credentials or what
 * they're for, so the turn is told the names (never the values). Returns an
 * empty array (spread-friendly) when the agent references no secrets.
 */
export function secretsGuidance(secretNames: readonly string[]): string[] {
  if (secretNames.length === 0) return [];
  return [
    'Credentials for this run are provided as environment variables you can ' +
      'read from your shell: ' +
      secretNames.join(', ') +
      '. Use them to authenticate directly against the matching service ' +
      "(read the vendor's own API docs); never print a secret's value, and " +
      'never write one into a file, a task, or a document.',
  ];
}

/**
 * The instructions line of a run a MEMBER started — someone who may work
 * their own tasks but not edit the project (`tasks/run-authority.ts`). It
 * takes the place of {@link secretsGuidance}: the run is told what it may
 * change, and which of the agent's credentials were held back and why, so
 * it can say what it could not reach instead of failing on a missing
 * variable. `withheld` names the credentials (secret names, the GitHub
 * token) the agent is equipped with.
 */
export function memberRunGuidance(withheld: readonly string[]): string {
  return (
    'This run was started by a member who can work only their own task. ' +
    'Your task tools change only this task and the subtasks under it, and ' +
    'you cannot sync external items into the project or save documents ' +
    "there — deliver files through this task's delivery box." +
    (withheld.length > 0
      ? " The agent's credentials (" +
        withheld.join(', ') +
        ') are not available in a run a member starts. If the work needs ' +
        'them, say so in your result: an editor has to start the agent ' +
        'for that.'
      : '')
  );
}

/**
 * The instructions line that makes CONFIGURED tool grants discoverable —
 * same reason {@link KNOWLEDGE_TOOLS_GUIDANCE} exists: the shim only
 * advertises generic `workspace_tool`, so the turn is told the names.
 * `undefined` when nothing beyond the baseline is granted.
 */
export function grantedToolsGuidance(
  tools: readonly string[],
): string | undefined {
  if (tools.length === 0) return undefined;
  const writes = new Set(WRITE_EFFECT_TOOLS);
  const hasWrite = tools.some((tool) => writes.has(tool));
  return (
    'This agent is additionally granted these workspace tools (call them ' +
    'through the "workspace_tool" MCP tool as {tool, args}): ' +
    tools.join(', ') +
    '. Call workspace_status once for their argument shapes before first ' +
    'use.' +
    (hasWrite
      ? ' The write tools change real organization data (tasks, documents) ' +
        'with no further approval — act deliberately and prefer the ' +
        'idempotent forms (task_upsert_by_external_ref) for anything that ' +
        'may re-run.'
      : '')
  );
}
