import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, act } from '@/tests/utils/render';

import { ContactInfoPopover } from './contact-info-popover';

function makeContactDoc(overrides = {}) {
  return {
    _id: 'contact-1' as never,
    _creationTime: Date.now(),
    organizationId: 'org-1',
    name: 'Sarah Johnson',
    email: 'sarah@company.com',
    source: 'manual_import' as const,
    locale: 'en-US',
    ...overrides,
  };
}

function makeContactInfo(overrides = {}) {
  return {
    id: 'contact-1',
    name: 'Jane Doe',
    email: 'jane@example.com',
    source: 'api',
    locale: 'en',
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function renderPopover(
  props: Partial<React.ComponentProps<typeof ContactInfoPopover>> = {},
) {
  const defaultProps = {
    contact: makeContactDoc(),
    open: true,
    onOpenChange: vi.fn(),
    trigger: <button>Open</button>,
    ...props,
  };
  return render(<ContactInfoPopover {...defaultProps} />);
}

describe('ContactInfoPopover', () => {
  it('renders contact name and email when open', () => {
    renderPopover();

    expect(screen.getByText('Sarah Johnson')).toBeInTheDocument();
    expect(screen.getByText('sarah@company.com')).toBeInTheDocument();
  });

  it('renders info rows with locale and source', () => {
    renderPopover();

    expect(screen.getByText('en-US')).toBeInTheDocument();
    expect(screen.getByText('Manual Import')).toBeInTheDocument();
  });

  it('renders with ContactInfo fallback data', () => {
    renderPopover({ contact: makeContactInfo() });

    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    expect(screen.getByText('jane@example.com')).toBeInTheDocument();
  });

  it('renders trigger element', () => {
    renderPopover({ open: false });

    expect(screen.getByText('Open')).toBeInTheDocument();
  });

  it('handles missing contact name gracefully', () => {
    renderPopover({ contact: makeContactDoc({ name: undefined }) });

    expect(screen.getByText('sarah@company.com')).toBeInTheDocument();
  });

  it('handles missing source gracefully', () => {
    renderPopover({ contact: makeContactDoc({ source: undefined }) });

    expect(screen.getByText('Sarah Johnson')).toBeInTheDocument();
  });

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      let container!: HTMLElement;
      await act(async () => {
        const result = renderPopover();
        container = result.container;
      });
      await checkAccessibility(container);
    });
  });
});
