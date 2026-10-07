/**
 * Every workspace tool a user may GRANT to an agent — the project-agent
 * dialog's Tools group and the automation agent node's `tools` field — on top
 * of the always-on baseline (knowledge retrieval, plus asking
 * a human on the automation lane). The catalog is the single
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
  { name: 'task_delegate_review', effect: 'write', module: 'tasks' },
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
  'task_delegate_review',
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
