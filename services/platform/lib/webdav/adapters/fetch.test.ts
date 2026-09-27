// @vitest-environment node

/**
 * The adapter's dot-segment refusal: `req.url` is a parsed URL whose `..`
 * and `%2e%2e` segments the WHATWG parser folded away before the WebDAV
 * path parser could reject them, so a PUT through `<folder>/%2E%2E/x`
 * landed one level up. The route hands the adapter the raw request-target
 * and a dot-segment in it is a 404 before dispatch — the edge's answer.
 */

import { describe, expect, it, vi } from 'vitest';

import type { WebDAVCtx, WebDAVRequest, WebDAVResponse } from '../types';
import { fetchAdapter } from './fetch';

const { dispatch } = vi.hoisted(() => ({
  dispatch: vi.fn(
    (_req: WebDAVRequest, _ctx: WebDAVCtx): Promise<WebDAVResponse> =>
      Promise.resolve({ status: 207, headers: {}, body: 'ok' }),
  ),
}));
vi.mock('../handler', () => ({ dispatch }));

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the adapter never touches the backend when it refuses
const ctx = { backend: {} } as unknown as WebDAVCtx;

describe('fetchAdapter', () => {
  it('refuses a raw dot-segment with 404 before dispatch', async () => {
    dispatch.mockClear();
    // The Request's own URL is already folded (`/dav/o/documents/x`): only
    // the raw target still says what the client sent.
    const req = new Request('http://backend/dav/o/documents/folder/%2E%2E/x', {
      method: 'PUT',
      body: 'hello',
    });
    expect(new URL(req.url).pathname).toBe('/dav/o/documents/x');
    const res = await fetchAdapter(req, ctx, {
      rawTarget: '/dav/o/documents/folder/%2E%2E/x',
    });
    expect(res.status).toBe(404);
    expect(await res.text()).toBe('Not found');
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('dispatches a plain target, raw or parsed alike', async () => {
    dispatch.mockClear();
    const req = new Request('http://backend/dav/o/documents/folder/x', {
      method: 'PROPFIND',
    });
    const res = await fetchAdapter(req, ctx, {
      rawTarget: '/dav/o/documents/folder/x?depth=1',
    });
    expect(res.status).toBe(207);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls[0]?.[0]).toMatchObject({
      method: 'PROPFIND',
      pathname: '/dav/o/documents/folder/x',
    });
    await fetchAdapter(req, ctx);
    expect(dispatch).toHaveBeenCalledTimes(2);
  });
});
