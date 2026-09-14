import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { analyticsRouteTemplate, initBrowserAnalytics } from './browser';
import { ANALYTICS_CONFIG_ID } from './config';

const websiteId = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  window.history.replaceState(
    {},
    '',
    '/dashboard/PRIVATE_ORG/chats/PRIVATE_CHAT?secret=PRIVATE_QUERY#PRIVATE_HASH',
  );
  document.title = 'PRIVATE_DOCUMENT';
  const config = document.createElement('script');
  config.id = ANALYTICS_CONFIG_ID;
  config.type = 'application/json';
  config.textContent = JSON.stringify({ websiteId, proxyPath: '/_a' });
  document.head.append(config);
  Object.defineProperty(document, 'referrer', {
    configurable: true,
    value: 'https://search.example/PRIVATE_REFERRER?q=secret',
  });
  window.umami = { track: vi.fn().mockResolvedValue(undefined) };
});

afterEach(() => {
  document
    .querySelectorAll(`#${ANALYTICS_CONFIG_ID}, script[src*="/_a/"]`)
    .forEach((element) => element.remove());
  delete window.umami;
  Reflect.deleteProperty(window.navigator, 'doNotTrack');
  Reflect.deleteProperty(window.navigator, 'globalPrivacyControl');
  vi.restoreAllMocks();
});

describe('optional browser analytics', () => {
  it('loads no tracker when disabled, malformed or opted out by DNT/GPC', () => {
    document.getElementById(ANALYTICS_CONFIG_ID)!.textContent = '{}';
    expect(initBrowserAnalytics()).toBeUndefined();
    document.getElementById(ANALYTICS_CONFIG_ID)!.textContent = '{';
    expect(initBrowserAnalytics()).toBeUndefined();
    document.getElementById(ANALYTICS_CONFIG_ID)!.remove();
    expect(initBrowserAnalytics()).toBeUndefined();
    expect(document.querySelector('script[src*="/_a/"]')).toBeNull();
  });

  it.each(['doNotTrack', 'globalPrivacyControl'])(
    'honors %s before loading the tracker',
    (property) => {
      Object.defineProperty(window.navigator, property, {
        configurable: true,
        value: property === 'doNotTrack' ? '1' : true,
      });
      expect(initBrowserAnalytics()).toBeUndefined();
      expect(document.querySelector('script[src*="/_a/"]')).toBeNull();
    },
  );

  it('uses only manual full payloads, redacts private routing and counts SPA navigation once', () => {
    const analytics = initBrowserAnalytics();
    const path = analyticsRouteTemplate('/dashboard/$id/chats/$chatId');
    analytics?.page(path);
    analytics?.page(path);
    const script = document.querySelector<HTMLScriptElement>(
      'script[src*="/_a/"]',
    )!;
    expect(script.dataset.autoTrack).toBe('false');
    expect(script.dataset.fetchCredentials).toBe('omit');
    expect(script.referrerPolicy).toBe('no-referrer');
    expect(window.umami?.track).not.toHaveBeenCalled();
    script.dispatchEvent(new Event('load'));
    expect(window.umami?.track).toHaveBeenCalledTimes(1);
    window.history.replaceState(
      {},
      '',
      '/dashboard/PRIVATE_ORG/chats/ANOTHER_CHAT?secret=VALUE',
    );
    analytics?.page(path);
    expect(window.umami?.track).toHaveBeenCalledTimes(2);
    window.history.replaceState(
      {},
      '',
      '/dashboard/PRIVATE_ORG/chats/ANOTHER_CHAT?changed=VALUE#other',
    );
    analytics?.page(path);
    expect(window.umami?.track).toHaveBeenCalledTimes(2);
    const calls = vi.mocked(window.umami!.track).mock.calls;
    expect(calls[0][0]).toMatchObject({
      website: websiteId,
      url: '/dashboard/:id/chats/:chatId',
      referrer: 'https://search.example',
    });
    expect(calls[1][0].referrer).toBe('');
    expect(JSON.stringify(calls)).not.toMatch(
      /PRIVATE_|ANOTHER_CHAT|secret|title|identity/,
    );
    analytics?.page(undefined);
    analytics?.event('contact-submitted');
    expect(window.umami?.track).toHaveBeenCalledTimes(2);
    expect(analyticsRouteTemplate('/dashboard/$id/$')).toBeUndefined();
  });

  it('counts only the named completed outcome, without form data', () => {
    const analytics = initBrowserAnalytics();
    analytics?.page('/contact');
    document
      .querySelector('script[src*="/_a/"]')!
      .dispatchEvent(new Event('load'));
    analytics?.event('contact-submitted');
    expect(window.umami?.track).toHaveBeenLastCalledWith(
      expect.objectContaining({ name: 'contact-submitted', url: '/contact' }),
    );
    expect(vi.mocked(window.umami!.track).mock.calls[1][0]).not.toHaveProperty(
      'data',
    );
  });
});
