import { focusManager, QueryClientProvider } from '@tanstack/react-query';
import { act, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { metaQuery, useMeta } from '@/app/hooks/use-meta';
import { installFakeApi } from '@/tests/utils/fake-api';
import { meta } from '@/tests/utils/fixtures';

import { queryClient } from './query-client';

afterEach(() => {
  queryClient.clear();
});

function Page() {
  useMeta();
  return null;
}

describe('the query client of the app', () => {
  it('does not ask again for what a route loader read a moment before the page mounted', async () => {
    const api = installFakeApi({ 'GET /meta': meta() });
    // What the root route's loader does before the first frame.
    await queryClient.ensureQueryData(metaQuery());

    render(
      <QueryClientProvider client={queryClient}>
        <Page />
      </QueryClientProvider>,
    );
    await act(async () => {});

    expect(queryClient.isFetching()).toBe(0);
    expect(api.callsTo('GET /meta')).toHaveLength(1);
  });

  it('asks again when the window comes back, however recent the answer: a change made elsewhere shows at once', async () => {
    const api = installFakeApi({ 'GET /meta': meta() });
    await queryClient.ensureQueryData(metaQuery());
    render(
      <QueryClientProvider client={queryClient}>
        <Page />
      </QueryClientProvider>,
    );
    await act(async () => {});

    act(() => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });

    await waitFor(() => expect(api.callsTo('GET /meta')).toHaveLength(2));
    focusManager.setFocused(undefined);
  });
});
