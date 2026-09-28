// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import { logInRedirectUrl, redirectToLogIn } from './log-in-redirect';

const realLocation = window.location;

afterEach(() => {
  delete window.__ENV__;
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: realLocation,
  });
  window.history.replaceState(null, '', '/');
});

describe('logInRedirectUrl', () => {
  it('carries the page, its query and its hash back through sign-in', () => {
    window.history.replaceState(
      null,
      '',
      '/dashboard/org-1/products?view=grid#top',
    );
    expect(logInRedirectUrl()).toBe(
      `/log-in?redirectTo=${encodeURIComponent('/dashboard/org-1/products?view=grid#top')}`,
    );
  });

  it('names why when there is a reason, under the deployment base path', () => {
    window.__ENV__ = { BASE_PATH: '/tale' };
    window.history.replaceState(null, '', '/tale/dashboard/org-1/contacts');
    expect(logInRedirectUrl('session-ended')).toBe(
      `/tale/log-in?redirectTo=${encodeURIComponent('/dashboard/org-1/contacts')}&reason=session-ended`,
    );
  });
});

describe('redirectToLogIn', () => {
  it('leaves the app by a full load, not a router navigation', () => {
    window.history.replaceState(null, '', '/dashboard/org-1/websites');
    // jsdom cannot navigate; a plain object records the assignment.
    const target = {
      href: '',
      pathname: window.location.pathname,
      search: '',
      hash: '',
    };
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: target,
    });
    redirectToLogIn('session-ended');
    expect(target.href).toBe(
      `/log-in?redirectTo=${encodeURIComponent('/dashboard/org-1/websites')}&reason=session-ended`,
    );
  });
});
