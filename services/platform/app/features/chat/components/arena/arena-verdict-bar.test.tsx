import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor, within } from '@/tests/utils/render';

import { ArenaVerdictBar } from './arena-verdict-bar';

describe('ArenaVerdictBar', () => {
  it('offers the four verdicts and the exit as one labelled group', async () => {
    const onVerdict = vi.fn();
    const onExit = vi.fn();
    const { user } = render(
      <ArenaVerdictBar
        disabled={false}
        onVerdict={onVerdict}
        onExit={onExit}
      />,
    );

    const group = screen.getByRole('group', { name: 'Choose a verdict' });
    expect(
      within(group).getByRole('button', { name: 'A is better' }),
    ).toBeEnabled();

    await user.click(
      within(group).getByRole('button', { name: 'B is better' }),
    );
    expect(onVerdict).toHaveBeenCalledWith('b_better');
    await user.click(within(group).getByRole('button', { name: 'Both bad' }));
    expect(onVerdict).toHaveBeenCalledWith('both_bad');
    await user.click(
      within(group).getByRole('button', { name: 'Exit without verdict' }),
    );
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('locks every control while a column is still answering', () => {
    render(<ArenaVerdictBar disabled onVerdict={vi.fn()} onExit={vi.fn()} />);
    for (const button of screen.getAllByRole('button')) {
      expect(button).toBeDisabled();
    }
  });

  it('passes an axe audit', async () => {
    const { container } = render(
      <ArenaVerdictBar disabled={false} onVerdict={vi.fn()} onExit={vi.fn()} />,
    );
    await waitFor(() => checkAccessibility(container));
  });
});
