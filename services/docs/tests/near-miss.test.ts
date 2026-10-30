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
    ['/de/selbst-gehostet/installation', '/de/self-hosted/install'],
    [
      '/de/selbst-gehostet/konfiguration',
      '/de/self-hosted/configuration/environment-reference',
    ],
    ['/fr/plateforme/gouvernance', '/fr/platform/admin/governance/audit-logs'],
  ])('sends the sidebar label %s to its section %s', (guess, page) => {
    expect(resolveMissingDocsPath(guess, paths)).toEqual({
      location: page,
      permanent: false,
    });
  });

  it.each([
    [
      '/de/self-hosted/genehmigungen',
      '/de/self-hosted/configuration/approvals',
    ],
    ['/de/self-hosted/starten', '/de/self-hosted/install/quickstart'],
    ['/de/self-hosted/video', '/de/self-hosted/configuration/video-ingestion'],
    ['/de/cloud/sicherheit', '/de/cloud/trust-and-compliance'],
  ])(
    'keeps the folder named by %s instead of an unrelated sidebar section',
    (guess, page) => {
      expect(resolveMissingDocsPath(guess, paths)).toEqual({
        location: page,
        permanent: false,
      });
    },
  );

  it.each([
    ['/de/automatisierungen/erstellen', '/de/platform/automations/catalog'],
    ['/automations/create', '/platform/automations/catalog'],
    ['/de/verwaltung/sandbox', '/de/platform/admin/sandboxes'],
    ['/de/selbst-gehostet/installieren', '/de/self-hosted/install/quickstart'],
  ])(
    'keeps the previously resolved guess %s after indexing sidebar labels',
    (guess, page) => {
      expect(resolveMissingDocsPath(guess, paths)).toEqual({
        location: page,
        permanent: false,
      });
    },
  );

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
    '/de/xyz/verwaltung',
    '/chat-zzzz',
    '/x/y/z/deep/garbage',
    '/assets/index-0000.js',
    '/.env',
  ])('leaves %s to the 404 page', (address) => {
    expect(resolveMissingDocsPath(address, paths)).toBeNull();
  });
});

/**
 * Addresses a model writes by translating a whole path (#5037): each folder
 * is read as the site's own under its sidebar label, the leaf as a page or
 * section there. The first two were reported from a pilot.
 */
