import { describe, expect, it, vi } from 'vitest';

import { inPolicyWriteOrder } from '@/app/lib/backend/policy-write-order';
import { AppError } from '@/lib/shared/errors/app-error';
import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor } from '@/tests/utils/render';

import { PersonalKeysPolicyEditor } from './personal-keys-policy-editor';

const { toastSpy, mutateSpy, readSpy, state } = vi.hoisted(() => ({
  toastSpy: vi.fn(),
  // Settles the write the way the real hook would: the editor reports from
  // the call's own promise, and a test drives it through
  // `mutateSpy(args, { onSuccess, onError })`.
  mutateSpy: vi.fn(),
  readSpy: vi.fn(),
  // Mutable, hoisted so the mock factories can read it (vi.mock is hoisted
  // above imports). `policy: null` is an organization with no stored policy.
  state: {
    isLoading: false,
    policy: null as { config: Record<string, unknown> } | null,
    canWrite: true,
    isPending: false,
  },
}));

vi.mock('@tale/ui/use-toast', () => ({
  useToast: () => ({ toast: toastSpy }),
}));

vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => {
    const can = (action: string, subject: string) =>
      action === 'write' && subject === 'orgSettings' ? state.canWrite : true;
    return {
      can,
      cannot: (action: string, subject: string) => !can(action, subject),
    };
  },
}));

vi.mock('@/app/features/settings/governance/hooks/mutations', () => ({
  useUpsertGovernancePolicy: () => ({
    mutateAsync: (args: unknown) =>
      new Promise((resolve, reject) => {
        mutateSpy(args, { onSuccess: resolve, onError: reject });
      }),
    isPending: state.isPending,
  }),
}));

// The read boundary and the editor read the same hook.
vi.mock('@/app/features/settings/governance/hooks/queries', () => ({
  useGovernancePolicy: (organizationId: string, policyType: string) => {
    readSpy(organizationId, policyType);
    return {
      data: state.isLoading ? undefined : state.policy,
      isLoading: state.isLoading,
    };
  },
}));

const LABEL = "Members' personal keys work here";

function reset(overrides: Partial<typeof state> = {}) {
  Object.assign(
    state,
    { isLoading: false, policy: null, canWrite: true, isPending: false },
    overrides,
  );
  toastSpy.mockClear();
  mutateSpy.mockReset();
  readSpy.mockClear();
}

describe('PersonalKeysPolicyEditor', () => {
  it('shows the keys working when no policy is stored', async () => {
    reset();
    const { container } = render(
      <PersonalKeysPolicyEditor organizationId="org-1" />,
    );

    expect(readSpy).toHaveBeenCalledWith('org-1', 'personal_keys');
    expect(
      screen.getByRole('heading', { name: "Members' personal keys" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Turn this off to refuse every such key/),
    ).toBeInTheDocument();
    const toggle = screen.getByRole('switch', { name: LABEL });
    expect(toggle).toBeChecked();
    expect(toggle).toBeEnabled();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    await checkAccessibility(container);
  });

  it('shows the keys refused when the stored policy turns them off', () => {
    reset({ policy: { config: { enabled: false } } });
    render(<PersonalKeysPolicyEditor organizationId="org-1" />);

    expect(screen.getByRole('switch', { name: LABEL })).not.toBeChecked();
  });

  it('saves { enabled: false } when switched off, and says it saved', async () => {
    reset();
    mutateSpy.mockImplementation(
      (_args: unknown, options: { onSuccess: () => void }) => {
        options.onSuccess();
      },
    );
    const { user } = render(
      <PersonalKeysPolicyEditor organizationId="org-1" />,
    );

    await user.click(screen.getByRole('switch', { name: LABEL }));

    expect(mutateSpy).toHaveBeenCalledTimes(1);
    expect(mutateSpy.mock.calls[0]?.[0]).toEqual({
      organizationId: 'org-1',
      policyType: 'personal_keys',
      config: { enabled: false },
    });
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith({
        title: 'Changes saved',
        description: "Members' personal keys setting updated",
        variant: 'success',
      }),
    );
  });

  it('saves { enabled: true } when switched back on', async () => {
    reset({ policy: { config: { enabled: false } } });
    const { user } = render(
      <PersonalKeysPolicyEditor organizationId="org-1" />,
    );

    await user.click(screen.getByRole('switch', { name: LABEL }));

    expect(mutateSpy.mock.calls[0]?.[0]).toEqual({
      organizationId: 'org-1',
      policyType: 'personal_keys',
      config: { enabled: true },
    });
  });

  it('names a refused save in words, not the raw error', async () => {
    reset();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mutateSpy.mockImplementation(
      (_args: unknown, options: { onError: (error: unknown) => void }) => {
        options.onError(
          new AppError({
            code: 'ORG_FORBIDDEN',
            message: 'Role "member" cannot modify governance policies.',
          }),
        );
      },
    );
    const { user } = render(
      <PersonalKeysPolicyEditor organizationId="org-1" />,
    );

    await user.click(screen.getByRole('switch', { name: LABEL }));

    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith({
        title: "Couldn't save changes",
        description: "You don't have permission to change this setting.",
        variant: 'destructive',
      }),
    );
    expect(toastSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(
      '[personalKeys toggle]',
      expect.any(AppError),
    );
    errorSpy.mockRestore();
  });

  it('falls back to its own sentence for any other failure', async () => {
    reset();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mutateSpy.mockImplementation(
      (_args: unknown, options: { onError: (error: unknown) => void }) => {
        options.onError(new Error('socket hang up'));
      },
    );
    const { user } = render(
      <PersonalKeysPolicyEditor organizationId="org-1" />,
    );

    await user.click(screen.getByRole('switch', { name: LABEL }));

    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith({
        title: "Couldn't save changes",
        description: "Couldn't save the members' personal keys setting",
        variant: 'destructive',
      }),
    );
    errorSpy.mockRestore();
  });

  it('is disabled for a viewer who cannot change the organization settings', async () => {
    reset({ canWrite: false });
    const { user } = render(
      <PersonalKeysPolicyEditor organizationId="org-1" />,
    );

    const toggle = screen.getByRole('switch', { name: LABEL });
    expect(toggle).toBeDisabled();
    expect(toggle).toBeChecked();
    await user.click(toggle);
    expect(mutateSpy).not.toHaveBeenCalled();
  });

  it('is disabled while its save is in flight', () => {
    reset({ isPending: true });
    render(<PersonalKeysPolicyEditor organizationId="org-1" />);

    expect(screen.getByRole('switch', { name: LABEL })).toBeDisabled();
  });

  it('stays disabled until a write of the policy from this tab settles', async () => {
    reset();
    let settle: () => void = () => {};
    const held = new Promise<void>((resolve) => (settle = resolve));
    // Any write of this policy from this tab, held in flight.
    void inPolicyWriteOrder('org-1', 'personal_keys', () => held);
    render(<PersonalKeysPolicyEditor organizationId="org-1" />);

    const toggle = screen.getByRole('switch', { name: LABEL });
    expect(toggle).toBeDisabled();
    settle();
    await waitFor(() => expect(toggle).toBeEnabled());
  });

  it('masks the switch while the policy loads', () => {
    reset({ isLoading: true });
    render(<PersonalKeysPolicyEditor organizationId="org-1" />);

    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: "Members' personal keys" }),
    ).toBeInTheDocument();
  });
});
