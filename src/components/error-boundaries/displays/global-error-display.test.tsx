import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { SupportUrlProvider } from '../core/support-url';
import { GlobalErrorDisplay } from './global-error-display';

// Mock Sentry
vi.mock('@sentry/tanstackstart-react', () => ({
  captureException: vi.fn(),
}));

// Mock TanStack Router
vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({
    invalidate: vi.fn(),
  }),
}));

function supportLink(): HTMLElement {
  return screen.getByRole('link', { name: 'contact support' });
}

describe('GlobalErrorDisplay', () => {
  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <GlobalErrorDisplay error={new Error('Test error')} reset={() => {}} />,
      );
      await checkAccessibility(container);
    });
  });

  describe('contact support link', () => {
    it('points at tale.dev/contact by default', () => {
      render(
        <GlobalErrorDisplay error={new Error('Test error')} reset={() => {}} />,
      );
      expect(supportLink()).toHaveAttribute('href', 'https://tale.dev/contact');
      expect(supportLink()).toHaveAttribute('target', '_blank');
      expect(supportLink()).toHaveAttribute('rel', 'noopener noreferrer');
    });

    it('points at the page a provider names', () => {
      render(
        <SupportUrlProvider url="https://help.example.com/tale">
          <GlobalErrorDisplay
            error={new Error('Test error')}
            reset={() => {}}
          />
        </SupportUrlProvider>,
      );
      expect(supportLink()).toHaveAttribute(
        'href',
        'https://help.example.com/tale',
      );
    });

    it('prefers its own supportUrl over the provider', () => {
      render(
        <SupportUrlProvider url="https://help.example.com/provider">
          <GlobalErrorDisplay
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
});
