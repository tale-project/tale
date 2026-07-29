// Message bubble delivery states: the undo-send countdown on a queued
// outbound row and the visible not-delivered treatment (reason + retry) on a
// failed one. Fake timers drive the countdown deterministically.

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Message as MessageType } from '../types';
import { Message } from './message';

vi.mock('@/lib/i18n/client', () => ({
  useT: () => ({
    // Echo the key, appending interpolation params so the countdown's live
    // seconds value is assertable.
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${JSON.stringify(params)}` : key,
  }),
}));

vi.mock('@/app/hooks/use-format-date', () => ({
  useFormatDate: () => ({ formatDate: () => '10:00' }),
}));

vi.mock('@/app/components/ui/data-display/email-preview', () => ({
  EmailPreview: ({ html }: { html: string }) => <div>{html}</div>,
}));

vi.mock('@/app/components/ui/data-display/image', () => ({
  Image: () => null,
}));

const NOW = 2_000_000;

function makeMessage(overrides: Partial<MessageType> = {}): MessageType {
  return {
    id: 'msg_1',
    sender: 'connector',
    content: '<p>Happy to help</p>',
    timestamp: new Date(NOW).toISOString(),
    isCustomer: false,
    status: 'sent',
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Message — undo-send countdown (queued)', () => {
  it('shows a live countdown with an Undo action while the send window is open', () => {
    const onUndoSend = vi.fn();
    render(
      <Message
        message={makeMessage({
          status: 'queued',
          scheduledSendAt: NOW + 5_000,
        })}
        onUndoSend={onUndoSend}
      />,
    );

    expect(
      screen.getByText('message.sendingIn:{"seconds":5}'),
    ).toBeInTheDocument();

    // The countdown ticks down as the window elapses.
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(
      screen.getByText('message.sendingIn:{"seconds":3}'),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'message.undoSend' }));
    expect(onUndoSend).toHaveBeenCalledWith('msg_1');
  });

  it('falls back to the plain timestamp once the window has passed', () => {
    render(
      <Message
        message={makeMessage({
          status: 'queued',
          scheduledSendAt: NOW - 1_000,
        })}
        onUndoSend={vi.fn()}
      />,
    );

    expect(screen.queryByText(/message\.sendingIn/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'message.undoSend' }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('10:00')).toBeInTheDocument();
  });
});

describe('Message — failed delivery', () => {
  it('shows a short Not delivered label, keeps the long reason off the glance, and offers Retry and Delete', () => {
    const onRetrySend = vi.fn();
    const onDiscard = vi.fn();
    const longError =
      'SMTP send failed: connect ETIMEDOUT 1.2.3.4:465 — and then a much longer diagnostic that must not dominate the bubble footer';
    render(
      <Message
        message={makeMessage({
          status: 'failed',
          errorMessage: longError,
        })}
        onRetrySend={onRetrySend}
        onDiscard={onDiscard}
      />,
    );

    // Glance stays compact — the raw provider string is not inlined.
    expect(screen.getByText('message.notDelivered')).toBeInTheDocument();
    expect(screen.queryByText(longError)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'message.retrySend' }));
    expect(onRetrySend).toHaveBeenCalledWith('msg_1');

    fireEvent.click(screen.getByRole('button', { name: 'message.discard' }));
    expect(onDiscard).toHaveBeenCalledWith('msg_1');
  });

  it('shows the label alone when no reason was recorded', () => {
    render(<Message message={makeMessage({ status: 'failed' })} />);
    expect(screen.getByText('message.notDelivered')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'message.retrySend' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'message.discard' }),
    ).not.toBeInTheDocument();
  });
});

describe('Message — settled outbound', () => {
  it('renders a plain timestamp with no undo or retry affordances', () => {
    render(<Message message={makeMessage()} />);
    expect(screen.getByText('10:00')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByText(/message\.notDelivered/)).not.toBeInTheDocument();
  });
});
