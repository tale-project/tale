// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/lib/i18n/i18n';
import { AppError } from '@/lib/shared/errors/app-error';

import { useMoveTask } from './mutations';

const mocks = vi.hoisted(() => ({
  move: vi.fn(),
  toast: vi.fn(),
  nextTask: vi.fn(),
}));
vi.mock('@/app/lib/backend/adapters', () => ({
  WRITE_ADAPTERS: { 'tasks/mutations:moveTask': { run: mocks.move } },
  activeOrganizationId: () => 'org-1',
  runAdapted: (run: () => Promise<unknown>) => run(),
}));
vi.mock('@tale/ui/use-toast', () => ({ toast: mocks.toast }));
vi.mock('./use-next-task-toast', () => ({
  useNextTaskToast: () => mocks.nextTask,
}));

beforeEach(() => vi.clearAllMocks());

function moveHook() {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  return renderHook(() => useMoveTask(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      </I18nextProvider>
    ),
  });
}

describe('board move review refusal', () => {
  it('reports one localized policy refusal from the real mutation hook without retrying', async () => {
    const refusal = new AppError({ code: 'TASK_REVIEW_POLICY_UNAVAILABLE' });
    mocks.move.mockRejectedValueOnce(refusal);
    const { result } = moveHook();
    await act(async () => {
      await expect(
        result.current.mutateAsync({ taskId: 'task-1', status: 'done' }),
      ).rejects.toBe(refusal);
    });
    expect(mocks.move).toHaveBeenCalledTimes(1);
    expect(mocks.nextTask).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        description:
          'Review policy could not be read. Restore valid organization policy before deciding.',
        variant: 'destructive',
      }),
    );
  });

  it('keeps a successful move on the normal success path', async () => {
    mocks.move.mockResolvedValueOnce({});
    const { result } = moveHook();
    await act(async () => {
      await result.current.mutateAsync({ taskId: 'task-1', status: 'done' });
    });
    await waitFor(() => expect(mocks.nextTask).toHaveBeenCalledTimes(1));
    expect(mocks.toast).not.toHaveBeenCalled();
  });
});
