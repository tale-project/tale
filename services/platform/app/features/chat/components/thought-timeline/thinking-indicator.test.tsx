import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';

import { ThinkingIndicator } from './thinking-indicator';

vi.mock('@/lib/i18n/client', () => ({
  useT: () => ({
    t: (key: string, params?: Record<string, string | number>) => {
      const p = (k: string) => String(params?.[k] ?? '');
      const map: Record<string, string> = {
        'thoughtProcess.thinking': 'Thinking',
        'thoughtProcess.routingPhase': 'Routing',
        'thoughtProcess.seconds': `${p('seconds')}s`,
        'routing.routedTo': `Routed to ${p('agent')}`,
        'routing.reason.classified': 'Best match for this request',
        'thoughtProcess.working': 'Still working',
      };
      return map[key] ?? key;
    },
  }),
}));

describe('ThinkingIndicator', () => {
  it('shows the "Thinking" status while a pinned agent generates', () => {
    render(<ThinkingIndicator phase="thinking" />);
    expect(screen.getByText(/Thinking/)).toBeInTheDocument();
    expect(screen.queryByText(/Routed to/)).not.toBeInTheDocument();
  });

  it('shows "Routing" while the Auto router is still deciding', () => {
    render(<ThinkingIndicator phase="routing" />);
    expect(screen.getByText(/Routing/)).toBeInTheDocument();
  });

  it('surfaces the resolved "Routed to X" chip as soon as the route lands', () => {
    // The pre-bubble window where routing has resolved but no token has streamed
    // — the chip must be visible here so the routing decision isn't hidden until
    // the bubble takes over.
    render(
      <ThinkingIndicator
        phase="thinking"
        routedAgentName="Researcher"
        routeReason="classified"
      />,
    );
    expect(screen.getByText('Routed to Researcher')).toBeInTheDocument();
  });

  it('omits the routed-to chip before the route resolves', () => {
    render(<ThinkingIndicator phase="routing" />);
    expect(screen.queryByText(/Routed to/)).not.toBeInTheDocument();
  });

  it('swaps to "Still working" once the silence passes the stall threshold', () => {
    render(
      <ThinkingIndicator phase="thinking" lastEventAt={Date.now() - 120_000} />,
    );
    expect(screen.getByText(/Still working/)).toBeInTheDocument();
    expect(screen.queryByText(/Thinking/)).not.toBeInTheDocument();
  });

  it('keeps "Thinking" while events are fresh', () => {
    render(
      <ThinkingIndicator phase="thinking" lastEventAt={Date.now() - 5_000} />,
    );
    expect(screen.getByText(/Thinking/)).toBeInTheDocument();
  });

  it('never overrides the routing phase', () => {
    render(
      <ThinkingIndicator phase="routing" lastEventAt={Date.now() - 120_000} />,
    );
    expect(screen.getByText(/Routing/)).toBeInTheDocument();
    expect(screen.queryByText(/Still working/)).not.toBeInTheDocument();
  });

  it('passes an accessibility audit', async () => {
    const { container } = render(
      <ThinkingIndicator
        phase="thinking"
        routedAgentName="Researcher"
        routeReason="classified"
      />,
    );
    await checkAccessibility(container);
  });
});
