import { describe, expect, it } from 'vitest';

import {
  DOCS_URL,
  GET_STARTED_URL,
  SELF_HOSTED_QUICKSTART_URL,
} from './docs-url';

describe('docs-url', () => {
  // Regression: the docs site moved to its own host. While the default was
  // still `https://tale.dev/docs`, every marketing page linked to a URL that
  // 308-redirects, which Ahrefs reports as "Page has links to redirect".
  it('links to the docs subdomain, not a /docs subpath', () => {
    expect(DOCS_URL).toBe('https://docs.tale.dev');
    expect(DOCS_URL).not.toContain('tale.dev/docs');
  });

  it('points Get started at the Start-tab quickstart, not self-hosted install', () => {
    expect(GET_STARTED_URL).toBe(`${DOCS_URL}/get-started/quickstart`);
    expect(GET_STARTED_URL).not.toContain('self-hosted/install');
  });

  it('points the homepage terminal at the self-hosted install quickstart', () => {
    expect(SELF_HOSTED_QUICKSTART_URL).toBe(
      `${DOCS_URL}/self-hosted/install/quickstart`,
    );
  });
});
