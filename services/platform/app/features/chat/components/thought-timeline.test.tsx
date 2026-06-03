import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';

import { ThoughtTimeline } from './thought-timeline';

vi.mock('@/lib/i18n/client', () => ({
  useT: () => ({
    t: (key: string, params?: Record<string, string | number>) => {
      const p = (k: string) => String(params?.[k] ?? '');
      const n = (k: string) => Number(params?.[k] ?? 0);
      const plural = (k: string, one: string, other: string) =>
        `${p(k)} ${n(k) === 1 ? one : other}`;
      const map: Record<string, string> = {
        'thoughtProcess.thinking': 'Thinking',
        'thoughtProcess.seconds': `${p('seconds')}s`,
        'thoughtProcess.durationLabel': `Thought for ${p('seconds')}s`,
        'thoughtProcess.toolsCount': plural('count', 'tool', 'tools'),
        'thoughtProcess.skillsCount': plural('count', 'skill', 'skills'),
        'thoughtProcess.tokensCount': plural('count', 'token', 'tokens'),
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

async function clickToggle() {
  const { default: userEvent } = await import('@testing-library/user-event');
  await userEvent.setup().click(screen.getByRole('button'));
}

describe('ThoughtTimeline', () => {
  it('renders nothing when there are no steps and not streaming', () => {
    const { container } = render(
      <ThoughtTimeline parts={[]} isStreaming={false} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows a live "Thinking" header (collapsed by default) while streaming', () => {
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

    const toggle = screen.getByRole('button');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    // Live header leads with "Thinking" and surfaces the in-flight tool count.
    expect(toggle).toHaveTextContent(/Thinking/);
    expect(toggle).toHaveTextContent(/1 tool/);
    // Steps stay hidden until the user expands — no mid-stream layout growth.
    expect(screen.queryByText('let me look this up')).not.toBeInTheDocument();
    expect(
      screen.queryByText('Searching knowledge base for "pricing"'),
    ).not.toBeInTheDocument();
  });

  it('expands to reveal the live steps on click while streaming', async () => {
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
    await clickToggle();
    expect(screen.getByText('let me look this up')).toBeInTheDocument();
    expect(
      screen.getByText('Searching knowledge base for "pricing"'),
    ).toBeInTheDocument();
  });

  it('swaps the live header for the duration summary once the answer starts', () => {
    render(
      <ThoughtTimeline
        parts={[reasoning('my reasoning'), tool('web', 'output-available')]}
        isStreaming
        hasAnswerStarted
        durationMs={4000}
      />,
    );
    const toggle = screen.getByRole('button');
    // No longer "Thinking"; shows the pre-answer duration + tool count.
    expect(toggle).not.toHaveTextContent('Thinking');
    expect(toggle).toHaveTextContent(/Thought for 4s/);
    expect(toggle).toHaveTextContent(/1 tool/);
    // Still collapsed by default while the answer streams below it.
    expect(screen.queryByText('my reasoning')).not.toBeInTheDocument();
  });

  it('collapses to a button summary once the turn fully ends', () => {
    render(
      <ThoughtTimeline
        parts={[reasoning('my reasoning'), tool('web', 'output-available')]}
        isStreaming={false}
        durationMs={4000}
      />,
    );
    expect(
      screen.getByRole('button', { name: /Thought for 4s/ }),
    ).toBeInTheDocument();
    expect(screen.queryByText('my reasoning')).not.toBeInTheDocument();
  });

  it('expands the finished summary on click', async () => {
    render(
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

    const toggle = screen.getByRole('button', { name: /Thought for 6s/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('thought A')).not.toBeInTheDocument();

    const { default: userEvent } = await import('@testing-library/user-event');
    await userEvent.setup().click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('thought A')).toBeInTheDocument();
  });

  it('header reflects tool count and duration', () => {
    render(
      <ThoughtTimeline
        parts={[tool('web', 'output-available')]}
        isStreaming={false}
        durationMs={3200}
      />,
    );
    expect(
      screen.getByRole('button', { name: /Thought for 3s · 1 tool/ }),
    ).toBeInTheDocument();
  });

  it('counts skills separately from tools', () => {
    render(
      <ThoughtTimeline
        parts={[
          tool('web', 'output-available', { toolCallId: 'w' }),
          tool('expand_skill', 'output-available', {
            toolCallId: 's',
            input: { skillSlug: 'pdf' },
          }),
        ]}
        isStreaming={false}
        durationMs={3000}
      />,
    );
    expect(
      screen.getByRole('button', { name: /1 tool · 1 skill/ }),
    ).toBeInTheDocument();
  });

  it('shows the token count once it is known', () => {
    render(
      <ThoughtTimeline
        parts={[reasoning('done thinking')]}
        isStreaming={false}
        durationMs={2000}
        tokenCount={1234}
      />,
    );
    expect(
      screen.getByRole('button', { name: /1234 tokens/ }),
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

  it('falls back to the reasoning-only label when nothing is measurable', () => {
    render(
      <ThoughtTimeline
        parts={[reasoning('just thinking')]}
        isStreaming={false}
      />,
    );
    expect(
      screen.getByRole('button', { name: 'Showed its reasoning' }),
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
    await clickToggle();
    expect(
      screen.getByText('Thought about this privately'),
    ).toBeInTheDocument();
  });

  it('keeps the same DOM node as reasoning text grows (no remount)', async () => {
    const { rerender, container } = render(
      <ThoughtTimeline parts={[reasoning('abc', 'streaming')]} isStreaming />,
    );
    // Expand so the reasoning <p> is mounted, then grow the text.
    await clickToggle();
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
