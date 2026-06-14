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

  it('renders no expand toggle (it shares the non-interactive header with the bubble)', () => {
    // The gap shell is never expandable: ThoughtHeader gets the reserved-width
    // spacer, not a chevron/button, so the brain/label sit at the exact x-offset
    // the bubble will use — zero jitter when the bubble takes over.
    render(<ThinkingIndicator phase="thinking" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
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
