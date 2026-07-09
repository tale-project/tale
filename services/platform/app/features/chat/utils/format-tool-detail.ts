import type { TFunction } from 'i18next';

/**
 * Humanizes a tool call into a short, user-facing status line
 * (e.g. "Reading example.com", "Searching the knowledge base for …",
 * "Asking the Research agent"). Shared by the live thinking indicator and the
 * persistent thought-process timeline so both speak with one voice.
 *
 * Pure: takes the `chat`-namespace translator so it can run inside components,
 * memos, or tests without its own i18n context.
 */

export interface ToolDetail {
  toolName: string;
  displayText: string;
}

/**
 * Title-cases a `-`/`_`-separated slug (e.g. `research_agent` → "Research
 * Agent", `tavily` → "Tavily"), dropping empty segments from leading/trailing
 * or doubled separators. Used for slugs that aren't in the explicit
 * display-name map (MCP tool/server segments, delegate-target agent slugs).
 */
function humanizeSeparatedSlug(slug: string): string {
  return slug
    .split(/[-_]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * One-line summary of an external-agent (Claude Code / OpenCode) tool call,
 * surfacing the load-bearing argument so the timeline reads "Bash · gh pr diff"
 * instead of a bare "Bash". Returns null for tools handled by the platform
 * formatter below. Pure string work — no i18n (the content is the arg itself).
 */
function externalAgentToolSummary(
  toolName: string,
  input?: Record<string, unknown>,
): string | null {
  const str = (v: unknown) => (typeof v === 'string' ? v : undefined);

  // MCP tool calls arrive as `mcp__<server>__<tool>`. Render a clean label
  // without leaking the `mcp__` protocol prefix or repeating the server
  // segment, and surface the integration slug for the generic integration
  // dispatcher so the row reads "Integration · Tavily" instead of the doubled
  // "Mcp Integrations Integration". Handled before the `!input` guard so
  // argument-less calls (e.g. integration_status) still get a clean label.
  if (toolName.startsWith('mcp__')) {
    const segments = toolName.slice('mcp__'.length).split('__').filter(Boolean);
    const toolSeg = segments[segments.length - 1] ?? toolName;
    if (toolSeg === 'integration') {
      const slug = str(input?.slug);
      return slug
        ? `Integration · ${humanizeSeparatedSlug(slug)}`
        : 'Integration';
    }
    if (toolSeg === 'integration_status') return 'Integration status';
    return humanizeSeparatedSlug(toolSeg) || toolName;
  }

  if (!input) return null;
  switch (toolName) {
    case 'Bash': {
      const cmd = str(input.command);
      return cmd ? `Bash · ${truncate(cmd, 80)}` : null;
    }
    case 'ExitPlanMode':
      // Plan/act workflow: the call carries the full plan in input.plan; the
      // row reads as the proposal event (the plan itself renders in the
      // approval card + the expanded row body).
      return 'Proposed a plan';
    case 'EnterPlanMode':
      return 'Entered plan mode';
    case 'Read':
    case 'Edit':
    case 'Write':
    case 'NotebookEdit': {
      const path = str(input.file_path) ?? str(input.notebook_path);
      return path ? `${toolName} · ${truncate(path, 70)}` : null;
    }
    case 'Grep': {
      const pat = str(input.pattern);
      return pat ? `Grep · ${truncate(pat, 60)}` : null;
    }
    case 'Glob': {
      const pat = str(input.pattern);
      return pat ? `Glob · ${truncate(pat, 60)}` : null;
    }
    case 'WebFetch': {
      const url = str(input.url);
      return url ? `WebFetch · ${extractHostname(url)}` : null;
    }
    case 'Task':
    case 'Agent': {
      const desc = str(input.description);
      return desc ? `${toolName} · ${truncate(desc, 60)}` : null;
    }
    default:
      return null;
  }
}

export function extractHostname(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 1) + '…';
}

/**
 * Maps a platform tool name (snake_case, as registered in
 * `convex/agent_tools/tool_names.ts`) to its `chat`-namespace label key. The
 * single source of truth for human-facing tool names, shared by the chat
 * thinking timeline (`formatToolDetail`) and the agent tool picker
 * (`ToolSelector`). A few entries (`pptx`, `validate_workflow_definition`) are
 * runtime-only tool names that never appear in the picker but do surface in
 * chat — kept here so both speak with one voice.
 */
const TOOL_LABEL_KEYS: Record<string, string> = {
  file_read: 'tools.fileRead',
  file_write: 'tools.fileWrite',
  file_edit: 'tools.fileEdit',
  file_list: 'tools.fileList',
  file_delete: 'tools.fileDelete',
  run_code: 'tools.runCode',
  contact_read: 'tools.contactRead',
  contact_write: 'tools.contactWrite',
  product_read: 'tools.productRead',
  product_write: 'tools.productWrite',
  website_read: 'tools.websiteRead',
  website_write: 'tools.websiteWrite',
  rag_search: 'tools.ragSearch',
  knowledge_write: 'tools.knowledgeWrite',
  document_find: 'tools.documentFind',
  document_retrieve: 'tools.documentRetrieve',
  document_write: 'tools.documentWrite',
  web: 'tools.web',
  pdf: 'tools.pdf',
  image: 'tools.image',
  generate_image: 'tools.generateImage',
  docx: 'tools.docx',
  text: 'tools.text',
  excel: 'tools.excel',
  pptx: 'tools.pptx',
  workflow_read: 'tools.workflowRead',
  workflow_syntax: 'tools.workflowSyntax',
  update_workflow_step: 'tools.updateWorkflowStep',
  save_workflow_definition: 'tools.saveWorkflowDefinition',
  validate_workflow_definition: 'tools.validateWorkflowDefinition',
  create_workflow: 'tools.createWorkflow',
  run_workflow: 'tools.runWorkflow',
  integration: 'tools.integration',
  integration_batch: 'tools.integrationBatch',
  integration_introspect: 'tools.integrationIntrospect',
  database_schema: 'tools.databaseSchema',
  conversation_read: 'tools.conversationRead',
  conversation_write: 'tools.conversationWrite',
  discussion_read: 'tools.discussionRead',
  discussion_write: 'tools.discussionWrite',
  agent_read: 'tools.agentRead',
  agent_write: 'tools.agentWrite',
  metrics_read: 'tools.metricsRead',
  task_read: 'tools.taskRead',
  task_write: 'tools.taskWrite',
  project_read: 'tools.projectRead',
  project_write: 'tools.projectWrite',
  update_todos: 'tools.updateTodos',
  propose_memory: 'tools.proposeMemory',
  secret_read: 'tools.secretRead',
  request_human_input: 'tools.requestHumanInput',
  request_user_location: 'tools.requestUserLocation',
};

/**
 * Human-facing label for a platform tool: the localized name when one is
 * registered, otherwise the title-cased slug as a safe fallback. Pure — takes
 * the `chat`-namespace translator so it runs in components, memos, or tests.
 */
export function toolDisplayName(t: TFunction, toolName: string): string {
  const key = TOOL_LABEL_KEYS[toolName];
  return key ? t(key) : humanizeSeparatedSlug(toolName);
}

export function formatToolDetail(
  t: TFunction,
  toolName: string,
  input?: Record<string, unknown>,
): ToolDetail {
  if (toolName === 'web' && input) {
    if (input.operation === 'fetch_url' && typeof input.url === 'string') {
      return {
        toolName,
        displayText: t('thinking.reading', {
          hostname: extractHostname(input.url),
        }),
      };
    }
  }

  if (toolName === 'rag_search' && typeof input?.query === 'string') {
    return {
      toolName,
      displayText: t('thinking.searchingKnowledgeBase', {
        query: truncate(input.query, 25),
      }),
    };
  }

  const externalSummary = externalAgentToolSummary(toolName, input);
  if (externalSummary) {
    return { toolName, displayText: externalSummary };
  }

  if (toolName.startsWith('delegate_')) {
    const agentDisplayName =
      humanizeSeparatedSlug(toolName.slice('delegate_'.length)) || toolName;
    return {
      toolName,
      displayText: t('thinking.delegating', { agent: agentDisplayName }),
    };
  }

  return { toolName, displayText: toolDisplayName(t, toolName) };
}
