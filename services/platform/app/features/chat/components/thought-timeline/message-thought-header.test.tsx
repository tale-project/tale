import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { ThoughtStep } from '../../utils/thought-step-types';
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
        'thinking.redacted': 'Thought about this privately',
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

  it('shows a stable "Thinking" verb while streaming pre-answer', () => {
    render(
      <MessageThoughtHeader
        {...base}
        isStreaming
        hasAnswerStarted={false}
        toolCount={1}
      />,
    );
    // The verb is a constant "Thinking" (+ timer); the header no longer mirrors
    // the trailing segment, so it never flips to a tool label mid-stream.
    expect(screen.getByText(/Thinking/)).toBeInTheDocument();
  });

  it('keeps the "Thinking" verb mid-answer instead of flipping to a tool label', () => {
    render(
      <MessageThoughtHeader
        {...base}
        isStreaming
        hasAnswerStarted
        toolCount={2}
      />,
    );
    // Mid-answer (active, answer started): still the steady verb, no timer.
    expect(screen.getByText('Thinking')).toBeInTheDocument();
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

  const reasoning = (
    id: string,
    text: string,
    redacted = false,
  ): Extract<ThoughtStep, { kind: 'reasoning' }> => ({
    kind: 'reasoning',
    id,
    text,
    state: 'done',
    redacted,
  });

  it('renders no expand toggle when there is no reasoning to reveal', () => {
    render(
      <MessageThoughtHeader
        {...base}
        isStreaming={false}
        hasAnswerStarted
        durationMs={2000}
        toolCount={1}
      />,
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('reveals the reasoning prose behind a chevron toggle (collapsed by default)', async () => {
    const user = userEvent.setup();
    render(
      <MessageThoughtHeader
        {...base}
        isStreaming={false}
        hasAnswerStarted
        durationMs={3000}
        hasReasoning
        reasoningSteps={[reasoning('r1', 'Reasoning prose alpha')]}
      />,
    );
    const toggle = screen.getByRole('button', { name: /Thought for 3s/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(/Reasoning prose alpha/)).not.toBeInTheDocument();

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(/Reasoning prose alpha/)).toBeInTheDocument();
  });

  it('reveals all reasoning blocks in order when expanded', async () => {
    const user = userEvent.setup();
    render(
      <MessageThoughtHeader
        {...base}
        isStreaming={false}
        hasAnswerStarted
        durationMs={6000}
        toolCount={2}
        hasReasoning
        reasoningSteps={[
          reasoning('r1', 'First thought block'),
          reasoning('r2', 'Second thought block'),
        ]}
      />,
    );
    await user.click(screen.getByRole('button'));
    expect(screen.getByText(/First thought block/)).toBeInTheDocument();
    expect(screen.getByText(/Second thought block/)).toBeInTheDocument();
  });

  it('shows the neutral note for a redacted reasoning block', async () => {
    const user = userEvent.setup();
    render(
      <MessageThoughtHeader
        {...base}
        isStreaming={false}
        hasAnswerStarted
        durationMs={2000}
        toolCount={1}
        reasoningSteps={[reasoning('r1', '', true)]}
      />,
    );
    await user.click(screen.getByRole('button'));
    expect(
      screen.getByText('Thought about this privately'),
    ).toBeInTheDocument();
  });
});
