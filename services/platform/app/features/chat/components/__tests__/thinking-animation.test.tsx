import type { UIMessage } from '@convex-dev/agent/react';

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ThinkingAnimation } from '../thinking-animation';

vi.mock('@/lib/i18n/client', () => ({
  useT: () => ({
    t: (key: string, params?: Record<string, string | number>) => {
      const p = (k: string) => String(params?.[k] ?? '');
      const translations: Record<string, string> = {
        'thinking.default': 'Thinking',
        'thinking.browsing': 'Browsing',
        'thinking.reading': `Reading ${p('hostname')}`,
        'thinking.searchingKnowledgeBase': `Searching knowledge base for "${p('query')}"`,
        'thinking.searching': `Searching "${p('query')}"`,
        'thinking.and': 'and',
        'thinking.multipleTools': `${p('first')} and ${p('second')}`,
        'thinking.multipleToolsMore': `${p('first')}, ${p('second')} and ${p('count')} more`,
        'thinking.searchingMultiple': `Searching ${p('queries')}`,
        'thinking.searchingMore': `Searching "${p('first')}", "${p('second')}" and ${p('count')} more`,
        'tools.customerRead': 'Customer Read',
        'tools.productRead': 'Product Read',
        'tools.ragSearch': 'Knowledge Base Search',
        'tools.web': 'Web',
        'tools.pdf': 'PDF',
        'tools.image': 'Image',
        'tools.pptx': 'PPTX',
        'tools.docx': 'DOCX',
        'tools.workflowRead': 'Workflow Read',
        'tools.updateWorkflowStep': 'Update Workflow Step',
        'tools.saveWorkflowDefinition': 'Save Workflow Definition',
        'tools.validateWorkflowDefinition': 'Validate Workflow Definition',
        'tools.excel': 'Excel',
      };
      return translations[key] ?? key;
    },
  }),
}));

vi.mock('framer-motion', () => ({
  motion: {
    div: ({
      children,
      className,
    }: {
      children: React.ReactNode;
      className?: string;
    }) => <div className={className}>{children}</div>,
    span: ({
      children,
      className,
    }: {
      children: React.ReactNode;
      className?: string;
    }) => <span className={className}>{children}</span>,
  },
}));

// UIMessagePart requires toolCallId and specific state shapes — helper builds
// type-safe parts without repeating boilerplate in every test.
function toolPart(fields: Record<string, unknown>) {
  return { toolCallId: 'tc-1', ...fields } as UIMessage['parts'][number];
}

function makeStreamingMessage(overrides: Partial<UIMessage> = {}): UIMessage {
  return {
    id: 'msg-1',
    key: 'msg-1',
    order: 0,
    stepOrder: 0,
    role: 'assistant',
    status: 'streaming',
    text: '',
    _creationTime: Date.now(),
    parts: [],
    ...overrides,
  };
}

describe('ThinkingAnimation', () => {
  it('shows default thinking text when no streaming message', () => {
    render(<ThinkingAnimation />);
    expect(screen.getByText('Thinking')).toBeInTheDocument();
  });

  it('shows default thinking text when streaming has no text and no tools', () => {
    render(<ThinkingAnimation streamingMessage={makeStreamingMessage()} />);
    expect(screen.getByText('Thinking')).toBeInTheDocument();
  });

  it('shows thinking when text is streaming with no active tools', () => {
    render(
      <ThinkingAnimation
        streamingMessage={makeStreamingMessage({ text: 'Some streamed text' })}
      />,
    );
    expect(screen.getByText('Thinking')).toBeInTheDocument();
  });

  it('shows detailed tool status when no text and tool is active', () => {
    render(
      <ThinkingAnimation
        streamingMessage={makeStreamingMessage({
          parts: [
            toolPart({
              type: 'tool-rag_search',
              state: 'input-available',
              input: { query: 'EU AI Act compliance' },
            }),
          ],
        })}
      />,
    );
    expect(
      screen.getByText('Searching knowledge base for "EU AI Act compliance"'),
    ).toBeInTheDocument();
  });

  it('ignores completed tool parts (stale tools)', () => {
    render(
      <ThinkingAnimation
        streamingMessage={makeStreamingMessage({
          parts: [
            toolPart({
              type: 'tool-rag_search',
              state: 'output-available',
              input: { query: 'EU AI Act compliance' },
              output: {},
            }),
          ],
        })}
      />,
    );
    expect(screen.getByText('Thinking')).toBeInTheDocument();
    expect(
      screen.queryByText(/Searching knowledge base/),
    ).not.toBeInTheDocument();
  });

  it('falls back to thinking when text is streaming with active tools', () => {
    render(
      <ThinkingAnimation
        streamingMessage={makeStreamingMessage({
          text: 'Here is a detailed analysis of the EU AI Act...',
          parts: [
            toolPart({
              type: 'tool-rag_search',
              state: 'input-available',
              input: { query: 'EU AI Act compliance' },
            }),
            toolPart({
              type: 'tool-web',
              state: 'input-streaming',
              input: {
                operation: 'fetch_url',
                url: 'https://example.com/eu-ai-act',
              },
            }),
          ],
        })}
      />,
    );
    expect(screen.getByText('Thinking')).toBeInTheDocument();
    expect(
      screen.queryByText(/Searching knowledge base/),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/Reading/)).not.toBeInTheDocument();
  });

  it('shows multiple tool details when no text is streaming', () => {
    render(
      <ThinkingAnimation
        streamingMessage={makeStreamingMessage({
          parts: [
            toolPart({
              type: 'tool-rag_search',
              state: 'input-available',
              input: { query: 'compliance' },
            }),
            toolPart({
              type: 'tool-web',
              state: 'input-streaming',
              input: {
                operation: 'fetch_url',
                url: 'https://example.com',
              },
            }),
          ],
        })}
      />,
    );
    expect(
      screen.getByText(
        'Searching knowledge base for "compliance" and Reading example.com',
      ),
    ).toBeInTheDocument();
  });

  it('skips tool-invocation parts', () => {
    render(
      <ThinkingAnimation
        streamingMessage={makeStreamingMessage({
          parts: [
            toolPart({ type: 'tool-invocation', state: 'input-available' }),
          ],
        })}
      />,
    );
    expect(screen.getByText('Thinking')).toBeInTheDocument();
  });
});
