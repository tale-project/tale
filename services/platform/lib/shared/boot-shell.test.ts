import { describe, expect, it } from 'vitest';

import { injectBootShell, shouldServeBootShell } from './boot-shell';

describe('shouldServeBootShell', () => {
  it('serves dashboard paths, org-full or org-less', () => {
    expect(shouldServeBootShell('/dashboard')).toBe(true);
    expect(shouldServeBootShell('/dashboard/org123/chat')).toBe(true);
    expect(shouldServeBootShell('/dashboard/create-organization')).toBe(true);
  });

  it('skips everything outside the dashboard', () => {
    expect(shouldServeBootShell('/')).toBe(false);
    expect(shouldServeBootShell('/login')).toBe(false);
    // Prefix must be a real path segment, not a string prefix.
    expect(shouldServeBootShell('/dashboardish')).toBe(false);
  });

  it('honours a base path prefix', () => {
    expect(shouldServeBootShell('/tale/dashboard/org123', '/tale')).toBe(true);
    expect(shouldServeBootShell('/dashboard/org123', '/tale')).toBe(false);
  });
});

describe('injectBootShell', () => {
  it('fills the empty #root and leaves the rest untouched', () => {
    const html = '<body><div id="root"></div><script>x</script></body>';
    expect(injectBootShell(html, '<span>shell</span>')).toBe(
      '<body><div id="root"><span>shell</span></div><script>x</script></body>',
    );
  });

  it('is a no-op when the marker is missing', () => {
    const html = '<body><div id="app"></div></body>';
    expect(injectBootShell(html, '<span>shell</span>')).toBe(html);
  });
});
