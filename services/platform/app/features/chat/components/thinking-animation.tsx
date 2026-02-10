'use client';

import type { UIMessage } from '@convex-dev/agent/react';

import { motion } from 'framer-motion';

import { useT } from '@/lib/i18n/client';

interface ToolDetail {
  toolName: string;
  displayText: string;
}

function extractHostname(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 1) + '…';
}

interface ThinkingAnimationProps {
  streamingMessage?: UIMessage;
}

export function ThinkingAnimation({
  streamingMessage,
}: ThinkingAnimationProps) {
  const { t } = useT('chat');

  const formatToolDetail = (
    toolName: string,
    input?: Record<string, unknown>,
  ): ToolDetail => {
    if (toolName === 'web' && input) {
      if (input.operation === 'fetch_url' && typeof input.url === 'string') {
        return {
          toolName,
          displayText: t('thinking.reading', {
            hostname: extractHostname(input.url),
          }),
        };
      }
      if (input.operation === 'browser_operate' && input.instruction) {
        return {
          toolName,
          displayText: t('thinking.browsing'),
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

    const toolDisplayNames: Record<string, string> = {
      customer_read: t('tools.customerRead'),
      product_read: t('tools.productRead'),
      rag_search: t('tools.ragSearch'),
      web: t('tools.web'),
      pdf: t('tools.pdf'),
      image: t('tools.image'),
      pptx: t('tools.pptx'),
      docx: t('tools.docx'),
      resource_check: t('tools.resourceCheck'),
      workflow_read: t('tools.workflowRead'),
      update_workflow_step: t('tools.updateWorkflowStep'),
      save_workflow_definition: t('tools.saveWorkflowDefinition'),
      validate_workflow_definition: t('tools.validateWorkflowDefinition'),
      generate_excel: t('tools.generateExcel'),
    };

    const displayText =
      toolDisplayNames[toolName] ||
      toolName
        .split('_')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');

    return { toolName, displayText };
  };

  const toolDetails: ToolDetail[] = [];

  if (streamingMessage?.parts) {
    for (const part of streamingMessage.parts) {
      if (part.type.startsWith('tool-')) {
        const toolName = part.type.slice(5);
        if (toolName && toolName !== 'invocation') {
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- UIMessage.parts is loosely typed, need to access tool input field
          const toolPart = part as { input?: Record<string, unknown> };
          const detail = formatToolDetail(toolName, toolPart.input);
          toolDetails.push(detail);
        }
      }
    }
  }

  let displayText = t('thinking.default');

  if (toolDetails.length === 1) {
    displayText = toolDetails[0].displayText;
  } else if (toolDetails.length > 1) {
    const uniqueDisplayTexts = [
      ...new Set(toolDetails.map((d) => d.displayText)),
    ];

    const searchingPrefix = t('thinking.searching', { query: '' }).replace(
      '""',
      '',
    );
    const allSearches = uniqueDisplayTexts.every((text) =>
      text.startsWith(searchingPrefix),
    );

    if (allSearches && uniqueDisplayTexts.length > 1) {
      const queries = uniqueDisplayTexts.map((text) =>
        text.slice(
          searchingPrefix.length,
          text.endsWith('"') ? text.length : text.length,
        ),
      );
      if (queries.length <= 2) {
        displayText = t('thinking.searchingMultiple', {
          queries: queries.join(` ${t('thinking.and')} `),
        });
      } else {
        displayText = t('thinking.searchingMore', {
          first: queries[0],
          second: queries[1],
          count: queries.length - 2,
        });
      }
    } else if (uniqueDisplayTexts.length <= 2) {
      displayText = t('thinking.multipleTools', {
        first: uniqueDisplayTexts[0],
        second: uniqueDisplayTexts[1],
      });
    } else {
      displayText = t('thinking.multipleToolsMore', {
        first: uniqueDisplayTexts[0],
        second: uniqueDisplayTexts[1],
        count: uniqueDisplayTexts.length - 2,
      });
    }
  }

  const animationKey =
    toolDetails.length > 0
      ? toolDetails.map((d) => d.displayText).join('-')
      : 'thinking';

  return (
    <div className="flex justify-start">
      <motion.div
        key={animationKey}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={{
          duration: 0.3,
          ease: [0.25, 0.1, 0.25, 1],
        }}
        className="text-muted-foreground flex items-center gap-2 px-4 py-3 text-sm"
      >
        <motion.span
          key={animationKey}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{
            duration: 0.25,
            ease: [0.25, 0.1, 0.25, 1],
          }}
          className="inline-block"
        >
          {displayText}
        </motion.span>
        <div className="flex space-x-1">
          <div className="bg-muted-foreground h-1 w-1 animate-bounce rounded-full" />
          <div
            className="bg-muted-foreground h-1 w-1 animate-bounce rounded-full"
            style={{ animationDelay: '0.1s' }}
          />
          <div
            className="bg-muted-foreground h-1 w-1 animate-bounce rounded-full"
            style={{ animationDelay: '0.2s' }}
          />
        </div>
      </motion.div>
    </div>
  );
}

/**
 * Simple loading dots animation for welcome page.
 */
export function LoadingDots() {
  return (
    <div className="flex space-x-1.5">
      <div className="bg-muted-foreground h-2 w-2 animate-bounce rounded-full" />
      <div
        className="bg-muted-foreground h-2 w-2 animate-bounce rounded-full"
        style={{ animationDelay: '0.1s' }}
      />
      <div
        className="bg-muted-foreground h-2 w-2 animate-bounce rounded-full"
        style={{ animationDelay: '0.2s' }}
      />
    </div>
  );
}
