import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

vi.mock('@tanstack/react-router', async () => {
  const { createRouterStub } = await import('@/tests/utils/router-stub');
  return createRouterStub('/de/pricing');
});

const { LanguageSwitcher } = await import('./language-switcher');
const { useNavigate } = await import('@tanstack/react-router');

// The stub's `navigate` is one module-level mock shared by every test here.
beforeEach(() => {
  vi.mocked(useNavigate()).mockClear();
});

describe('LanguageSwitcher (URL-driven)', () => {
  it('names the locale the path carries', () => {
    render(<LanguageSwitcher />);
    expect(
      screen.getByRole('button', { name: 'Switch language: Deutsch' }),
    ).toBeInTheDocument();
  });

  it('navigates to the picked locale', async () => {
    const { user } = render(<LanguageSwitcher />);
    await user.click(screen.getByRole('button', { name: /Switch language/ }));
    await user.click(screen.getByRole('menuitem', { name: /Français/ }));
    expect(useNavigate()).toHaveBeenCalledWith({ to: '/fr/pricing' });
  });
});

describe('LanguageSwitcher (state-driven)', () => {
  it('names the value it was handed, not the path', () => {
    render(<LanguageSwitcher value="fr" onSelect={vi.fn()} />);
    expect(
      screen.getByRole('button', { name: 'Switch language: Français' }),
    ).toBeInTheDocument();
  });

  it('folds a regional variant onto the language it overrides', () => {
    // `de-CH` is a message overlay, not a fourth pickable language — the
    // control has to show the base it belongs to rather than fall to English.
    render(<LanguageSwitcher value="de-CH" onSelect={vi.fn()} />);
    expect(
      screen.getByRole('button', { name: 'Switch language: Deutsch' }),
    ).toBeInTheDocument();
  });

  it('reports the pick instead of navigating', async () => {
    const onSelect = vi.fn();
    const { user } = render(
      <LanguageSwitcher value="en" onSelect={onSelect} />,
    );
    await user.click(screen.getByRole('button', { name: /Switch language/ }));
    await user.click(screen.getByRole('menuitem', { name: /Deutsch/ }));
    expect(onSelect).toHaveBeenCalledWith('de');
    expect(useNavigate()).not.toHaveBeenCalled();
  });

  it('has no accessibility violations', async () => {
    const { container, user } = render(
      <LanguageSwitcher value="en" onSelect={vi.fn()} />,
    );
    await user.click(screen.getByRole('button', { name: /Switch language/ }));
    await checkAccessibility(container);
  });
});
