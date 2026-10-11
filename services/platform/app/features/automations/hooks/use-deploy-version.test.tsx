// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { toast } from '@tale/ui/use-toast';
import { act, type ReactElement, useLayoutEffect } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render } from '@/tests/utils/render';

import { type DeployVersion, useDeployVersion } from './use-deploy-version';

const mutateAsync = vi.hoisted(() => vi.fn());

vi.mock('@tale/ui/use-toast', () => ({ toast: vi.fn() }));
vi.mock('./mutations', () => ({
  useDeployAutomation: () => ({ mutateAsync }),
}));
vi.mock('@/app/features/settings/organization/hooks/queries', () => ({
  useMembers: () => ({
    members: [{ userId: 'user-noah', displayName: 'Noah Weber' }],
  }),
}));
vi.mock('@/app/hooks/use-current-member-context', () => ({
  useCurrentMemberContext: () => ({ data: { userId: 'user-me' } }),
}));

let api: DeployVersion;
const showDeployments = vi.fn();
const triggerOff = vi.fn();

function Harness() {
  const deployer = useDeployVersion({
    organizationId: 'org-1',
    automationSlug: 'ops/digest',
    onShowDeployments: showDeployments,
    onTriggerOff: triggerOff,
  });
  // Handed to the test once each render has committed.
  useLayoutEffect(() => {
    api = deployer;
  });
  return null;
}

type ToastCall = {
  title?: string;
  description?: string;
  variant?: string;
  action?: ReactElement<{ onClick: () => void; altText: string }>;
};

function toastCall(index = 0): ToastCall {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the mock records what the hook handed `toast`
  return vi.mocked(toast).mock.calls[index]?.[0] as ToastCall;
}

async function deploy(version: number, expected: number | null) {
  await act(async () => {
    api.deploy(version, expected);
    await Promise.resolve();
  });
}

beforeEach(() => {
  mutateAsync.mockReset();
  vi.mocked(toast).mockClear();
  showDeployments.mockReset();
  triggerOff.mockReset();
  render(<Harness />);
});

describe('useDeployVersion', () => {
  it('puts a version live against the live version on screen, with Undo', async () => {
    mutateAsync.mockResolvedValueOnce({
      name: 'ops/digest',
      version: 4,
      previousVersion: 5,
      kind: 'rollback',
      trigger: null,
    });
    await deploy(4, 5);
    expect(mutateAsync).toHaveBeenCalledWith({
      organizationId: 'org-1',
      name: 'ops/digest',
      version: 4,
      expectedDeployedVersion: 5,
    });
    const shown = toastCall();
    expect(shown).toMatchObject({
      title: 'v4 is live.',
      description: 'Runs already started keep the version they started with.',
      variant: 'success',
    });
    expect(shown.action?.props.altText).toBe('Undo: put v5 live again');

    // Undo puts the replaced version back, expecting the one just deployed,
    // and offers no undo of its own.
    mutateAsync.mockResolvedValueOnce({
      name: 'ops/digest',
      version: 5,
      previousVersion: 4,
      kind: 'deploy',
    });
    await act(async () => {
      shown.action?.props.onClick();
      await Promise.resolve();
    });
    expect(mutateAsync).toHaveBeenLastCalledWith({
      organizationId: 'org-1',
      name: 'ops/digest',
      version: 5,
      expectedDeployedVersion: 4,
    });
    // No trigger, nothing to say about it.
    expect(triggerOff).toHaveBeenLastCalledWith(null);
    expect(toastCall(1)).toMatchObject({ title: 'v5 is live again.' });
    expect(toastCall(1).action).toBeUndefined();
  });

  it('offers no undo for a first deploy, and reports a trigger left off', async () => {
    const trigger = {
      kind: 'schedule',
      enabled: false,
      nextRunAt: null,
      warnings: [],
    };
    mutateAsync.mockResolvedValueOnce({
      name: 'ops/digest',
      version: 1,
      previousVersion: null,
      kind: 'deploy',
      trigger,
    });
    await deploy(1, null);
    expect(toastCall().action).toBeUndefined();
    expect(triggerOff).toHaveBeenCalledWith(trigger);
  });

  it('says who put another version live when the deploy raced one, and changes nothing', async () => {
    const at = new Date();
    at.setHours(14, 5, 0, 0);
    mutateAsync.mockRejectedValueOnce({
      data: {
        code: 'AUTOMATION_DEPLOYMENT_STALE',
        deployedVersion: 6,
        deployedBy: 'api-key:user-noah',
        deployedAt: at.getTime(),
        deployedVia: 'mcp',
        deployedClient: 'Claude Code',
      },
    });
    await deploy(4, 5);
    const shown = toastCall();
    expect(shown.title).toBe('v4 did not go live');
    expect(shown.variant).toBe('destructive');
    expect(shown.description).toMatch(
      /^Noah Weber made v6 live at 2:05 PM\. Nothing was changed\./,
    );
    shown.action?.props.onClick();
    expect(showDeployments).toHaveBeenCalled();
  });

  it('refuses a version whose tests fail, or that fails the checks, in a dialog', async () => {
    mutateAsync.mockRejectedValueOnce({
      data: { code: 'AUTOMATION_TESTS_FAILING', message: 'tests fail' },
    });
    await deploy(3, 5);
    expect(api.refusal).toEqual({ version: 3, kind: 'testsFailing' });
    expect(toast).not.toHaveBeenCalled();

    const issue = {
      level: 'error',
      code: 'NODE_UNKNOWN_TYPE',
      message: 'unknown type',
    };
    mutateAsync.mockRejectedValueOnce({
      data: { code: 'AUTOMATION_INVALID', errors: [issue] },
    });
    await deploy(2, 5);
    expect(api.refusal).toMatchObject({ version: 2, kind: 'invalid' });
    act(() => api.closeRefusal());
    expect(api.refusal).toBeNull();
  });

  it('says any other failure in a toast with the reason', async () => {
    mutateAsync.mockRejectedValueOnce({
      data: { code: 'SOMETHING', message: 'The store is read-only.' },
    });
    await deploy(4, 5);
    expect(toastCall()).toMatchObject({
      title: 'v4 could not go live',
      description: 'The store is read-only.',
      variant: 'destructive',
    });
  });

  it('starts one deploy at a time', async () => {
    let settle: (value: unknown) => void = () => undefined;
    mutateAsync.mockReturnValueOnce(
      new Promise((resolve) => {
        settle = resolve;
      }),
    );
    await deploy(4, 5);
    expect(api.pendingVersion).toBe(4);
    await deploy(3, 5);
    expect(mutateAsync).toHaveBeenCalledTimes(1);
    await act(async () => {
      settle({ name: 'ops/digest', version: 4, previousVersion: 5 });
      await Promise.resolve();
    });
    expect(api.pendingVersion).toBeNull();
  });
});
