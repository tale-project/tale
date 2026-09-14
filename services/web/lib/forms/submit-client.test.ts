import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SubmitRequest } from './schemas';

const contact: SubmitRequest = {
  form: 'contact',
  payload: {
    name: 'Private Person',
    email: 'private@example.com',
    company: 'Private Company',
    message: 'Private contact message',
    privacy: true,
    website: '',
    startedAt: 0,
  },
};
let submitForm: typeof import('./submit-client').submitForm;
const track = vi.fn((_payload: unknown) => Promise.resolve());

beforeEach(async () => {
  vi.resetModules();
  const config = document.createElement('script');
  config.id = 'tale-analytics';
  config.type = 'application/json';
  config.textContent = JSON.stringify({
    websiteId: '11111111-1111-4111-8111-111111111111',
    proxyPath: '/_a',
  });
  document.head.append(config);
  window.umami = { track };
  const { startBrowserAnalytics } = await import('@tale/ui/analytics/browser');
  startBrowserAnalytics(
    (resolved) => {
      resolved();
      return () => {};
    },
    () => '/contact',
  );
  document
    .querySelector('script[src*="/_a/"]')!
    .dispatchEvent(new Event('load'));
  track.mockClear();
  ({ submitForm } = await import('./submit-client'));
});

afterEach(() => {
  document
    .querySelectorAll('#tale-analytics, script[src*="/_a/"]')
    .forEach((element) => element.remove());
  delete window.umami;
  track.mockReset();
  vi.unstubAllGlobals();
});

describe('marketing conversion analytics', () => {
  it('reports the completed form type without contact data', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({ ok: true })),
    );
    expect(await submitForm(contact)).toEqual({ ok: true });
    expect(track).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ name: 'contact-submitted', url: '/contact' }),
    );
    expect(JSON.stringify(track.mock.calls)).not.toContain('Private');
    expect(JSON.stringify(track.mock.calls)).not.toContain('private@example');
  });

  it('does not report a rejected submission', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ error: 'not_configured' }, { status: 503 }),
        ),
    );
    expect((await submitForm(contact)).ok).toBe(false);
    expect(track).not.toHaveBeenCalled();
  });

  it.each(['throw', 'reject'])(
    'keeps an accepted submission successful when the tracker fails with %s',
    async (failure) => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(Response.json({ ok: true })),
      );
      track.mockImplementation(() => {
        if (failure === 'throw') throw new Error('Tracker storage unavailable');
        return Promise.reject(new Error('Tracker transport unavailable'));
      });
      expect(await submitForm(contact)).toEqual({ ok: true });
      await Promise.resolve();
      expect(track).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ name: 'contact-submitted' }),
      );
    },
  );
});
