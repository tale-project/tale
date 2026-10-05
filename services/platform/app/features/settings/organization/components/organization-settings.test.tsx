import { useFormEditor } from '@tale/ui/editor';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod/v4';

import {
  AbilityContext,
  AbilityLoadingContext,
} from '@/app/context/ability-context';
import { BackendApiError } from '@/app/lib/backend/api-client';
import {
  memberContextQuery,
  type OrganizationView,
} from '@/app/lib/backend/org';
import { i18n } from '@/lib/i18n/i18n';
import { defineAbilityFor } from '@/lib/permissions/ability';
import { organizationNameSchema } from '@/lib/shared/schemas/organizations';
import enMessages from '@/messages/en.yml';
import { checkAccessibility } from '@/tests/utils/a11y';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@/tests/utils/render';

import {
  OrganizationSettings,
  OrganizationSettingsView,
} from './organization-settings';

const organizationQueryState = vi.hoisted(() => ({
  data: undefined as OrganizationView | null | undefined,
  isLoading: false,
  isError: false,
  isFetching: false,
  error: null as Error | null,
  refetch: vi.fn(),
}));

vi.mock(
  '@/app/features/organization/hooks/queries',
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import('@/app/features/organization/hooks/queries')
    >()),
    useOrganization: () => organizationQueryState,
  }),
);

const healthyOrganization: OrganizationView = {
  _id: 'org1',
  _creationTime: 0,
  createdAt: 0,
  name: 'Acme',
  slug: 'acme',
};

const retryLabel = i18n.getFixedT('en', 'common')('actions.tryAgain');

function ContainerHarness({
  memberRole = 'owner',
  abilityLoading = false,
}: {
  memberRole?: string;
  abilityLoading?: boolean;
}) {
  const [queryClient] = useState(() => {
    const client = new QueryClient({
      defaultOptions: { queries: { enabled: false, retry: false } },
    });
    client.setQueryData(memberContextQuery('org1').queryKey, {
      status: 'ok',
      memberId: 'member1',
      organizationId: 'org1',
      userId: 'user1',
      role: 'owner',
      createdAt: 0,
      displayName: 'Owner',
      isAdmin: true,
    });
    return client;
  });
  const ability = useMemo(() => defineAbilityFor(memberRole), [memberRole]);
  return (
    <QueryClientProvider client={queryClient}>
      <AbilityContext.Provider value={ability}>
        <AbilityLoadingContext.Provider value={abilityLoading}>
          <OrganizationSettings organizationId="org1" />
        </AbilityLoadingContext.Provider>
      </AbilityContext.Provider>
    </QueryClientProvider>
  );
}

describe('OrganizationSettings organization read', () => {
  beforeEach(() => {
    Object.assign(organizationQueryState, {
      data: undefined,
      isLoading: false,
      isError: true,
      isFetching: false,
      error: new BackendApiError(503, 'Service unavailable'),
    });
    organizationQueryState.refetch.mockReset();
  });

  function expectNoEditor() {
    expect(screen.queryByRole('textbox', { name: orgNameLabel })).toBeNull();
    expect(
      screen.queryByRole('heading', {
        name: enMessages.settings.organization.detailsTitle,
      }),
    ).toBeNull();
    expect(
      screen.queryByRole('button', {
        name: enMessages.settings.organization.deleteConfirmAction,
      }),
    ).toBeNull();
  }

  it('announces a settled 503 instead of a blank disabled editor', async () => {
    const { container } = render(<ContainerHarness />);
    expect(screen.getByRole('alert')).toHaveTextContent(
      enMessages.settings.organization.loadFailed,
    );
    expect(screen.getByRole('button', { name: retryLabel })).toBeEnabled();
    expectNoEditor();
    await checkAccessibility(container);
  });

  it('refetches on Try again and restores the healthy owner editor', async () => {
    const { user, rerender } = render(<ContainerHarness />);
    await user.click(screen.getByRole('button', { name: retryLabel }));
    expect(organizationQueryState.refetch).toHaveBeenCalledTimes(1);
    organizationQueryState.isFetching = true;
    rerender(<ContainerHarness />);
    const retry = screen.getByRole('button', { name: retryLabel });
    expect(retry).toHaveAttribute('aria-busy', 'true');
    await user.click(retry);
    expect(organizationQueryState.refetch).toHaveBeenCalledTimes(1);
    expectNoEditor();
    Object.assign(organizationQueryState, {
      data: healthyOrganization,
      isError: false,
      isFetching: false,
      error: null,
    });
    rerender(<ContainerHarness />);
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: orgNameLabel })).toHaveValue(
        'Acme',
      ),
    );
    expect(
      screen.queryByText(enMessages.settings.organization.loadFailed),
    ).toBeNull();
    expect(
      screen.getByRole('button', {
        name: enMessages.settings.organization.deleteConfirmAction,
      }),
    ).toBeEnabled();
  });

  it('gives a successful null response its own not-found message', () => {
    Object.assign(organizationQueryState, {
      data: null,
      isError: false,
      error: null,
    });
    render(<ContainerHarness />);
    expect(screen.getByRole('alert')).toHaveTextContent(
      enMessages.settings.organization.notFound,
    );
    expect(
      screen.queryByText(enMessages.settings.organization.loadFailed),
    ).toBeNull();
    expect(screen.queryByRole('button', { name: retryLabel })).toBeNull();
    expectNoEditor();
  });

  it('keeps the loading skeleton until the organization read settles', () => {
    Object.assign(organizationQueryState, {
      isLoading: true,
      isError: false,
      error: null,
    });
    const { container } = render(<ContainerHarness />);
    expect(
      screen.queryByText(enMessages.settings.organization.notFound),
    ).toBeNull();
    expect(
      screen.queryByText(enMessages.settings.organization.loadFailed),
    ).toBeNull();
    expect(container.querySelector('#org-name')).toBeDisabled();
  });

  it('waits for access and preserves access-denied precedence', () => {
    const { rerender } = render(
      <ContainerHarness memberRole="disabled" abilityLoading />,
    );
    expect(
      screen.queryByText(enMessages.settings.organization.loadFailed),
    ).toBeNull();
    rerender(<ContainerHarness memberRole="disabled" />);
    expect(
      screen.getByText(enMessages.accessDenied.organization),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(enMessages.settings.organization.loadFailed),
    ).toBeNull();
    expectNoEditor();
  });

  it('renders known organization details and owner controls normally', async () => {
    Object.assign(organizationQueryState, {
      data: healthyOrganization,
      isError: false,
      error: null,
    });
    render(<ContainerHarness />);
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: orgNameLabel })).toHaveValue(
        'Acme',
      ),
    );
    expect(
      screen.getByRole('button', {
        name: enMessages.settings.organization.deleteConfirmAction,
      }),
    ).toBeEnabled();
    expect(
      screen.queryByText(enMessages.settings.organization.loadFailed),
    ).toBeNull();
  });
});

