import { isExternalTarget, slugRoute } from '@tale/ui/docs/redirects';
import { describe, expect, it } from 'vitest';

import { firstNavSlug, flattenNav } from '@/lib/content/nav';
import { createNearMissRoute, resolveMissingUiDocsPath } from '@/lib/near-miss';
import {
  EXPLICIT_REDIRECTS,
  guidePath,
  REDIRECT_PATHS,
  resolveRedirect,
} from '@/lib/redirects';
import { listAllContent } from '@/scripts/walk-content';

/**
 * The server's answers for addresses that are not a guide: `/docs` and every
 * section folder land on a real guide with a 301 (the client used to be the
 * only one that knew — crawlers, link checkers and agents saw a 404), moved
 * guides follow `content/redirects.json`, and a guessed address lands on the
 * guide it clearly means.
 */

const guides = new Set((await listAllContent()).map(({ slug }) => slug));
const isGuidePath = (path: string) =>
  path.startsWith('/docs/') && guides.has(path.slice('/docs/'.length));

describe('ui-docs redirects', () => {
  it('sends /docs to the first guide in the navigation', () => {
    expect(resolveRedirect('/docs')).toBe(guidePath(firstNavSlug()));
    expect(resolveRedirect('/docs/')).toBe(guidePath(firstNavSlug()));
    expect(resolveRedirect('/docs.md')).toBe(`${guidePath(firstNavSlug())}.md`);
  });

  it('sends every section folder to a real guide under it', () => {
    const folders = new Set(
      flattenNav().flatMap(({ slug }) => {
        const segments = slugRoute(slug).split('/');
        return segments
          .slice(1)
          .map((_, depth) => segments.slice(0, depth + 1).join('/'));
      }),
    );
    for (const folder of folders) {
      if (guides.has(folder)) continue;
      const target = resolveRedirect(guidePath(folder));
      expect(target, `/docs/${folder}`).not.toBeNull();
      expect(isGuidePath(target ?? ''), `/docs/${folder} → ${target}`).toBe(
        true,
      );
      expect(target?.startsWith(`/docs/${folder}/`)).toBe(true);
    }
  });

  it('keeps every explicit redirect pointed at a guide, never at a redirect', () => {
    for (const [from, to] of Object.entries(EXPLICIT_REDIRECTS)) {
      expect(guides.has(from), `"${from}" is still a guide`).toBe(false);
      if (isExternalTarget(to)) continue;
      expect(isGuidePath(guidePath(to)), `"${from}" → "${to}"`).toBe(true);
    }
    for (const [from, to] of REDIRECT_PATHS) {
      expect(REDIRECT_PATHS.has(to), `${from} → ${to} chains`).toBe(false);
    }
  });

  it('leaves a guide itself alone', () => {
    expect(resolveRedirect('/docs/components/button')).toBeNull();
  });
});

describe('ui-docs near misses', () => {
  it.each([
    ['/docs/button', '/docs/components/button', false],
    ['/docs/components/buton', '/docs/components/button', false],
    ['/components/button', '/docs/components/button', true],
    ['/DE/docs/components/button', '/docs/components/button', true],
    ['/docs/Components/Button.md', '/docs/components/button.md', true],
    ['/docs/foundations/colours', '/docs/foundations/colors', false],
    // A sidebar group by the label the chrome shows it under.
    ['/docs/komponenten', '/docs/components/button', false],
    ['/docs/grundlagen', '/docs/foundations/colors', false],
    ['/docs/demarrer', '/docs/getting-started/introduction', false],
    ['/docs/marketing-ui', '/docs/marketing-ui/overview', true],
  ])('sends %s to %s', (address, location, permanent) => {
    expect(resolveMissingUiDocsPath(address)).toEqual({ location, permanent });
  });

  it.each([
    '/docs/does-not-exist',
    '/docs/components/select',
    '/assets/index-0000.js',
    '/wp-login.php',
  ])('leaves %s to the 404 page', (address) => {
    expect(resolveMissingUiDocsPath(address)).toBeNull();
  });

  it('answers under the mount prefix, only for GET and HEAD', () => {
    const route = createNearMissRoute('/ui');
    const call = (path: string, method = 'GET') => {
      const url = new URL(path, 'https://ui.example.test');
      return route(new Request(url, { method }), url);
    };
    expect(call('/docs/button')?.headers.get('location')).toBe(
      '/ui/docs/components/button',
    );
    expect(call('/docs/button', 'POST')).toBeNull();
  });
});
