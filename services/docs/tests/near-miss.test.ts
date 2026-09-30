import { describe, expect, it } from 'vitest';

import { createNearMissRoute, resolveMissingDocsPath } from '@/lib/near-miss';
import { buildRedirectPathMap } from '@/lib/redirects';

/**
 * The docs server's last answer before its 404 page, against the real pages
 * and titles. The first cases are addresses Tale's own chat agent guessed
 * while answering a German question — titles turned into slugs, folders
 * translated — each of which answered 404 before this route existed.
 */
const paths = buildRedirectPathMap();

describe('near misses on the real docs', () => {
  it.each([
    [
      '/de/self-hosted/configuration/retention-limits',
      '/de/self-hosted/configuration/retention',
    ],
    [
      '/de/verwaltung/mitglieder-und-rollen',
      '/de/platform/admin/members-and-roles',
    ],
    [
      '/de/plattform/automatisierungen/automatisierungen-erstellen-oder-importieren',
      '/de/platform/automations/catalog',
    ],
    [
      '/de/verwaltung/administration/mitglieder-und-rollen',
      '/de/platform/admin/members-and-roles',
    ],
    [
      '/de/administration/members-and-roles',
      '/de/platform/admin/members-and-roles',
    ],
    [
      '/de/platform/automations/automation-concepts',
      '/de/platform/automations/concepts',
    ],
    [
      '/de/platform/automations/create-or-import-automations',
      '/de/platform/automations/catalog',
    ],
    [
      '/de/plattform/automatisierungen/automatisierungskonzepte',
      '/de/platform/automations/concepts',
    ],
  ])('sends the guess %s to %s', (guess, page) => {
    expect(resolveMissingDocsPath(guess, paths)).toEqual({
      location: page,
      permanent: false,
    });
  });

  // A sidebar group guessed by its label. `Verwaltung` is the German label
  // of the admin group and the title of no page, so `/de/verwaltung` stayed
  // a 404 while every page under it was already found.
  it.each([
    ['/de/verwaltung', '/de/platform/admin/overview'],
    ['/de/plattform/verwaltung', '/de/platform/admin/overview'],
    ['/de/verwaltung/governance', '/de/platform/admin/governance/audit-logs'],
    ['/de/plattform/automatisierungen', '/de/platform/automations/concepts'],
    ['/de/selbst-gehostet', '/de/self-hosted'],
    ['/de/entwicklung', '/de/develop/overview'],
    ['/fr/plateforme/automatisations', '/fr/platform/automations/concepts'],
    ['/governance', '/platform/admin/governance/audit-logs'],
    // The tutorials carry a group of the same label: its folder picks it.
    ['/de/tutorials/verwaltung', '/de/tutorials/admin/connect-local-provider'],
    // The label as the folder of a page under it.
    ['/de/verwaltung/rollen', '/de/platform/admin/members-and-roles'],
    ['/de/verwaltung/uebersicht', '/de/platform/admin/overview'],
  ])('sends the sidebar label %s to its section %s', (guess, page) => {
    expect(resolveMissingDocsPath(guess, paths)).toEqual({
      location: page,
      permanent: false,
    });
  });

  it('keeps the Markdown export an agent asked for', () => {
    expect(
      resolveMissingDocsPath(
        '/fr/platform/automations/automation-concepts.md',
        paths,
      ),
    ).toEqual({
      location: '/fr/platform/automations/concepts.md',
      permanent: false,
    });
  });

  it('folds a retired regional tree onto the page with a 301', () => {
    expect(
      resolveMissingDocsPath('/de-CH/platform/admin/members-and-roles', paths),
    ).toEqual({
      location: '/de/platform/admin/members-and-roles',
      permanent: true,
    });
    expect(resolveMissingDocsPath('/de-AT/use/chat/basics', paths)).toEqual({
      location: '/de/platform/chat/basics',
      permanent: true,
    });
  });

  it.each([
    '/wp-login.php',
    '/de/foo/bar-baz',
    '/de/verwaltung/xyz',
    '/assets/index-0000.js',
    '/.env',
  ])('leaves %s to the 404 page', (address) => {
    expect(resolveMissingDocsPath(address, paths)).toBeNull();
  });
});

describe('near-miss route', () => {
  const route = createNearMissRoute({ paths, basePath: '/docs' });
  const call = (path: string, init?: RequestInit) => {
    const url = new URL(path, 'https://docs.example.test');
    return route(new Request(url, init), url);
  };

  it('answers a guess with a 302 under the mount prefix, keeping the query', () => {
    const response = call('/de/verwaltung/mitglieder-und-rollen?ref=chat');
    expect(response?.status).toBe(302);
    expect(response?.headers.get('location')).toBe(
      '/docs/de/platform/admin/members-and-roles?ref=chat',
    );
  });

  it('answers a normalized address with a 301 and leaves the rest alone', () => {
    expect(call('/fr-CH/cloud/billing')?.status).toBe(301);
    expect(call('/fr-CH/cloud/billing')?.headers.get('location')).toBe(
      '/docs/fr/cloud/billing',
    );
    expect(
      call('/de/verwaltung/mitglieder-und-rollen', { method: 'POST' }),
    ).toBeNull();
    expect(call('/nothing/like/this')).toBeNull();
  });

  it('sends a page that left the site straight there', () => {
    const response = call('/de-CH/legal/privacy-policy');
    expect(response?.status).toBe(301);
    expect(response?.headers.get('location')).toBe(
      'https://tale.dev/de/legal/privacy-policy',
    );
  });
});