// Resolve user-facing labels through the translation layer rather than
// hardcoding English, matching the platform i18n rule for tests.
const orgNameLabel = enMessages.settings.organization.title;
const nameRequiredMessage = enMessages.settings.organization.nameRequired;

// The view now embeds the Members section, which subscribes to Convex via
// `useMembers`. This suite renders the view in isolation (no Convex provider)
// to exercise the locale-select dirty guard, so stub the members table out —
// it has its own coverage.
vi.mock('./members-settings', () => ({
  MembersSettings: () => null,
}));

// The danger zone's delete wiring (router, session, toasts) is stubbed; the
// dialog's type-to-confirm gate is what the `canDelete` case covers.
const deleteOrganization = vi.fn().mockResolvedValue(true);
vi.mock('@/app/features/organization/hooks/use-delete-organization', () => ({
  useDeleteOrganization: () => ({ deleteOrganization, isDeleting: false }),
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
      name: orgNameLabel,
    });
    await waitFor(() => expect(orgNameField).toHaveValue('Acme Industries'));
    // Mirror the E2E's "non-empty value" intent.
    expect((orgNameField as HTMLInputElement).value).not.toBe('');

    await checkAccessibility(container);
  });
});

// Build the harness schema from the same shared `organizationNameSchema` the
// real container wires in, with the i18n message resolved through the
// translation layer — so the test guards the actual validation rule and never
// drifts on a hardcoded English literal.
const organizationSchema = z.object({
  name: organizationNameSchema(nameRequiredMessage),
  defaultLocale: z.string(),
});

function ValidationHarness({ orgName }: { orgName: string }) {
  const editor = useFormEditor<Form>({
    data: { name: orgName, defaultLocale: 'en' },
    schema: organizationSchema,
    save,
  });
  holder.current = editor;
  return (
    <OrganizationSettingsView
      controller={editor}
      organization={{ _id: 'org1', name: orgName }}
      organizationId="org1"
      canDelete={false}
      isCurrentOrganization
    />
  );
}

describe('OrganizationSettingsView name validation', () => {
  it('blocks an empty org name with an inline error and an invalid form', async () => {
    render(<ValidationHarness orgName="Acme" />);
    await waitFor(() => expect(holder.current?.isLoading).toBe(false));
    // Applying baseline data and resolving the async schema are separate renders.
    await waitFor(() => expect(holder.current?.isValid).toBe(true));

    const orgNameField = screen.getByRole('textbox', {
      name: orgNameLabel,
    });
    fireEvent.change(orgNameField, { target: { value: '' } });
    // onTouched (#1943): the field error renders only after the first blur.
    fireEvent.blur(orgNameField);

    await waitFor(() =>
      expect(screen.getByText(nameRequiredMessage)).toBeInTheDocument(),
    );
    expect(holder.current?.isValid).toBe(false);
  });

  it('treats a whitespace-only org name as invalid', async () => {
    render(<ValidationHarness orgName="Acme" />);
    await waitFor(() => expect(holder.current?.isLoading).toBe(false));
    await waitFor(() => expect(holder.current?.isValid).toBe(true));

    const orgNameField = screen.getByRole('textbox', {
      name: orgNameLabel,
    });
    // The schema trims before checking `.min(1)`, so a name of only spaces must
    // fail exactly as an empty string does — the trim is the rule this PR adds.
    fireEvent.change(orgNameField, { target: { value: '   ' } });
    // onTouched (#1943): the field error renders only after the first blur.
    fireEvent.blur(orgNameField);

    await waitFor(() =>
      expect(screen.getByText(nameRequiredMessage)).toBeInTheDocument(),
    );
    expect(holder.current?.isValid).toBe(false);
  });

  it('clears the error once a non-empty name is entered', async () => {
    render(<ValidationHarness orgName="Acme" />);
    await waitFor(() => expect(holder.current?.isLoading).toBe(false));

    const orgNameField = screen.getByRole('textbox', {
      name: orgNameLabel,
    });
    fireEvent.change(orgNameField, { target: { value: '' } });
    await waitFor(() => expect(holder.current?.isValid).toBe(false));

    fireEvent.change(orgNameField, { target: { value: 'New name' } });
    await waitFor(() => expect(holder.current?.isValid).toBe(true));
    expect(screen.queryByText(nameRequiredMessage)).not.toBeInTheDocument();
  });
});

