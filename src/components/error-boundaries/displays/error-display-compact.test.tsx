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
});
