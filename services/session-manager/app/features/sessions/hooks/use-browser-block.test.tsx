import { waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { failure, installFakeApi } from '@/tests/utils/fake-api';
import { meta } from '@/tests/utils/fixtures';
import { renderHookApp } from '@/tests/utils/render';

import { useBrowserBlock } from './use-browser-block';

describe('useBrowserBlock', () => {
  it('blocks nothing while the browser is installed', async () => {
    const api = installFakeApi({ 'GET /meta': meta() });
    const { result } = renderHookApp(useBrowserBlock);

    await waitFor(() => expect(api.callsTo('GET /meta')).toHaveLength(1));
    await waitFor(() => expect(result.current).toBeNull());
  });

  it('says nothing until it knows, so no control is disabled for a moment', () => {
    installFakeApi({ 'GET /meta': () => new Promise(() => {}) });
    const { result } = renderHookApp(useBrowserBlock);
    expect(result.current).toBeNull();
  });

  it('says nothing when the server cannot be asked: the connection banner speaks', async () => {
    const api = installFakeApi({ 'GET /meta': failure(502, 'http_502') });
    const { result } = renderHookApp(useBrowserBlock);

    await waitFor(() => expect(api.callsTo('GET /meta')).toHaveLength(1));
    expect(result.current).toBeNull();
  });

  it('says the browser is being installed', async () => {
    installFakeApi({
      'GET /meta': meta({ browserInstalled: false, browserInstalling: true }),
    });
    const { result } = renderHookApp(useBrowserBlock);
    await waitFor(() =>
      expect(result.current).toBe('The browser is being installed.'),
    );
  });

  it('says the browser is not installed', async () => {
    installFakeApi({ 'GET /meta': meta({ browserInstalled: false }) });
    const { result } = renderHookApp(useBrowserBlock);
    await waitFor(() =>
      expect(result.current).toBe("The browser isn't installed yet."),
    );
  });
});