describe('OrganizationSettingsView submit wiring', () => {
  it('routes a native submit through the controller so the dirty baseline resets', async () => {
    save.mockClear();
    render(<Harness />);
    await waitFor(() => expect(holder.current?.isLoading).toBe(false));

    const orgNameField = screen.getByRole('textbox', { name: orgNameLabel });
    fireEvent.change(orgNameField, { target: { value: 'Acme Two' } });
    await waitFor(() => expect(holder.current?.isDirty).toBe(true));

    fireEvent.submit(orgNameField.closest('form') as HTMLFormElement);

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    // Only `controller.submit` adopts the saved values as the new baseline; a
    // raw `form.handleSubmit(save)` would leave the form dirty after a
    // successful save (Save button stays live, navigation blocker still armed).
    await waitFor(() => expect(holder.current?.isDirty).toBe(false));
  });
});

describe('OrganizationSettingsView locale select', () => {
  it('does not mark the form dirty on a spurious empty change', async () => {
    render(<Harness />);
    // Baseline applied → not dirty.
    await waitFor(() => expect(holder.current?.isLoading).toBe(false));
    expect(holder.current?.isDirty).toBe(false);

    // Radix renders a hidden native <select> for form connector; a spurious
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

// E-22: the most destructive action in the product used to be one click
// after a plain confirm; it now asks for the organization's name, like an
// erasure asks for ERASE, and hands the typed name to the server.
describe('OrganizationSettingsView danger zone', () => {
  function DeleteHarness({
    organization = { _id: 'org1', name: 'Acme' },
  }: {
    organization?: { _id: string; name: string } | null;
  }) {
    const editor = useFormEditor<Form>({
      data: { name: 'Acme', defaultLocale: 'en' },
      save,
    });
    return (
      <OrganizationSettingsView
        controller={editor}
        organization={organization}
        organizationId="org1"
        canDelete
        isCurrentOrganization
      />
    );
  }

  // The client compared the trimmed input to the UNtrimmed name (the
  // server trims both), and an unknown organization made the phrase ''
  // — Delete enabled with nothing typed.
  it('compares against the trimmed name and sends it trimmed', async () => {
    const { user } = render(
      <DeleteHarness organization={{ _id: 'org1', name: '  Acme  ' }} />,
    );
    const action = enMessages.settings.organization.deleteConfirmAction;
    await user.click(screen.getByRole('button', { name: action }));
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: action });
    await user.type(
      within(dialog).getByLabelText(
        enMessages.settings.organization.deleteTypeNameLabel,
      ),
      'Acme',
    );
    expect(confirm).toBeEnabled();
    await user.click(confirm);
    await waitFor(() =>
      expect(deleteOrganization).toHaveBeenCalledWith(
        expect.objectContaining({ confirmName: 'Acme' }),
      ),
    );
  });

  it('withholds the danger zone until the organization is known', () => {
    render(<DeleteHarness organization={null} />);
    expect(
      screen.queryByRole('button', {
        name: enMessages.settings.organization.deleteConfirmAction,
      }),
    ).toBeNull();
  });

  it('keeps Delete disabled until the organization name is typed, then sends it', async () => {
    const { user } = render(<DeleteHarness />);
    const action = enMessages.settings.organization.deleteConfirmAction;

    await user.click(screen.getByRole('button', { name: action }));
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: action });
    expect(confirm).toBeDisabled();

    const field = within(dialog).getByLabelText(
      enMessages.settings.organization.deleteTypeNameLabel,
    );
    await user.type(field, 'Acme Corp');
    expect(confirm).toBeDisabled();

    await user.clear(field);
    await user.type(field, 'Acme');
    expect(confirm).toBeEnabled();

    await user.click(confirm);
    await waitFor(() =>
      expect(deleteOrganization).toHaveBeenCalledWith({
        organizationId: 'org1',
        confirmName: 'Acme',
        isCurrent: true,
      }),
    );
  });
});
