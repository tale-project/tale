// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen, waitFor } from '@/tests/utils/render';

import type { ChatMessageView } from '../types';

const submitMock = vi.hoisted(() => vi.fn(() => Promise.resolve(true)));
const removeMock = vi.hoisted(() => vi.fn(() => Promise.resolve(true)));

vi.mock('../data/feedback-actions', () => ({
  useFeedbackActions: () => ({
    available: true,
    submit: submitMock,
    remove: removeMock,
  }),
}));

import { MessageToolbar } from './message-toolbar';

const MESSAGE: ChatMessageView = {
  id: 'm1',
  role: 'assistant',
  sequence: 1,
  createdAt: 1_717_000_000_000,
  model: 'claude-fable-5',
  providerSlug: 'anthropic',
  usage: {
    inputTokens: 10,
    outputTokens: 20,
    totalTokens: 30,
    durationMs: 1234,
    timeToFirstTokenMs: 456,
  },
  parts: [{ type: 'text', text: 'The answer.' }],
};

describe('MessageToolbar', () => {
  it('copies the message text to the clipboard', async () => {
    const { user } = render(<MessageToolbar message={MESSAGE} alwaysVisible />);

    await user.click(screen.getByTestId('message-copy-button'));

    await expect(navigator.clipboard.readText()).resolves.toBe('The answer.');
  });

  it('opens the info dialog with the recorded facts', async () => {
    const { user } = render(<MessageToolbar message={MESSAGE} alwaysVisible />);

    await user.click(screen.getByTestId('message-info-button'));

    expect(
      screen.getByRole('dialog', { name: /Message information/ }),
    ).toBeInTheDocument();
    expect(screen.getByText('claude-fable-5')).toBeInTheDocument();
    expect(screen.getByText('Time to first token')).toBeInTheDocument();
    expect(screen.getByText('30')).toBeInTheDocument();
  });

  it('hides the fields a turn did not record', async () => {
    const { user } = render(
      <MessageToolbar
        message={{ ...MESSAGE, usage: { inputTokens: 10 } }}
        alwaysVisible
      />,
    );

    await user.click(screen.getByTestId('message-info-button'));

    expect(screen.queryByText('Time to first token')).toBeNull();
    expect(screen.queryByText('Performance')).toBeNull();
  });

  it('keeps only Show info on an errored turn', () => {
    render(
      <MessageToolbar message={{ ...MESSAGE, error: 'boom' }} alwaysVisible />,
    );

    expect(screen.queryByTestId('message-copy-button')).toBeNull();
    expect(screen.getByTestId('message-info-button')).toBeInTheDocument();
  });
});

describe('MessageToolbar feedback', () => {
  beforeEach(() => {
    submitMock.mockClear();
    removeMock.mockClear();
  });

  const CONTEXT = { organizationId: 'org-1', threadId: 't-1' } as const;

  it('hides the thumbs without a conversation context', () => {
    render(<MessageToolbar message={MESSAGE} alwaysVisible />);
    expect(screen.queryByTestId('message-thumbs-up')).toBeNull();
  });

  it('submits a positive rating and removes it on a second click', async () => {
    const { user } = render(
      <MessageToolbar message={MESSAGE} alwaysVisible {...CONTEXT} />,
    );

    const thumbsUp = screen.getByTestId('message-thumbs-up');
    await user.click(thumbsUp);
    await waitFor(() =>
      expect(submitMock).toHaveBeenCalledWith('t-1', 'm1', 'positive'),
    );
    expect(thumbsUp).toHaveAttribute('aria-pressed', 'true');

    await user.click(thumbsUp);
    await waitFor(() => expect(removeMock).toHaveBeenCalledWith('m1'));
    expect(thumbsUp).toHaveAttribute('aria-pressed', 'false');
  });

  it('thumbs-down rates immediately and the comment refines it', async () => {
    const { user } = render(
      <MessageToolbar message={MESSAGE} alwaysVisible {...CONTEXT} />,
    );

    await user.click(screen.getByTestId('message-thumbs-down'));
    await waitFor(() =>
      expect(submitMock).toHaveBeenCalledWith('t-1', 'm1', 'negative'),
    );

    const box = screen.getByPlaceholderText('What could be improved?');
    await user.type(box, 'Wrong tone');
    await user.click(screen.getByRole('button', { name: 'Submit' }));

    await waitFor(() =>
      expect(submitMock).toHaveBeenCalledWith(
        't-1',
        'm1',
        'negative',
        'Wrong tone',
      ),
    );
    expect(screen.queryByPlaceholderText('What could be improved?')).toBeNull();
  });

  it('latches from the server-provided rating', () => {
    render(
      <MessageToolbar
        message={MESSAGE}
        alwaysVisible
        {...CONTEXT}
        rating="negative"
      />,
    );
    expect(screen.getByTestId('message-thumbs-down')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});
