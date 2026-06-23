import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';

import { useFormEditor } from '@/app/components/ui/editor';
import { checkAccessibility } from '@/tests/utils/a11y';
import { fireEvent, render, screen, waitFor } from '@/tests/utils/render';

import { OrganizationSettingsView } from './organization-settings';

// The view now embeds the Members section, which subscribes to Convex via
// `useMembers`. This suite renders the view in isolation (no Convex provider)
// to exercise the locale-select dirty guard, so stub the members table out —
// it has its own coverage.
vi.mock('./members-settings', () => ({
  MembersSettings: () => null,
}));

interface Form {
  name: string;
  defaultLocale: string;
}

const save = vi.fn(async (_v: Form) => {});

const holder: { current: ReturnType<typeof useFormEditor<Form>> | null } = {
  current: null,
};

function Harness() {
  const editor = useFormEditor<Form>({
    data: { name: 'Acme', defaultLocale: 'en' },
    save,
  });
  holder.current = editor;
  return (
    <OrganizationSettingsView
      controller={editor}
      organization={{ _id: 'org1', name: 'Acme' }}
      organizationId="org1"
      memberContext={null}
      canDelete={false}
      isCurrentOrganization
    />
  );
}

// Migrated from the settings E2E "organization: page loads and shows the
// current org name": the page-load assertion is pure rendered UI — the
// "Organization details" section heading and the read-only org-name field
// resolving to a non-empty value. We mock the org via the injected controller
// (the container's `useOrganization` query feeds the form's `data`) and assert
// the same seam the E2E did.
// A harness that seeds the form controller with a specific org name — mirrors
// the way the container feeds `useOrganization` data into the form.
function LoadHarness({ orgName }: { orgName: string }) {
  const editor = useFormEditor<Form>({
    data: { name: orgName, defaultLocale: 'en' },
    save,
  });
  return (
    <OrganizationSettingsView
      controller={editor}
      organization={{ _id: 'org1', name: orgName }}
      organizationId="org1"
      memberContext={null}
      canDelete={false}
      isCurrentOrganization
    />
  );
}

describe('OrganizationSettingsView page load', () => {
  it('renders the details section heading and the org name field with the current org name', async () => {
    const { container } = render(<LoadHarness orgName="Acme Industries" />);

    // The section heading the E2E asserts (rendered as a level-2 heading by
    // SettingsSection).
    expect(
      screen.getByRole('heading', {
        name: 'Organization details',
        level: 2,
      }),
    ).toBeInTheDocument();

    // The org-name field, labeled by `settings.organization.title`, resolves to
    // the current (non-empty) org name once the form applies its baseline.
    const orgNameField = screen.getByRole('textbox', {
      name: 'Organization name',
    });
    await waitFor(() => expect(orgNameField).toHaveValue('Acme Industries'));
    // Mirror the E2E's "non-empty value" intent.
    expect((orgNameField as HTMLInputElement).value).not.toBe('');

    await checkAccessibility(container);
  });
});

// The container wires `useFormEditor` with a Zod schema that makes the org name
// required (`z.string().trim().min(1, …)`); the view then surfaces the error
// via `errorMessage={formState.errors.name?.message}` and the editor's `isValid`
// gates the global Save button. The page-load/locale harnesses above
// deliberately omit the schema, so this harness mirrors the *production*
// wiring — same shape, same message key — to exercise the required-name branch
// the container now ships (#1951).
const NAME_REQUIRED_MESSAGE = 'Organization name is required';

const requiredSchema = z.object({
  name: z.string().trim().min(1, NAME_REQUIRED_MESSAGE),
  defaultLocale: z.string(),
});

function RequiredHarness({ orgName }: { orgName: string }) {
  const editor = useFormEditor<Form>({
    data: { name: orgName, defaultLocale: 'en' },
    schema: requiredSchema,
    save,
  });
  holder.current = editor;
  return (
    <OrganizationSettingsView
      controller={editor}
      organization={{ _id: 'org1', name: orgName }}
      organizationId="org1"
      memberContext={null}
      canDelete={false}
      isCurrentOrganization
    />
  );
}

describe('OrganizationSettingsView required org name', () => {
  it('starts valid with a non-empty name', async () => {
    render(<RequiredHarness orgName="Acme" />);
    await waitFor(() => expect(holder.current?.isLoading).toBe(false));
    await waitFor(() => expect(holder.current?.isValid).toBe(true));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('goes invalid and shows the required error when the name is cleared', async () => {
    render(<RequiredHarness orgName="Acme" />);
    await waitFor(() => expect(holder.current?.isLoading).toBe(false));

    const orgNameField = screen.getByRole('textbox', {
      name: 'Organization name',
    });
    fireEvent.change(orgNameField, { target: { value: '' } });
    // onTouched (#1943): the field error renders only after the first blur,
    // while `isValid` (Save gating) stays accurate on every change.
    fireEvent.blur(orgNameField);

    // (a) The editor's validity flips false → the global Save button is gated.
    await waitFor(() => expect(holder.current?.isValid).toBe(false));
    // (b) The `organization.nameRequired` message renders on the name field.
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        NAME_REQUIRED_MESSAGE,
      ),
    );
  });

  it('treats a whitespace-only name as empty (trimmed) and stays invalid', async () => {
    render(<RequiredHarness orgName="Acme" />);
    await waitFor(() => expect(holder.current?.isLoading).toBe(false));

    const orgNameField = screen.getByRole('textbox', {
      name: 'Organization name',
    });
    fireEvent.change(orgNameField, { target: { value: '   ' } });
    // onTouched (#1943): blur to surface the field error.
    fireEvent.blur(orgNameField);

    await waitFor(() => expect(holder.current?.isValid).toBe(false));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        NAME_REQUIRED_MESSAGE,
      ),
    );
  });

  it('recovers to valid once a real name is typed back', async () => {
    render(<RequiredHarness orgName="Acme" />);
    await waitFor(() => expect(holder.current?.isLoading).toBe(false));

    const orgNameField = screen.getByRole('textbox', {
      name: 'Organization name',
    });
    fireEvent.change(orgNameField, { target: { value: '' } });
    await waitFor(() => expect(holder.current?.isValid).toBe(false));

    fireEvent.change(orgNameField, { target: { value: 'Acme Industries' } });
    await waitFor(() => expect(holder.current?.isValid).toBe(true));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('OrganizationSettingsView locale select', () => {
  it('does not mark the form dirty on a spurious empty change', async () => {
    render(<Harness />);
    // Baseline applied → not dirty.
    await waitFor(() => expect(holder.current?.isLoading).toBe(false));
    expect(holder.current?.isDirty).toBe(false);

    // Radix renders a hidden native <select> for form integration; a spurious
    // empty value propagates through it as `onValueChange('')` during the
    // cold-load window. Simulate that — the guard must drop it.
    const native = document.querySelector('select');
    expect(native).not.toBeNull();
    fireEvent.change(native as HTMLSelectElement, { target: { value: '' } });

    expect(holder.current?.isDirty).toBe(false);
    expect(holder.current?.form.getValues('defaultLocale')).toBe('en');
  });

  it('marks the form dirty when a real locale is selected', async () => {
    render(<Harness />);
    await waitFor(() => expect(holder.current?.isLoading).toBe(false));

    const native = document.querySelector('select');
    fireEvent.change(native as HTMLSelectElement, { target: { value: 'de' } });

    await waitFor(() => expect(holder.current?.isDirty).toBe(true));
    expect(holder.current?.form.getValues('defaultLocale')).toBe('de');
  });
});
