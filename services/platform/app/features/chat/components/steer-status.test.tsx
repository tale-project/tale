import { describe, expect, it, vi } from 'vitest';

import { render } from '@/test/utils/render';

import { SteerStatusContext, SteerStatusLine } from './steer-status';
import type { SteerStatus } from './steer-status';

// Echo the i18n key so we can assert which copy variant was chosen.
vi.mock('@/lib/i18n/client', () => ({
  useT: () => ({ t: (key: string) => key }),
}));

function renderLine(opts: { status?: SteerStatus; agentLingering: boolean }) {
  const byMessageId = new Map<string, SteerStatus>();
  if (opts.status) byMessageId.set('m1', opts.status);
  const value = {
    byMessageId,
    agentLingering: opts.agentLingering,
  };
  return render(
    // renderLine is a test helper, not a re-rendering component — a fresh value
    // per call is intentional, so the constructed-context-value rule is moot.
    // eslint-disable-next-line react/jsx-no-constructed-context-values
    <SteerStatusContext.Provider value={value}>
      <SteerStatusLine messageId="m1" />
    </SteerStatusContext.Provider>,
  );
}

describe('SteerStatusLine', () => {
  it('renders nothing when the message is not queued', () => {
    const { container } = renderLine({ agentLingering: false });
    expect(container.textContent).toBe('');
  });

  it('queued while the agent is lingering → "delivering now"', () => {
    const { container } = renderLine({
      status: 'queued',
      agentLingering: true,
    });
    expect(container.textContent).toBe('queue.status.deliversNow');
  });

  it('queued + not lingering → plain "queued"', () => {
    const { container } = renderLine({
      status: 'queued',
      agentLingering: false,
    });
    expect(container.textContent).toBe('queue.status.queued');
  });

  it('lingering does not override an already-delivered/consumed status', () => {
    const { container } = renderLine({
      status: 'delivered',
      agentLingering: true,
    });
    expect(container.textContent).toBe('queue.status.delivered');
  });
});
