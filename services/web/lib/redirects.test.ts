import { describe, expect, it } from 'vitest';

import { EXTERNAL_LINKS } from './external-links';
import {
  handleWebRedirect,
  resolveWebRedirect,
  UI_DOCS_ENTRY_PATHS,
} from './redirects';

describe('UI documentation entry redirect', () => {
  for (const path of UI_DOCS_ENTRY_PATHS) {
    for (const method of ['GET', 'HEAD']) {
      it(`${method} ${path} permanently redirects to Tale UI and preserves the query`, () => {
        const url = new URL(`${path}/?source=footer`, 'https://tale.dev');
        const response = handleWebRedirect(new Request(url, { method }), url);
        expect(response?.status).toBe(301);
        expect(response?.headers.get('Location')).toBe(
          `${EXTERNAL_LINKS.uiDocs}?source=footer`,
        );
        expect(response?.body).toBeNull();
      });
    }
  }

  it('does not redirect submissions or paths outside the aliases', () => {
    const url = new URL('/ui', 'https://tale.dev');
    expect(
      handleWebRedirect(new Request(url, { method: 'POST' }), url),
    ).toBeNull();
    for (const path of ['/ui/button', '/ui-other', '/de//ui', '/%75i']) {
      expect(resolveWebRedirect(path)).toBeNull();
    }
  });
});

describe('retired hardware pricing redirect', () => {
  for (const [from, to] of [
    ['/hardware-pricing', '/pricing'],
    ['/de/hardware-pricing', '/de/pricing'],
    ['/fr/hardware-pricing', '/fr/pricing'],
  ] as const) {
    for (const method of ['GET', 'HEAD'] as const) {
      it(`${method} ${from} redirects to ${to} and preserves the query`, () => {
        const url = new URL(`${from}?source=legacy`, 'https://tale.dev');
        const response = handleWebRedirect(new Request(url, { method }), url);
        expect(response?.status).toBe(301);
        expect(response?.headers.get('Location')).toBe(`${to}?source=legacy`);
        expect(response?.body).toBeNull();
      });
    }
  }
});
