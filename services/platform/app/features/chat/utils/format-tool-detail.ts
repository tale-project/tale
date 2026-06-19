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

  const toolDisplayNames: Record<string, string> = {
    customer_read: t('tools.customerRead'),
    product_read: t('tools.productRead'),
    rag_search: t('tools.ragSearch'),
    knowledge_write: t('tools.knowledgeWrite'),
    web: t('tools.web'),
    pdf: t('tools.pdf'),
    image: t('tools.image'),
    pptx: t('tools.pptx'),
    docx: t('tools.docx'),
    workflow_read: t('tools.workflowRead'),
    update_workflow_step: t('tools.updateWorkflowStep'),
    save_workflow_definition: t('tools.saveWorkflowDefinition'),
    validate_workflow_definition: t('tools.validateWorkflowDefinition'),
    excel: t('tools.excel'),
    customer_write: t('tools.customerWrite'),
    product_write: t('tools.productWrite'),
    website_read: t('tools.websiteRead'),
    website_write: t('tools.websiteWrite'),
    vendor_read: t('tools.vendorRead'),
    vendor_write: t('tools.vendorWrite'),
    conversation_read: t('tools.conversationRead'),
    conversation_write: t('tools.conversationWrite'),
    discussion_read: t('tools.discussionRead'),
    discussion_write: t('tools.discussionWrite'),
    agent_read: t('tools.agentRead'),
    agent_write: t('tools.agentWrite'),
    metrics_read: t('tools.metricsRead'),
    task_read: t('tools.taskRead'),
    task_write: t('tools.taskWrite'),
    project_read: t('tools.projectRead'),
    project_write: t('tools.projectWrite'),
  };

  const displayText =
    toolDisplayNames[toolName] ||
    toolName
      .split('_')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');

  return { toolName, displayText };
}
