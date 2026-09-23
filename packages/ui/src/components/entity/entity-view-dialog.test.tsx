import { screen, waitFor, within } from '@testing-library/react';
import { Globe, Mail } from 'lucide-react';
import { useRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render } from '@/tests/utils/render';

import { EntityViewDialog, EntityViewSection } from './entity-view-dialog';

vi.mock('@tale/ui/error-boundaries/error-scope', () => ({
  useErrorScope: () => ({ organizationId: 'org_test' }),
}));

function EditStub({
  onBack,
  onDone,
}: {
  onBack: () => void;
  onDone: () => void;
}) {
  return (
    <div role="dialog" aria-label="Edit website">
      <button type="button" onClick={onBack}>
        Cancel edit
      </button>
      <button type="button" onClick={onDone}>
        Save edit
      </button>
    </div>
  );
}

describe('EntityViewDialog', () => {
  it('lays out identity, facts, and sections', () => {
    render(
      <EntityViewDialog
        open
        onOpenChange={vi.fn()}
        title="Website details"
        description="View all information about this website"
        name="example.com"
        summary="Example Domain"
        badges={<span>Active</span>}
        icon={Globe}
        identifier={{ label: 'Website ID', value: 'website-123' }}
        facts={[
          { label: 'Scan interval', value: 'Every 1 day' },
          { label: 'Description', value: 'A test site', colSpan: 2 },
        ]}
      >
        <EntityViewSection title="Website pages" meta="3 indexed">
          <p>Page list</p>
        </EntityViewSection>
      </EntityViewDialog>,
    );

    const dialog = screen.getByRole('dialog', { name: 'Website details' });
    expect(
      within(dialog).getByRole('heading', { level: 3, name: 'example.com' }),
    ).toBeInTheDocument();
    expect(within(dialog).getByText('Example Domain')).toBeInTheDocument();
    expect(within(dialog).getByText('Active')).toBeInTheDocument();
    expect(within(dialog).getByText('Scan interval')).toBeInTheDocument();
    expect(within(dialog).getByText('Every 1 day')).toBeInTheDocument();
    const section = within(dialog).getByRole('region', {
      name: 'Website pages',
    });
    expect(within(section).getByText('3 indexed')).toBeInTheDocument();
    expect(within(section).getByText('Page list')).toBeInTheDocument();
    const identifier = within(dialog).getByRole('button', {
      name: 'website-123',
    });
    expect(
      section.compareDocumentPosition(identifier) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('closes from the labelled header control', async () => {
    const onOpenChange = vi.fn();
    const { user } = render(
      <EntityViewDialog
        open
        onOpenChange={onOpenChange}
        title="Contact details"
        name="Sarah Johnson"
      />,
    );
    await user.click(screen.getByRole('button', { name: /^Close$/ }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('uses the shared record measure', () => {
    render(
      <EntityViewDialog
        open
        onOpenChange={vi.fn()}
        title="Contact details"
        name="Sarah Johnson"
      />,
    );

    expect(screen.getByRole('dialog')).toHaveClass('md:max-w-lg');
  });

  it('hands the frame to the edit dialog and returns on cancel', async () => {
    const { user } = render(
      <EntityViewDialog
        open
        onOpenChange={vi.fn()}
        title="Website details"
        name="example.com"
        edit={{
          label: 'Edit',
          render: (handlers) => <EditStub {...handlers} />,
        }}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Edit' }));

    expect(
      await screen.findByRole('dialog', { name: 'Edit website' }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Website details' }),
      ).not.toBeInTheDocument(),
    );

    await user.click(screen.getByRole('button', { name: 'Cancel edit' }));

    expect(
      await screen.findByRole('dialog', { name: 'Website details' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('dialog', { name: 'Edit website' }),
    ).not.toBeInTheDocument();
  });

  it('closes the details as well once the edit is saved', async () => {
    const onOpenChange = vi.fn();
    const { user } = render(
      <EntityViewDialog
        open
        onOpenChange={onOpenChange}
        title="Website details"
        name="example.com"
        edit={{
          label: 'Edit',
          render: (handlers) => <EditStub {...handlers} />,
        }}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.click(await screen.findByRole('button', { name: 'Save edit' }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(
      screen.queryByRole('dialog', { name: 'Edit website' }),
    ).not.toBeInTheDocument();
  });

  it('brings the details back when the edit dialog is withdrawn mid-edit', async () => {
    const edit = {
      label: 'Edit',
      render: (handlers: { onBack: () => void; onDone: () => void }) => (
        <EditStub {...handlers} />
      ),
    };
    const { user, rerender } = render(
      <EntityViewDialog
        open
        onOpenChange={vi.fn()}
        title="Website details"
        name="example.com"
        edit={edit}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    expect(
      await screen.findByRole('dialog', { name: 'Edit website' }),
    ).toBeInTheDocument();

    // The viewer lost the right to edit while the form was open.
    rerender(
      <EntityViewDialog
        open
        onOpenChange={vi.fn()}
        title="Website details"
        name="example.com"
      />,
    );

    expect(
      await screen.findByRole('dialog', { name: 'Website details' }),
    ).toBeInTheDocument();
  });

  // Regression: Cancel removes the focused button in the update that reopens
  // the details, so they captured <body> as their opener and closing them
  // left keyboard focus nowhere.
  it('returns focus to the fallback after an edit is cancelled', async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      const triggerRef = useRef<HTMLButtonElement>(null);
      return (
        <>
          <button ref={triggerRef} type="button" onClick={() => setOpen(true)}>
            Open menu
          </button>
          <EntityViewDialog
            open={open}
            onOpenChange={setOpen}
            title="Website details"
            name="example.com"
            restoreFocusRef={triggerRef}
            edit={{
              label: 'Edit',
              render: (handlers) => <EditStub {...handlers} />,
            }}
          />
        </>
      );
    }

    const { user } = render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Open menu' }));
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    await user.click(
      await screen.findByRole('button', { name: 'Cancel edit' }),
    );
    await screen.findByRole('dialog', { name: 'Website details' });

    await user.keyboard('{Escape}');

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Open menu' })).toHaveFocus(),
    );
  });

  it('offers no edit button without an edit dialog', () => {
    render(
      <EntityViewDialog
        open
        onOpenChange={vi.fn()}
        title="Contact details"
        name="Sarah Johnson"
      />,
    );

    expect(
      screen.queryByRole('button', { name: 'Edit' }),
    ).not.toBeInTheDocument();
  });

  it('renders visible header actions after edit and runs them', async () => {
    const onEmail = vi.fn();
    const { user } = render(
      <EntityViewDialog
        open
        onOpenChange={vi.fn()}
        title="Contact details"
        name="Sarah Johnson"
        edit={{ label: 'Edit', render: () => null }}
        actions={[
          { key: 'email', label: 'New email', icon: Mail, onClick: onEmail },
          {
            key: 'hidden',
            label: 'Hidden action',
            icon: Mail,
            onClick: vi.fn(),
            visible: false,
          },
        ]}
      />,
    );

    const dialog = screen.getByRole('dialog', { name: 'Contact details' });
    const buttons = within(dialog)
      .getAllByRole('button')
      .map((button) => button.getAttribute('aria-label'));
    expect(buttons.indexOf('Edit')).toBeLessThan(buttons.indexOf('New email'));
    expect(
      within(dialog).queryByRole('button', { name: 'Hidden action' }),
    ).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'New email' }));
    expect(onEmail).toHaveBeenCalledOnce();
  });

  describe('accessibility', () => {
    it('passes axe audit when open', async () => {
      const { container } = render(
        <EntityViewDialog
          open
          onOpenChange={vi.fn()}
          title="Website details"
          description="View all information about this website"
          name="example.com"
          icon={Globe}
          edit={{ label: 'Edit', render: () => null }}
          facts={[{ label: 'Scan interval', value: 'Every 1 day' }]}
        >
          <EntityViewSection title="Website pages">
            <p>Page list</p>
          </EntityViewSection>
        </EntityViewDialog>,
      );
      await checkAccessibility(container);
    });
  });
});
