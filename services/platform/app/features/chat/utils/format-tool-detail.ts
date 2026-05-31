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
