import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { SupportUrlProvider } from '../core/support-url';
import { ErrorDisplayCompact } from './error-display-compact';

// Mock the error logger hook
vi.mock('../hooks/use-error-logger', () => ({
  useErrorLogger: () => vi.fn(),
}));

function supportLink(): HTMLElement {
  return screen.getByRole('link', { name: 'contact support' });
}

describe('ErrorDisplayCompact', () => {
  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <ErrorDisplayCompact
          error={new Error('Test error')}
          reset={() => {}}
        />,
      );
      await checkAccessibility(container);
    });
  });

  it('keeps the page description for consumers that do not override it', () => {
    render(
      <ErrorDisplayCompact error={new Error('Test error')} reset={() => {}} />,
    );
    expect(
      screen.getByText(
        'Something went wrong while loading this page. Try again or go to another section.',
      ),
    ).toBeInTheDocument();
  });

  describe('contact support link', () => {
    it('points at tale.dev/contact by default', () => {
      render(
        <ErrorDisplayCompact
          error={new Error('Test error')}
          reset={() => {}}
        />,
      );
      expect(supportLink()).toHaveAttribute('href', 'https://tale.dev/contact');
      expect(supportLink()).toHaveAttribute('target', '_blank');
      expect(supportLink()).toHaveAttribute('rel', 'noopener noreferrer');
    });

    it('carries the organization on the default page', () => {
      render(
        <ErrorDisplayCompact
          error={new Error('Test error')}
          organizationId="org_1"
          reset={() => {}}
        />,
      );
      expect(supportLink()).toHaveAttribute(
        'href',
        'https://tale.dev/contact?organizationId=org_1',
      );
    });

    it('points at the page a provider names, with the organization', () => {
      render(
        <SupportUrlProvider url="https://help.example.com/tale">
          <ErrorDisplayCompact
            error={new Error('Test error')}
            organizationId="org_1"
            reset={() => {}}
          />
        </SupportUrlProvider>,
      );
      expect(supportLink()).toHaveAttribute(
        'href',
        'https://help.example.com/tale?organizationId=org_1',
      );
    });

    it('prefers its own supportUrl over the provider', () => {
      render(
        <SupportUrlProvider url="https://help.example.com/provider">
          <ErrorDisplayCompact
            error={new Error('Test error')}
            reset={() => {}}
            supportUrl="https://help.example.com/prop"
          />
        </SupportUrlProvider>,
      );
      expect(supportLink()).toHaveAttribute(
        'href',
        'https://help.example.com/prop',
      );
    });
  });

  // #3814: a data table's error state goes when a refresh the reader did not
  // start replaces it; a focused Try again took the focus down with it.
  describe('focus when it leaves', () => {
    const nextFrame = () =>
      new Promise((resolve) => requestAnimationFrame(resolve));

    it('hands the focus it held to onFocusLost', async () => {
      const onFocusLost = vi.fn();
      const { rerender } = render(
        <ErrorDisplayCompact
          error={new Error('Test error')}
          reset={() => {}}
          onFocusLost={onFocusLost}
        />,
      );
      screen.getByRole('button', { name: 'Try again' }).focus();
      // A new callback on re-render is not the display leaving.
      const next = vi.fn();
      rerender(
        <ErrorDisplayCompact
          error={new Error('Test error')}
          reset={() => {}}
          onFocusLost={next}
        />,
      );
      await nextFrame();
      expect(onFocusLost).not.toHaveBeenCalled();
      expect(next).not.toHaveBeenCalled();

      rerender(<></>);
      await nextFrame();
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('leaves focus the reader moved elsewhere where it is', async () => {
      const onFocusLost = vi.fn();
      const { rerender } = render(
        <>
          <button type="button">Elsewhere</button>
          <ErrorDisplayCompact
            error={new Error('Test error')}
            reset={() => {}}
            onFocusLost={onFocusLost}
          />
        </>,
      );
      screen.getByRole('button', { name: 'Try again' }).focus();
      screen.getByRole('button', { name: 'Elsewhere' }).focus();

      rerender(
        <>
          <button type="button">Elsewhere</button>
          {null}
        </>,
      );
      await nextFrame();
      expect(onFocusLost).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: 'Elsewhere' })).toHaveFocus();
    });
  });
});
