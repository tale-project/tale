// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useListWorkflows, useReadWorkflow } from './file-queries';

// Regression coverage for #2668 — opening a task modal fired
// `listWorkflows` with an empty organization id (the org context resolves
// asynchronously and callers fall back to `''`), which the server rejects
// with an uncaught ORG_NOT_FOUND ConvexError. The hooks must skip the
// action entirely until the org id is truthy, like `useListAgents` does.

const listAction = vi.fn().mockResolvedValue([]);

vi.mock('convex/react', () => ({
  useAction: vi.fn(() => listAction),
  useConvexAuth: vi.fn(() => ({ isAuthenticated: true })),
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('useListWorkflows', () => {
  beforeEach(() => {
    listAction.mockClear();
  });

  it('never fires the action with an empty organization id', async () => {
    renderHook(() => useListWorkflows(''), { wrapper });
    // Give a would-be fetch a tick to fire before asserting it did not.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(listAction).not.toHaveBeenCalled();
  });

  it('fires once the organization id is available', async () => {
    renderHook(() => useListWorkflows('org-1'), { wrapper });
    await waitFor(() => expect(listAction).toHaveBeenCalledTimes(1));
    expect(listAction).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 'org-1' }),
    );
  });
});

describe('useReadWorkflow', () => {
  beforeEach(() => {
    listAction.mockClear();
  });

  it('skips on an empty organization id even when a slug is present', async () => {
    renderHook(() => useReadWorkflow('', 'my-workflow'), { wrapper });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(listAction).not.toHaveBeenCalled();
  });
});
