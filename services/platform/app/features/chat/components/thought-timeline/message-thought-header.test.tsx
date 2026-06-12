import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MessageThoughtHeader } from './message-thought-header';

vi.mock('@/lib/i18n/client', () => ({
  useT: () => ({
    t: (key: string, params?: Record<string, string | number>) => {
      const p = (k: string) => String(params?.[k] ?? '');
      const n = (k: string) => Number(params?.[k] ?? 0);
      const plural = (k: string, one: string, other: string) =>
        `${p(k)} ${n(k) === 1 ? one : other}`;
      const map: Record<string, string> = {
        'thoughtProcess.thinking': 'Thinking',
        'thoughtProcess.responding': 'Responding',
        'thoughtProcess.routingPhase': 'Routing',
        'thoughtProcess.seconds': `${p('seconds')}s`,
        'thoughtProcess.durationLabel': `Thought for ${p('seconds')}s`,
        'thoughtProcess.toolsCount': plural('count', 'tool', 'tools'),
        'thoughtProcess.skillsCount': plural('count', 'skill', 'skills'),
        'thoughtProcess.tokensCount': plural('count', 'token', 'tokens'),
        'thoughtProcess.summaryReasoningOnly': 'Showed its reasoning',
        'thoughtProcess.working': 'Still working',
      };
      return map[key] ?? key;
    },
  }),
}));

describe('MessageThoughtHeader', () => {
  const base = {
    toolCount: 0,
    skillCount: 0,
    hasReasoning: false,
  };

  it('renders nothing when idle with no measurable summary', () => {
    const { container } = render(
      <MessageThoughtHeader
        {...base}
        isStreaming={false}
        hasAnswerStarted={false}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the live state-based label while streaming pre-answer', () => {
    render(
      <MessageThoughtHeader
        {...base}
        isStreaming
        hasAnswerStarted={false}
        activity={{ type: 'thinking' }}
        toolCount={1}
      />,
    );
    // Live label leads with the verb; the timer suffix is appended.
    expect(screen.getByText(/Thinking/)).toBeInTheDocument();
  });

  it('latches the duration + tool summary once the turn ends', () => {
    render(
      <MessageThoughtHeader
        {...base}
        isStreaming={false}
        hasAnswerStarted
        durationMs={4000}
        toolCount={1}
      />,
    );
    expect(screen.getByText(/Thought for 4s · 1 tool/)).toBeInTheDocument();
  });

  it('counts skills separately from tools', () => {
    render(
      <MessageThoughtHeader
        {...base}
        isStreaming={false}
        hasAnswerStarted
        durationMs={3000}
        toolCount={1}
        skillCount={1}
      />,
    );
    expect(screen.getByText(/1 tool · 1 skill/)).toBeInTheDocument();
  });

  it('shows the token count once known', () => {
    render(
      <MessageThoughtHeader
        {...base}
        isStreaming={false}
        hasAnswerStarted
        durationMs={2000}
        tokenCount={1234}
      />,
    );
    expect(screen.getByText(/1234 tokens/)).toBeInTheDocument();
  });

  it('swaps a stale "Thinking" for the honest-silence label', () => {
    render(
      <MessageThoughtHeader
        {...base}
        isStreaming
        hasAnswerStarted={false}
        activity={{ type: 'thinking' }}
        lastEventAt={Date.now() - 120_000}
      />,
    );
    expect(screen.getByText(/Still working/)).toBeInTheDocument();
  });

  it('keeps a specific live label even when events are stale', () => {
    render(
      <MessageThoughtHeader
        {...base}
        isStreaming
        hasAnswerStarted={false}
        activity={{ type: 'tool', toolName: 'Bash' }}
        lastEventAt={Date.now() - 120_000}
      />,
    );
    expect(screen.queryByText(/Still working/)).not.toBeInTheDocument();
  });

  it('keeps "Thinking" while events are fresh', () => {
    render(
      <MessageThoughtHeader
        {...base}
        isStreaming
        hasAnswerStarted={false}
        activity={{ type: 'thinking' }}
        lastEventAt={Date.now() - 5_000}
      />,
    );
    expect(screen.getByText(/Thinking/)).toBeInTheDocument();
    expect(screen.queryByText(/Still working/)).not.toBeInTheDocument();
  });

  it('falls back to the reasoning-only label when nothing is measurable', () => {
    render(
      <MessageThoughtHeader
        {...base}
        isStreaming={false}
        hasAnswerStarted
        hasReasoning
      />,
    );
    expect(screen.getByText('Showed its reasoning')).toBeInTheDocument();
  });
});
