import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { ContactInfoDialog } from './contact-info-dialog';

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));

vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({ can: () => true, cannot: () => false }),
}));

vi.mock('@tale/ui/use-toast', () => ({
  toast: vi.fn(),
}));

vi.mock('../hooks/mutations', () => ({
  useUpdateContact: () => ({ mutateAsync: vi.fn() }),
}));

function makeContactDoc(overrides = {}) {
  return {
    _id: 'contact-1' as never,
    _creationTime: Date.now(),
    organizationId: 'org-1',
    name: 'John Doe',
    email: 'john@example.com',
    source: 'manual_import' as const,
    locale: 'en',
    ...overrides,
  };
}

function makeContactInfo(overrides = {}) {
  return {
    id: 'contact-1',
    name: 'Unknown Contact',
    email: 'unknown@example.com',
    source: 'unknown',
    locale: 'en',
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

/** Mirrors ContactsTable: unmount the view tree when the overlay asks to close. */
function ContactsTableHost() {
  const [contact, setContact] = useState<ReturnType<
    typeof makeContactDoc
  > | null>(makeContactDoc());
  if (!contact) return null;
  return (
    <ContactInfoDialog
      contact={contact}
      open
      onOpenChange={(open) => {
        if (!open) setContact(null);
      }}
    />
  );
}

describe('ContactInfoDialog', () => {
  it('renders with full contact document', () => {
    render(
      <ContactInfoDialog
        contact={makeContactDoc()}
        open={true}
        onOpenChange={vi.fn()}
      />,
    );

    expect(screen.getByText('John Doe')).toBeInTheDocument();
    expect(screen.getByText('john@example.com')).toBeInTheDocument();
  });

  it('renders with ContactInfo fallback data', () => {
    render(
      <ContactInfoDialog
        contact={makeContactInfo()}
        open={true}
        onOpenChange={vi.fn()}
      />,
    );

    expect(screen.getByText('Unknown Contact')).toBeInTheDocument();
    expect(screen.getByText('unknown@example.com')).toBeInTheDocument();
  });

  it('renders with ContactInfo when name is missing', () => {
    render(
      <ContactInfoDialog
        contact={makeContactInfo({ name: undefined })}
        open={true}
        onOpenChange={vi.fn()}
      />,
    );

    expect(screen.getByText('unknown@example.com')).toBeInTheDocument();
  });

  it('does not render content when closed', () => {
    render(
      <ContactInfoDialog
        contact={makeContactInfo()}
        open={false}
        onOpenChange={vi.fn()}
      />,
    );

    expect(screen.queryByText('Unknown Contact')).not.toBeInTheDocument();
  });

  // --- Edit / New email identity actions (#2639) ---------------------------
  it('offers Edit and New email for an editable full contact document', () => {
    render(
      <ContactInfoDialog
        contact={makeContactDoc()}
        open={true}
        onOpenChange={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'New email' }),
    ).toBeInTheDocument();
  });

  it('uses the contact name as the dialog title, with email as the subtitle', () => {
    render(
      <ContactInfoDialog
        contact={makeContactDoc()}
        open={true}
        onOpenChange={vi.fn()}
      />,
    );

    expect(
      screen.getByRole('dialog', { name: 'John Doe' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Contact details')).not.toBeInTheDocument();
    expect(screen.getByText('john@example.com')).toBeInTheDocument();
  });

  it('places Edit and New email beside the name; Close stays on the far right', () => {
    render(
      <ContactInfoDialog
        contact={makeContactDoc()}
        open={true}
        onOpenChange={vi.fn()}
      />,
    );

    const title = screen.getByRole('heading', { name: 'John Doe' });
    const edit = screen.getByRole('button', { name: 'Edit' });
    const email = screen.getByRole('button', { name: 'New email' });
    const close = screen.getByRole('button', { name: 'Close' });
    expect(title.parentElement).toContainElement(edit);
    expect(title.parentElement).toContainElement(email);
    expect(edit.parentElement).toBe(email.parentElement);
    expect(edit.parentElement).not.toBe(close.parentElement);
  });

  it('offers no actions for the lightweight ContactInfo shape (no _id to act on)', () => {
    render(
      <ContactInfoDialog
        contact={makeContactInfo()}
        open={true}
        onOpenChange={vi.fn()}
      />,
    );

    expect(
      screen.queryByRole('button', { name: 'Edit' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'New email' }),
    ).not.toBeInTheDocument();
  });

  it('hides New email for a placeholder/unresolved address', () => {
    render(
      <ContactInfoDialog
        contact={makeContactDoc({ email: 'unknown@example.com' })}
        open={true}
        onOpenChange={vi.fn()}
      />,
    );

    expect(
      screen.queryByRole('button', { name: 'New email' }),
    ).not.toBeInTheDocument();
  });

  it('swaps the same dialog into the edit form without a second overlay', async () => {
    const onOpenChange = vi.fn();
    const { user } = render(
      <ContactInfoDialog
        contact={makeContactDoc()}
        open={true}
        onOpenChange={onOpenChange}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Edit' }));

    expect(onOpenChange).not.toHaveBeenCalled();
    const dialogs = screen.getAllByRole('dialog');
    expect(dialogs).toHaveLength(1);
    expect(dialogs[0]).toHaveAccessibleName('Edit contact');
    expect(
      screen.queryByRole('dialog', { name: 'John Doe' }),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveValue('John Doe');
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });

  it('keeps the overlay mounted when Edit is used from the list host', async () => {
    const { user } = render(<ContactsTableHost />);
    await user.click(screen.getByRole('button', { name: 'Edit' }));

    expect(
      screen.getByRole('dialog', { name: 'Edit contact' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveValue('John Doe');
  });

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <ContactInfoDialog
          contact={makeContactDoc()}
          open={true}
          onOpenChange={vi.fn()}
        />,
      );
      await checkAccessibility(container);
    });
  });
});
