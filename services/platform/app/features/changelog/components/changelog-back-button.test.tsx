// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ChangelogBackButton } from './changelog-back-button';

const mockBack = vi.fn();
const mockNavigate = vi.fn();
const canGoBack = { value: true };

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ history: { back: mockBack } }),
  useCanGoBack: () => canGoBack.value,
  useNavigate: () => mockNavigate,
}));

vi.mock('@/lib/i18n/client', () => ({
  useT: (ns: string) => ({ t: (key: string) => `${ns}.${key}` }),
}));

describe('ChangelogBackButton', () => {
  beforeEach(() => {
    mockBack.mockClear();
    mockNavigate.mockClear();
    canGoBack.value = true;
  });

  afterEach(() => {
    cleanup();
  });

  it('pops history when there is somewhere to go back to', () => {
    render(<ChangelogBackButton />);

    fireEvent.click(screen.getByRole('button'));

    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('falls back to the dashboard home when history is empty', () => {
    canGoBack.value = false;
    render(<ChangelogBackButton />);

    fireEvent.click(screen.getByRole('button'));

    expect(mockBack).not.toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith({ to: '/dashboard' });
  });
});
