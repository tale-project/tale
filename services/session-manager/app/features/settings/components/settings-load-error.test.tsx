import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/app/lib/api/client';
import { checkAccessibility } from '@/tests/utils/a11y';
import { renderApp } from '@/tests/utils/render';

import { SettingsLoadError } from './settings-load-error';

const unreachable = new ApiError(
  0,
  'network',
  'Cannot reach the session manager.',
);

describe('SettingsLoadError', () => {
  it('says the settings could not be loaded, and leaves the rest to the Try again beside it', () => {
    renderApp(
      <SettingsLoadError
        error={unreachable}
        onRetry={vi.fn()}
        isRetrying={false}
        failureKey={1}
      />,
    );

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent("Couldn't load the settings.");
    // The page's banner says the server cannot be reached; the sentence does not repeat it.
    expect(alert).not.toHaveTextContent("Can't reach Session Manager");
    expect(alert).not.toHaveTextContent('try again');
  });

  it('says why when the answer names a cause that trying again does not mend', () => {
    renderApp(
      <SettingsLoadError
        error={new ApiError(403, 'forbidden_host', 'x')}
        onRetry={vi.fn()}
        isRetrying={false}
        failureKey={1}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      "Couldn't load the settings. Open Session Manager at 127.0.0.1 or localhost.",
    );
  });

  it('adds what a plain error says when it carries a sentence for the person', () => {
    renderApp(
      <SettingsLoadError
        error={new Error('boom')}
        onRetry={vi.fn()}
        isRetrying={false}
        failureKey={1}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      "Couldn't load the settings. boom",
    );
  });

  it('tries again when asked', async () => {
    const onRetry = vi.fn();
    const { user } = renderApp(
      <SettingsLoadError
        error={unreachable}
        onRetry={onRetry}
        isRetrying={false}
        failureKey={1}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('shows the retry as busy, and ignores a click, while it runs', async () => {
    const onRetry = vi.fn();
    const { user } = renderApp(
      <SettingsLoadError
        error={unreachable}
        onRetry={onRetry}
        isRetrying
        failureKey={1}
      />,
    );

    const retry = screen.getByRole('button', { name: 'Try again' });
    expect(retry).toHaveAttribute('aria-busy', 'true');
    await user.click(retry);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('has no accessibility violations', async () => {
    const view = renderApp(
      <SettingsLoadError
        error={unreachable}
        onRetry={vi.fn()}
        isRetrying={false}
        failureKey={1}
      />,
    );
    await checkAccessibility(view);
  });
});
