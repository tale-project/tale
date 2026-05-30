import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';

import { ThoughtTimeline } from './thought-timeline';

vi.mock('@/lib/i18n/client', () => ({
  useT: () => ({
    t: (key: string, params?: Record<string, string | number>) => {
      const p = (k: string) => String(params?.[k] ?? '');
      const map: Record<string, string> = {
        'thoughtProcess.thinking': 'Thinking',
        'thoughtProcess.summary': `Thought for ${p('seconds')}s · used ${p('tools')} tools`,
        'thoughtProcess.summaryNoTools': `Thought for ${p('seconds')}s`,
        'thoughtProcess.summaryUnknownDuration': `Used ${p('tools')} tools`,
        'thoughtProcess.summaryReasoningOnly': 'Showed its reasoning',
        'thinking.redacted': 'Thought about this privately',
        'thinking.reading': `Reading ${p('hostname')}`,
        'thinking.searchingKnowledgeBase': `Searching knowledge base for "${p('query')}"`,
        'tools.web': 'Web',
        'tools.ragSearch': 'Knowledge Base Search',
      };
      return map[key] ?? key;
    },
  }),
}));

vi.mock('@/app/hooks/use-prefers-reduced-motion', () => ({
  usePrefersReducedMotion: () => false,
}));

vi.mock('framer-motion', () => {
  const div = ({
    children,
    className,
  }: {
    children?: React.ReactNode;
    className?: string;
  }) => <div className={className}>{children}</div>;
  const li = ({
    children,
    className,
  }: {
    children?: React.ReactNode;
    className?: string;
  }) => <li className={className}>{children}</li>;
  return {
    m: { div, li },
    motion: { div, li },
    AnimatePresence: ({ children }: { children: React.ReactNode }) => (
      <>{children}</>
    ),
    LazyMotion: ({ children }: { children: React.ReactNode }) => (
      <>{children}</>
    ),
    domAnimation: {},
  };
});

const reasoning = (text: string, state: 'streaming' | 'done' = 'done') => ({
  type: 'reasoning',
  text,
  state,
});
const tool = (
  toolName: string,
  state: string,
  extra: Record<string, unknown> = {},
) => ({
  type: `tool-${toolName}`,
  toolCallId: extra.toolCallId ?? `tc-${toolName}`,
  state,
  ...extra,
});

describe('ThoughtTimeline', () => {
  it('renders nothing when there are no steps and not streaming', () => {
    const { container } = render(
      <ThoughtTimeline parts={[]} isStreaming={false} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows a live "Thinking" status with steps while streaming', () => {
    render(
      <ThoughtTimeline
        parts={[
          reasoning('let me look this up', 'streaming'),
          tool('rag_search', 'input-available', {
            input: { query: 'pricing' },
          }),
        ]}
        isStreaming
      />,
    );

    expect(screen.getByText('Thinking')).toBeInTheDocument();
    expect(screen.getByText('let me look this up')).toBeInTheDocument();
    expect(
      screen.getByText('Searching knowledge base for "pricing"'),
    ).toBeInTheDocument();
  });

  it('stays expanded across an inter-step gap while still streaming', () => {
    // All current parts are "done" (the gap between a tool finishing and the
    // next reasoning block starting), but the message is still streaming and
    // hasn't answered yet — the panel must NOT collapse/flicker.
    render(
      <ThoughtTimeline
        parts={[reasoning('thought A'), tool('rag_search', 'output-available')]}
        isStreaming
        hasAnswerStarted={false}
      />,
    );
    expect(screen.getByText('Thinking')).toBeInTheDocument();
    expect(screen.getByText('thought A')).toBeInTheDocument();
  });

  it('collapses to a summary once the answer text starts streaming', () => {
    render(
      <ThoughtTimeline
        parts={[reasoning('thinking'), tool('web', 'output-available')]}
        isStreaming
        hasAnswerStarted
        durationMs={4000}
      />,
    );
    // Live thinking header is gone; summary button is shown instead.
    expect(screen.queryByText('Thinking')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Thought for 4s/ }),
    ).toBeInTheDocument();
    expect(screen.queryByText('thinking')).not.toBeInTheDocument();
  });

  it('collapses to a summary after streaming and expands on click', async () => {
    const { rerender } = render(
      <ThoughtTimeline
        parts={[
          reasoning('thought A'),
          tool('web', 'output-available', { toolCallId: 'a' }),
          tool('rag_search', 'output-available', { toolCallId: 'b' }),
        ]}
        isStreaming
      />,
    );

    rerender(
      <ThoughtTimeline
        parts={[
          reasoning('thought A'),
          tool('web', 'output-available', { toolCallId: 'a' }),
          tool('rag_search', 'output-available', { toolCallId: 'b' }),
        ]}
        isStreaming={false}
        durationMs={6000}
      />,
    );

    // Collapsed: summary visible, steps hidden.
    const toggle = screen.getByRole('button', { name: /Thought for 6s/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('thought A')).not.toBeInTheDocument();

    // Expand.
    const { default: userEvent } = await import('@testing-library/user-event');
    await userEvent.setup().click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('thought A')).toBeInTheDocument();
  });

  it('summary reflects tool count and duration', () => {
    render(
      <ThoughtTimeline
        parts={[tool('web', 'output-available')]}
        isStreaming={false}
        durationMs={3200}
      />,
    );
    expect(
      screen.getByRole('button', { name: /Thought for 3s · used 1 tools/ }),
    ).toBeInTheDocument();
  });

  it('uses the no-tools summary when only reasoning happened', () => {
    render(
      <ThoughtTimeline
        parts={[reasoning('just thinking')]}
        isStreaming={false}
        durationMs={2000}
      />,
    );
    expect(
      screen.getByRole('button', { name: 'Thought for 2s' }),
    ).toBeInTheDocument();
  });

  it('renders a neutral note for redacted reasoning when expanded', async () => {
    render(
      <ThoughtTimeline
        parts={[reasoning('   ', 'done')]}
        isStreaming={false}
        durationMs={1000}
      />,
    );
    // Redacted-only collapses to a summary; expand to reveal the note.
    const { default: userEvent } = await import('@testing-library/user-event');
    await userEvent.setup().click(screen.getByRole('button'));
    expect(
      screen.getByText('Thought about this privately'),
    ).toBeInTheDocument();
  });

  it('keeps the same DOM node as reasoning text grows (no remount)', () => {
    const { rerender, container } = render(
      <ThoughtTimeline parts={[reasoning('abc', 'streaming')]} isStreaming />,
    );
    const before = container.querySelector('p');
    expect(before).toHaveTextContent('abc');

    rerender(
      <ThoughtTimeline
        parts={[reasoning('abcdef', 'streaming')]}
        isStreaming
      />,
    );
    const after = container.querySelector('p');
    expect(after).toHaveTextContent('abcdef');
    // Same element instance — text mutated in place, not remounted.
    expect(before).toBe(after);
  });

  it('passes an accessibility audit while streaming and when collapsed', async () => {
    const parts = [
      reasoning('thinking through it'),
      tool('web', 'output-available'),
    ];
    const streaming = render(<ThoughtTimeline parts={parts} isStreaming />);
    await checkAccessibility(streaming.container);

    const collapsed = render(
      <ThoughtTimeline parts={parts} isStreaming={false} durationMs={5000} />,
    );
    await checkAccessibility(collapsed.container);
  });
});
