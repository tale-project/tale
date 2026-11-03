import { waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ApiError } from '@/app/lib/api/client';
import { failure, installFakeApi } from '@/tests/utils/fake-api';
import { settings } from '@/tests/utils/fixtures';
import { renderHookApp } from '@/tests/utils/render';

import { useSettings } from './use-settings';

describe('useSettings', () => {
  it('reads the start page, its default and whether AI access is on', async () => {
    installFakeApi({
      'GET /settings': settings({
        startPage: 'https://duckduckgo.com',
        mcpEnabled: true,
      }),
    });
    const { result } = renderHookApp(useSettings);

    expect(result.current.data).toBeUndefined();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({
      startPage: 'https://duckduckgo.com',
      defaultStartPage: 'https://www.google.com',
      mcpEnabled: true,
    });
  });

  it('fails with the backend error, which the page words from its code', async () => {
    installFakeApi({ 'GET /settings': failure(503, 'browser_installing') });
    const { result } = renderHookApp(useSettings);

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(ApiError);
    expect(result.current.error).toMatchObject({
      status: 503,
      code: 'browser_installing',
    });
  });
});
