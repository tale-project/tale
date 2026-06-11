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
 * One-line summary of an external-agent (Claude Code / OpenCode) tool call,
 * surfacing the load-bearing argument so the timeline reads "Bash · gh pr diff"
 * instead of a bare "Bash". Returns null for tools handled by the platform
 * formatter below. Pure string work — no i18n (the content is the arg itself).
 */
function externalAgentToolSummary(
  toolName: string,
  input?: Record<string, unknown>,
): string | null {
  if (!input) return null;
  const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
  switch (toolName) {
    case 'Bash': {
      const cmd = str(input.command);
      return cmd ? `Bash · ${truncate(cmd, 80)}` : null;
    }
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
    case 'Task': {
      const desc = str(input.description);
      return desc ? `Task · ${truncate(desc, 60)}` : null;
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
    const rawName = toolName.slice('delegate_'.length);
    const agentDisplayName =
      rawName
        .split(/[-_]+/)
        .filter(Boolean)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ') || toolName;
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
  };

  const displayText =
    toolDisplayNames[toolName] ||
    toolName
      .split('_')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');

  return { toolName, displayText };
}
