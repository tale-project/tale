import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Wizard, WizardStep } from '@/app/components/ui/wizard/wizard';
import { WizardFooter } from '@/app/components/ui/wizard/wizard-footer';
import { authClient } from '@/lib/auth-client';
import { render, screen } from '@/tests/utils/render';

import { isSlugTakenError, WorkspaceStep } from './workspace-step';

// The step only needs the signed-in user's id for the org metadata.
vi.mock('@/app/hooks/use-session-user', () => ({
  useAuth: () => ({ user: { userId: 'user-1' } }),
}));

vi.mock('@/app/hooks/use-toast', () => ({
  toast: vi.fn(),
}));

vi.mock('@/lib/auth-client', () => ({
  authClient: {
    organization: {
      create: vi.fn(),
      list: vi.fn(),
      setActive: vi.fn().mockResolvedValue({}),
    },
  },
}));

const create = vi.mocked(authClient.organization.create);
const list = vi.mocked(authClient.organization.list);
const setActive = vi.mocked(authClient.organization.setActive);

const fmt = (current: number, total: number, label: string) =>
  `Step ${current} of ${total}: ${label}`;

function renderStep(onCreated = vi.fn()) {
  const queryClient = new QueryClient();
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <Wizard
        steps={[
          { id: 'workspace', label: 'Workspace' },
          { id: 'done', label: 'Done' },
        ]}
        onFinish={vi.fn()}
        formatProgress={fmt}
      >
        <WorkspaceStep createdOrgId={null} onCreated={onCreated} />
        <WizardStep id="done">
          <p>Done content</p>
        </WizardStep>
        <WizardFooter backLabel="Back" nextLabel="Next" finishLabel="Finish" />
      </Wizard>
    </QueryClientProvider>,
  );
  return { onCreated, ...utils };
}

async function fillNameAndSubmit(user: {
  type: (el: Element, text: string) => Promise<void>;
  click: (el: Element) => Promise<void>;
}) {
  await user.type(screen.getByLabelText(/Organization name/), 'Acme');
  await user.click(screen.getByRole('button', { name: 'Next' }));
}

beforeEach(() => {
  vi.clearAllMocks();
  setActive.mockResolvedValue({});
});

describe('WorkspaceStep failure surfacing (#2635)', () => {
  it('renders a localized inline error when the create call rejects, and stays on the step', async () => {
    create.mockRejectedValue(new Error('backend down'));
    // The wizard logs the failure for debugging; keep test output clean.
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    const { user, onCreated } = renderStep();
    await fillNameAndSubmit(user);

    expect(
      await screen.findByText(
        "We couldn't create your workspace. Check your connection and click Next to try again.",
      ),
    ).toBeInTheDocument();
    // Still on the workspace step — retry stays possible.
    expect(screen.getByLabelText(/Organization name/)).toBeInTheDocument();
    expect(screen.queryByText('Done content')).not.toBeInTheDocument();
    expect(onCreated).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('renders the error when better-auth reports failure as { data: null, error } without throwing', async () => {
    create.mockResolvedValue({
      data: null,
      error: { code: 'INTERNAL_ERROR', message: 'boom' },
    });
    list.mockResolvedValue({ data: [] });
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    const { user, onCreated } = renderStep();
    await fillNameAndSubmit(user);

    expect(
      await screen.findByText(
        "We couldn't create your workspace. Check your connection and click Next to try again.",
      ),
    ).toBeInTheDocument();
    expect(onCreated).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('shows the name-taken error when the slug is owned by an org the user is NOT in', async () => {
    create.mockResolvedValue({
      data: null,
      error: {
        code: 'ORGANIZATION_SLUG_ALREADY_TAKEN',
        message: 'Organization slug "acme" is already taken.',
      },
    });
    // Membership list has no org under this slug — nothing to resume into.
    list.mockResolvedValue({ data: [{ id: 'other', slug: 'other' }] });
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    const { user, onCreated } = renderStep();
    await fillNameAndSubmit(user);

    expect(
      await screen.findByText(
        'That name is already taken. Pick a different one.',
      ),
    ).toBeInTheDocument();
    expect(onCreated).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('clears the submit error as soon as the name is edited', async () => {
    create.mockRejectedValue(new Error('backend down'));
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    const { user } = renderStep();
    await fillNameAndSubmit(user);
    await screen.findByText(
      "We couldn't create your workspace. Check your connection and click Next to try again.",
    );

    await user.type(screen.getByLabelText(/Organization name/), '2');
    expect(
      screen.queryByText(
        "We couldn't create your workspace. Check your connection and click Next to try again.",
      ),
    ).not.toBeInTheDocument();
    consoleError.mockRestore();
  });
});

describe('WorkspaceStep idempotent resume (#2635)', () => {
  it('resumes into the already-created org when a retry 400s as a duplicate slug', async () => {
    // First click created the org but the response was lost; the retry now
    // gets the duplicate-slug rejection while the membership list has it.
    create.mockResolvedValue({
      data: null,
      error: {
        code: 'ORGANIZATION_SLUG_ALREADY_TAKEN',
        message: 'Organization slug "acme" is already taken.',
      },
    });
    list.mockResolvedValue({
      data: [{ id: 'org-acme', slug: 'acme' }],
    });

    const { user, onCreated } = renderStep();
    await fillNameAndSubmit(user);

    // Resumed: activated + lifted the existing org, advanced to the next step.
    expect(await screen.findByText('Done content')).toBeInTheDocument();
    expect(setActive).toHaveBeenCalledWith({ organizationId: 'org-acme' });
    expect(onCreated).toHaveBeenCalledWith('org-acme');
  });
});

describe('isSlugTakenError', () => {
  it('matches the better-auth code, the platform guard message, and rejects the rest', () => {
    expect(isSlugTakenError({ code: 'ORGANIZATION_SLUG_ALREADY_TAKEN' })).toBe(
      true,
    );
    expect(
      isSlugTakenError({ message: 'Organization slug "x" is already taken.' }),
    ).toBe(true);
    expect(isSlugTakenError({ message: 'Slug already exists' })).toBe(true);
    expect(isSlugTakenError({ message: 'internal error' })).toBe(false);
    expect(isSlugTakenError(null)).toBe(false);
    expect(isSlugTakenError(undefined)).toBe(false);
  });
});
