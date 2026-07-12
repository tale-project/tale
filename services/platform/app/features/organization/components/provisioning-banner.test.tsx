import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { toast } from '@/app/hooks/use-toast';
import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor } from '@/tests/utils/render';

import { ProvisioningBanner } from './provisioning-banner';

// getProvisioningStatus probe (useActionQuery → convex/react useAction).
const getStatus = vi.fn();
vi.mock('convex/react', () => ({
  useAction: () => getStatus,
  useConvexAuth: () => ({ isAuthenticated: true }),
}));

// retryProvisioning (useConvexAction → @convex-dev/react-query).
const retry = vi.fn();
vi.mock('@convex-dev/react-query', () => ({
  useConvexAction: () => retry,
}));

let canDeveloperSettings = true;
vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({ can: () => canDeveloperSettings }),
}));

vi.mock('@/app/hooks/use-toast', () => ({
  toast: vi.fn(),
}));

const UNPROVISIONED = { provisioned: false, missingDomains: ['providers'] };
const PROVISIONED = { provisioned: true, missingDomains: [] };

function renderBanner() {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <ProvisioningBanner organizationId="org-1" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  canDeveloperSettings = true;
});

describe('ProvisioningBanner (#2636)', () => {
  it('surfaces the unfinished-setup state to admins with a Retry action', async () => {
    getStatus.mockResolvedValue(UNPROVISIONED);
    const { container } = renderBanner();

    expect(
      await screen.findByText("This workspace didn't finish setting up"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Retry setup' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
    await checkAccessibility(container);
  });

  it('renders nothing when the org is fully provisioned', async () => {
    getStatus.mockResolvedValue(PROVISIONED);
    renderBanner();

    await waitFor(() => expect(getStatus).toHaveBeenCalled());
    expect(
      screen.queryByText("This workspace didn't finish setting up"),
    ).not.toBeInTheDocument();
  });

  it('never probes (nor renders) for roles without developer-settings access — the server action would reject them', async () => {
    canDeveloperSettings = false;
    getStatus.mockResolvedValue(UNPROVISIONED);
    renderBanner();

    expect(
      screen.queryByText("This workspace didn't finish setting up"),
    ).not.toBeInTheDocument();
    expect(getStatus).not.toHaveBeenCalled();
  });

  it('Retry repairs the org: success toast, re-probe, banner clears', async () => {
    getStatus
      .mockResolvedValueOnce(UNPROVISIONED)
      .mockResolvedValue(PROVISIONED);
    retry.mockResolvedValue({ ok: true, failedDomains: [] });

    const { user } = renderBanner();
    await user.click(
      await screen.findByRole('button', { name: 'Retry setup' }),
    );

    await waitFor(() =>
      expect(retry).toHaveBeenCalledWith({ organizationId: 'org-1' }),
    );
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith({
        title: 'Workspace setup finished.',
        variant: 'success',
      }),
    );
    // The re-probe reports provisioned — the banner self-clears.
    await waitFor(() =>
      expect(
        screen.queryByText("This workspace didn't finish setting up"),
      ).not.toBeInTheDocument(),
    );
  });

  it('a failed retry keeps the banner and reports the failure', async () => {
    getStatus.mockResolvedValue(UNPROVISIONED);
    retry.mockResolvedValue({ ok: false, failedDomains: ['providers'] });

    const { user } = renderBanner();
    await user.click(
      await screen.findByRole('button', { name: 'Retry setup' }),
    );

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith({
        title: 'Setup failed again. Check the server logs, then retry.',
        variant: 'destructive',
      }),
    );
    expect(
      screen.getByText("This workspace didn't finish setting up"),
    ).toBeInTheDocument();
  });
});
