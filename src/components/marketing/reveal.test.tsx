import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mockMotionPreference } from '../../../tests/utils/motion-preference';
import { Reveal } from './reveal';

describe('Reveal', () => {
  beforeEach(() => {
    const start = Date.now();
    vi.spyOn(performance, 'now').mockImplementation(() => Date.now() - start);
    mockMotionPreference();
  });

  afterEach(() => vi.restoreAllMocks());

  it('immediately reveals a keyboard-focused link before the viewport observer fires', async () => {
    const onFocusCapture = vi.fn();
    const { container } = render(
      <Reveal delay={5} onFocusCapture={onFocusCapture}>
        <a href="/platform">Explore the platform</a>
      </Reveal>,
    );
    expect(container.firstElementChild).toHaveStyle({ opacity: '0' });

    fireEvent.focus(screen.getByRole('link'));
    await waitFor(() =>
      expect(container.firstElementChild).toHaveStyle({ opacity: '1' }),
    );
    expect(onFocusCapture).toHaveBeenCalledOnce();
  });

  it('reveals already-mounted offscreen content when reduced motion is enabled', async () => {
    const preference = mockMotionPreference();
    const { container } = render(<Reveal>Available to everyone</Reveal>);
    expect(container.firstElementChild).toHaveStyle({ opacity: '0' });

    act(() => preference.change(true));
    await waitFor(() =>
      expect(container.firstElementChild).toHaveStyle({ opacity: '1' }),
    );
  });

  it('keeps scroll reveals opacity-only even when passed a hero offset', () => {
    const { container } = render(<Reveal y={20}>A stable section</Reveal>);
    expect(container.firstElementChild).not.toHaveStyle({
      transform: 'translateY(20px)',
    });
  });
});
