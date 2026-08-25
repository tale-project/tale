import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { isTypingTarget, useDeselectOnEscape } from './use-deselect-on-escape';

describe('isTypingTarget', () => {
  it('treats form controls as typing', () => {
    const input = document.createElement('input');
    const textarea = document.createElement('textarea');
    const select = document.createElement('select');
    expect(isTypingTarget(input)).toBe(true);
    expect(isTypingTarget(textarea)).toBe(true);
    expect(isTypingTarget(select)).toBe(true);
  });

  it('ignores ordinary buttons', () => {
    expect(isTypingTarget(document.createElement('button'))).toBe(false);
  });
});

function Probe({ onDeselect }: { onDeselect: () => void }) {
  useDeselectOnEscape(true, onDeselect);
  return <input aria-label="Prompt" />;
}

describe('useDeselectOnEscape', () => {
  it('deselects on Escape from outside a field', async () => {
    const onDeselect = vi.fn();
    const { user } = render(
      <div>
        <button type="button">canvas</button>
        <Probe onDeselect={onDeselect} />
      </div>,
    );
    await user.click(screen.getByRole('button', { name: 'canvas' }));
    await user.keyboard('{Escape}');
    expect(onDeselect).toHaveBeenCalledTimes(1);
  });

  it('leaves the selection alone while a field is focused', async () => {
    const onDeselect = vi.fn();
    const { user } = render(<Probe onDeselect={onDeselect} />);
    await user.click(screen.getByRole('textbox', { name: 'Prompt' }));
    await user.keyboard('{Escape}');
    expect(onDeselect).not.toHaveBeenCalled();
  });
});
