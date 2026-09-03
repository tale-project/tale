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

// A Content-ID is not proof that an attachment is inline. Many mail clients
// stamp one on ordinary file parts, and the previous filter hid anything
// carrying both a contentId and a url — so a real PDF from such a sender
// vanished from the Inbox while a self-sent test from a client that omits
// Content-ID displayed fine.
describe('Message — attachment list vs inline images', () => {
  function attachment(over: Record<string, unknown> = {}) {
    return {
      id: 'a1',
      filename: 'CV.pdf',
      contentType: 'application/pdf',
      size: 23_359,
      url: '/storage/blob_1/CV.pdf',
      ...over,
    } as NonNullable<MessageType['attachments']>[number];
  }

  it('shows an attachment whose cid the body never references', () => {
    render(
      <Message
        message={makeMessage({
          content: '<p>My CV is attached.</p>',
          attachments: [attachment({ contentId: '<part1.abc@mail>' })],
        })}
      />,
    );
    expect(screen.getByText('CV.pdf')).toBeInTheDocument();
  });

  it('hides an inline image the body draws', () => {
    render(
      <Message
        message={makeMessage({
          content: '<p>See <img src="cid:logo.abc@mail"> here.</p>',
          attachments: [
            attachment({
              filename: 'logo.png',
              contentType: 'image/png',
              contentId: '<logo.abc@mail>',
              url: '/storage/blob_2/logo.png',
            }),
          ],
        })}
      />,
    );
    expect(screen.queryByText('logo.png')).not.toBeInTheDocument();
  });

  it('shows a plain attachment alongside a drawn inline image', () => {
    render(
      <Message
        message={makeMessage({
          content: '<p><img src="cid:logo.abc@mail"> CV attached.</p>',
          attachments: [
            attachment({ contentId: '<part1.abc@mail>' }),
            attachment({
              id: 'a2',
              filename: 'logo.png',
              contentType: 'image/png',
              contentId: '<logo.abc@mail>',
              url: '/storage/blob_2/logo.png',
            }),
          ],
        })}
      />,
    );
    expect(screen.getByText('CV.pdf')).toBeInTheDocument();
    expect(screen.queryByText('logo.png')).not.toBeInTheDocument();
  });

  it('shows an attachment with no contentId at all', () => {
    render(
      <Message
        message={makeMessage({
          content: '<p>Attached.</p>',
          attachments: [attachment()],
        })}
      />,
    );
    expect(screen.getByText('CV.pdf')).toBeInTheDocument();
  });

  // An inline image whose bytes are not stored yet stays visible, so it can be
  // downloaded by hand if the auto-download fails.
  it('shows a referenced inline image that has no url yet', () => {
    render(
      <Message
        message={makeMessage({
          content: '<p><img src="cid:logo.abc@mail"></p>',
          attachments: [
            attachment({
              filename: 'logo.png',
              contentType: 'image/png',
              contentId: '<logo.abc@mail>',
              url: undefined,
            }),
          ],
        })}
      />,
    );
    expect(screen.getByText('logo.png')).toBeInTheDocument();
  });

  it('matches a percent-escaped cid reference', () => {
    render(
      <Message
        message={makeMessage({
          content: '<p><img src="cid:logo%2Eabc@mail"></p>',
          attachments: [
            attachment({
              filename: 'logo.png',
              contentType: 'image/png',
              contentId: '<logo.abc@mail>',
              url: '/storage/blob_2/logo.png',
            }),
          ],
        })}
      />,
    );
    expect(screen.queryByText('logo.png')).not.toBeInTheDocument();
  });

  it('says the file is no longer available instead of its size', () => {
    // The size reads as a promise the message cannot keep.
    render(
      <Message
        message={makeMessage({
          content: '<p>My CV is attached.</p>',
          attachments: [attachment({ unavailable: true, url: undefined })],
        })}
      />,
    );
    expect(screen.getByText('attachment.unavailable')).toBeInTheDocument();
    expect(screen.queryByText(/23,359|22\.8/)).not.toBeInTheDocument();
  });

  it('offers no download for an attachment whose bytes are gone', () => {
    render(
      <Message
        message={makeMessage({
          content: '<p>My CV is attached.</p>',
          attachments: [attachment({ unavailable: true, url: undefined })],
        })}
      />,
    );
    expect(
      screen.queryByRole('button', { name: /attachment\.download CV\.pdf/ }),
    ).not.toBeInTheDocument();
  });

  it('still shows the size and a download for an attachment that is there', () => {
    // The other half of the pair: a flag that hid every attachment would
    // pass the two cases above on its own.
    render(
      <Message
        message={makeMessage({
          content: '<p>My CV is attached.</p>',
          attachments: [attachment()],
        })}
      />,
    );
    expect(
      screen.queryByText('attachment.unavailable'),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /attachment\.download CV\.pdf/ }),
    ).toBeInTheDocument();
  });
});