describe('guesses that translate a whole path', () => {
  // Each answered 404 before the folders were read as the site's own.
  it.each([
    ['/de/plattform/skills', '/de/platform/workspace/skills'],
    ['/de/plattform/wissen/webseiten', '/de/platform/knowledge/crawling'],
    ['/platform/skills', '/platform/workspace/skills'],
    ['/fr/plateforme/skills', '/fr/platform/workspace/skills'],
    ['/de/wissen/webseiten', '/de/platform/knowledge/crawling'],
    [
      '/de/plattform/wissen/wissenseintraege',
      '/de/platform/knowledge/knowledge-entries',
    ],
    ['/de/plattform/projekte/aufgaben', '/de/platform/projects/tasks'],
    [
      '/de/plattform/projekte/projektagenten',
      '/de/platform/projects/project-agents',
    ],
    ['/de/plattform/konnektoren', '/de/platform/connectors/overview'],
    ['/fr/plateforme/connecteurs', '/fr/platform/connectors/overview'],
  ])('lands %s on %s', (guess, page) => {
    expect(resolveMissingDocsPath(guess, paths)).toEqual({
      location: page,
      permanent: false,
    });
  });

  // Each landed on a page of another section, one the guess's folders do
  // not hold, which ends in the same leaf or carries the title.
  it.each([
    ['/fr/plateforme/agents', '/fr/platform/agents/concepts'],
    ['/de/plattform/connectors', '/de/platform/connectors/overview'],
    ['/de/plattform/verwaltung/anbieter', '/de/platform/admin/providers'],
    [
      '/fr/plateforme/automatisations/modeles',
      '/fr/platform/automations/templates',
    ],
  ])('keeps %s in the section it names: %s', (guess, page) => {
    expect(resolveMissingDocsPath(guess, paths)).toEqual({
      location: page,
      permanent: false,
    });
  });

  // Translations that already landed, kept landing.
  it.each([
    ['/de/plattform/agenten', '/de/platform/agents/concepts'],
    ['/de/plattform/agenten/skills', '/de/platform/agents/skills'],
    ['/de/plattform/wissen', '/de/platform/knowledge/overview'],
    ['/de/plattform/wissen/dokumente', '/de/platform/knowledge/documents'],
    ['/de/plattform/projekte', '/de/platform/projects/overview'],
    [
      '/de/plattform/automatisierungen/vorlagen',
      '/de/platform/automations/templates',
    ],
    ['/de/plattform/chat/sprachmodus', '/de/platform/chat/voice-mode'],
    ['/de/plattform/genehmigungen', '/de/platform/approvals/concepts'],
    ['/de/verwaltung/api-schluessel', '/de/platform/admin/api-keys'],
    ['/de/plattform/verwaltung/teams', '/de/platform/admin/teams'],
    [
      '/de/plattform/verwaltung/papierkorb',
      '/de/platform/admin/governance/trash',
    ],
    ['/de/plattform/mitglied/einstellungen', '/de/platform/member/preferences'],
    [
      '/de/selbst-gehostet/installation/kubernetes',
      '/de/self-hosted/install/kubernetes',
    ],
    [
      '/de/selbst-gehostet/konfiguration/umgebungsvariablen',
      '/de/self-hosted/configuration/environment-reference',
    ],
    [
      '/de/selbst-gehostet/betrieb/backups',
      '/de/self-hosted/operate/backups-and-restore',
    ],
    ['/de/entwicklung/api-referenz', '/de/develop/api-reference'],
    ['/de/cloud/abrechnung', '/de/cloud/billing'],
    [
      '/fr/plateforme/connaissances/sites-web',
      '/fr/platform/knowledge/crawling',
    ],
    [
      '/fr/plateforme/administration/membres-et-roles',
      '/fr/platform/admin/members-and-roles',
    ],
    ['/fr/plateforme/administration/cles-api', '/fr/platform/admin/api-keys'],
    [
      '/fr/auto-heberge/configuration/fournisseurs',
      '/fr/self-hosted/configuration/providers',
    ],
    ['/fr/developpement/reference-api', '/fr/develop/api-reference'],
    ['/platform/knowledge/websites', '/platform/knowledge/crawling'],
  ])('still lands %s on %s', (guess, page) => {
    expect(resolveMissingDocsPath(guess, paths)).toEqual({
      location: page,
      permanent: false,
    });
  });

  it('follows a moved page its translated folders name', () => {
    // `platform/automations/workflows` moved to the editor's page.
    expect(
      resolveMissingDocsPath(
        '/de/plattform/automatisierungen/workflows',
        paths,
      ),
    ).toEqual({
      location: '/de/platform/automations/editor',
      permanent: false,
    });
  });

  it('finds a page the guess files under the wrong section', () => {
    expect(
      resolveMissingDocsPath('/de/plattform/installation/kubernetes', paths),
    ).toEqual({
      location: '/de/self-hosted/install/kubernetes',
      permanent: false,
    });
  });

  // A section the folders name, nothing in it the leaf names: the section's
  // first page lists what it holds, where a 404 left the reader stranded.
  it.each([
    ['/de/verwaltung/xyz', '/de/platform/admin/overview'],
    ['/de/plattform/xyz', '/de/platform'],
    ['/platform/chat/zzzz', '/platform/chat/overview'],
    [
      '/de/selbst-gehostet/konfiguration/xyz',
      '/de/self-hosted/configuration/environment-reference',
    ],
    ['/de/plattform/wissen/xyz.md', '/de/platform/knowledge/overview.md'],
  ])('sends %s to the section it names, %s', (guess, page) => {
    expect(resolveMissingDocsPath(guess, paths)).toEqual({
      location: page,
      permanent: false,
    });
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

  it.each([
    [
      '/de/self-hosted/genehmigungen.md?ref=chat',
      '/docs/de/self-hosted/configuration/approvals.md?ref=chat',
    ],
    [
      '/de/automatisierungen/erstellen.md?ref=chat',
      '/docs/de/platform/automations/catalog.md?ref=chat',
    ],
    [
      '/de/plattform/wissen/webseiten?ref=chat',
      '/docs/de/platform/knowledge/crawling?ref=chat',
    ],
    [
      '/de/verwaltung/xyz?ref=chat',
      '/docs/de/platform/admin/overview?ref=chat',
    ],
  ])(
    'keeps the repaired guess %s through the route boundary',
    (path, location) => {
      const response = call(path, { method: 'HEAD' });
      expect(response?.status).toBe(302);
      expect(response?.headers.get('location')).toBe(location);
    },
  );

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
