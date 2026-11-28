import { describe, expect, it } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { ThreadTime } from './thread-time';

describe('ThreadTime', () => {
  const at = new Date('2026-10-08T14:32:00').getTime();

  it('shows the clock time with the full date on hover', () => {
    render(<ThreadTime value={at} />);
    const time = screen.getByText('2:32 PM');
    expect(time.tagName).toBe('TIME');
    expect(time).toHaveAttribute('dateTime', new Date(at).toISOString());
    expect(time).toHaveAttribute('title', 'October 8, 2026 2:32 PM');
  });

  it('shows a relative age where nothing names the day', () => {
    render(<ThreadTime value={Date.now() - 5 * 60_000} format="relative" />);
    expect(screen.getByText(/ago/)).toBeInTheDocument();
  });
});
