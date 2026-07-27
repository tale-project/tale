// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, expect, it } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import type { ChatMessageView } from '../types';
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
