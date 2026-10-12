import { describe, it, expect, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { SendButton } from './send-button';

describe('SendButton', () => {
  it('is named by its verb and sends on click', async () => {
    const onClick = vi.fn();
    const { user } = render(<SendButton label="Comment" onClick={onClick} />);
    await user.click(screen.getByRole('button', { name: 'Comment' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('does nothing while there is nothing to send', async () => {
    const onClick = vi.fn();
    const { user } = render(
      <SendButton label="Send" onClick={onClick} disabled />,
    );
    const button = screen.getByRole('button', { name: 'Send' });
    expect(button).toBeDisabled();
    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('spins and holds while a send is in flight', () => {
    const { container } = render(
      <SendButton label="Send" onClick={() => {}} sending />,
    );
    const button = screen.getByRole('button', { name: 'Send' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(container.querySelector('.animate-spin')).not.toBeNull();
  });
});
