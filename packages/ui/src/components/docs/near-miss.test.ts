import { describe, expect, it } from 'vitest';

import {
  buildNearMissIndex,
  rankNearMisses,
  resolveMissingAddress,
  resolveNearMiss,
  type MissingAddressSite,
  type NearMissNavGroup,
  type NearMissPage,
} from './near-miss';

// A slice of the product docs, titles in the three locales the site ships.
const PAGE_LIST: NearMissPage[] = [
  { route: '', titles: ['Tale documentation', 'Tale-Dokumentation'] },
  { route: 'platform', titles: ['Platform', 'Plattform', 'Plateforme'] },
  {
    route: 'platform/admin/members-and-roles',
    titles: ['Members and roles', 'Mitglieder und Rollen', 'Membres et rôles'],
  },
  { route: 'platform/admin/overview', titles: ['Administration'] },
  { route: 'platform/admin/teams', titles: ['Teams', 'Teams', 'Équipes'] },
  {
    route: 'platform/admin/governance/audit-logs',
    titles: ['Review audit logs', 'Audit-Logs prüfen'],
  },
  {
    route: 'platform/admin/governance/policies-and-limits',
    titles: ['Policies and limits', 'Richtlinien und Limits'],
  },
  {
    route: 'platform/automations/concepts',
    titles: [
      'Automation concepts',
      'Automatisierungskonzepte',
      'Concepts d’automatisation',
    ],
  },
  {
    route: 'platform/automations/catalog',
    titles: [
      'Create or import an automation',
      'Automatisierungen erstellen oder importieren',
      'Créer ou importer une automatisation',
    ],
  },
  { route: 'platform/projects/concepts', titles: ['Project concepts'] },
  { route: 'platform/chat/overview', titles: ['Chat'] },
  { route: 'platform/chat/basics', titles: ['Ask questions in chat'] },
  { route: 'platform/chat/arena-mode', titles: ['Compare models in Arena'] },
  {
    route: 'self-hosted/configuration/environment-reference',
    titles: ['Environment reference'],
  },
  {
    route: 'self-hosted/configuration/retention',
    titles: ['Configure retention bounds', 'Aufbewahrungsgrenzen festlegen'],
  },
  {
    route: 'self-hosted/configuration/approvals',
    titles: ['Set automation approval rules'],
  },
  { route: 'self-hosted/install', titles: ['Choose an installation method'] },
  {
    route: 'self-hosted/install/quickstart',
    titles: ['Run your first self-hosted instance'],
  },
  {
    route: 'tutorials/admin/connect-local-provider',
    titles: ['Connect a local model server'],
  },
  {
    route: 'tutorials/admin/meeting-transcription',
    titles: ['Transcribe a meeting'],
  },
  {
    route: 'tutorials/videos/people-roles-and-teams',
    titles: ['People, roles and teams', 'Personen, Rollen und Teams'],
  },
];

// The sidebar over those pages, each group labelled as the three locales
// spell it. No page is titled `Verwaltung` — it is a group label only — and
// two groups carry it.
const NAV: NearMissNavGroup[] = [
  { labels: ['Start'], entries: [''] },
  {
    labels: ['Platform', 'Plattform', 'Plateforme'],
    entries: [
      'platform',
      {
        labels: ['Chat'],
        entries: [
          'platform/chat/overview',
          'platform/chat/basics',
          'platform/chat/arena-mode',
        ],
      },
      {
        labels: ['Projects', 'Projekte'],
        entries: ['platform/projects/concepts'],
      },
      {
        labels: ['Automations', 'Automatisierungen', 'Automatisations'],
        entries: [
          'platform/automations/concepts',
          'platform/automations/catalog',
        ],
      },
      {
        labels: ['Admin', 'Verwaltung', 'Administration'],
        entries: [
          'platform/admin/overview',
          'platform/admin/members-and-roles',
          'platform/admin/teams',
          {
            labels: ['Governance', 'Gouvernance'],
            entries: [
              'platform/admin/governance/audit-logs',
              'platform/admin/governance/policies-and-limits',
            ],
          },
        ],
      },
    ],
  },
  {
    labels: ['Self-hosted', 'Selbst gehostet', 'Auto-hébergé'],
    entries: [
      {
        labels: ['Install', 'Installation'],
        entries: ['self-hosted/install', 'self-hosted/install/quickstart'],
      },
      {
        labels: ['Configuration', 'Konfiguration'],
        entries: [
          'self-hosted/configuration/environment-reference',
          'self-hosted/configuration/retention',
          'self-hosted/configuration/approvals',
        ],
      },
    ],
  },
  {
    labels: ['Tutorials', 'Tutoriels'],
    entries: [
      {
        labels: ['Admin', 'Verwaltung', 'Administration'],
        entries: [
          'tutorials/admin/connect-local-provider',
          'tutorials/admin/meeting-transcription',
        ],
      },
      {
        labels: ['Videos', 'Vidéos'],
        entries: ['tutorials/videos/people-roles-and-teams'],
      },
    ],
  },
];

const INDEX = buildNearMissIndex(PAGE_LIST, NAV);

describe('resolveNearMiss', () => {
  // Addresses Tale's own chat agent guessed while answering a German user.
  it.each([
    [
      'self-hosted/configuration/retention-limits',
      'self-hosted/configuration/retention',
    ],
    ['verwaltung/mitglieder-und-rollen', 'platform/admin/members-and-roles'],
    [
      'verwaltung/administration/mitglieder-und-rollen',
      'platform/admin/members-and-roles',
    ],
    ['administration/members-and-roles', 'platform/admin/members-and-roles'],
    [
      'plattform/automatisierungen/automatisierungen-erstellen-oder-importieren',
      'platform/automations/catalog',
    ],
    [
      'platform/automations/automation-concepts',
      'platform/automations/concepts',
    ],
    [
      'platform/automations/create-or-import-automations',
      'platform/automations/catalog',
    ],
  ])('lands the guess %s on %s', (guess, page) => {
    expect(resolveNearMiss(guess, INDEX)).toBe(page);
  });

  it('forgives a typo, a moved folder and a section front page', () => {
    expect(resolveNearMiss('platfrom/chat/basics', INDEX)).toBe(
      'platform/chat/basics',
    );
    expect(resolveNearMiss('chat/arena-mode', INDEX)).toBe(
      'platform/chat/arena-mode',
    );
    expect(resolveNearMiss('platform/overview', INDEX)).toBe('platform');
    expect(resolveNearMiss('self-hosted/install/introduction', INDEX)).toBe(
      'self-hosted/install',
    );
    expect(resolveNearMiss('Platform/Chat/Basics', INDEX)).toBe(
      'platform/chat/basics',
    );
  });

  // The label a reader sees in the sidebar, guessed as an address: no page
  // is titled so, and before the sections were indexed each answered 404.
  it.each([
    ['verwaltung', 'platform/admin/overview'],
    ['plattform/verwaltung', 'platform/admin/overview'],
    ['verwaltung/governance', 'platform/admin/governance/audit-logs'],
    ['plattform/automatisierungen', 'platform/automations/concepts'],
    ['automatisations', 'platform/automations/concepts'],
    ['selbst-gehostet', 'self-hosted/install'],
    ['auto-heberge', 'self-hosted/install'],
    ['start', ''],
  ])('lands the sidebar label %s on its section %s', (guess, page) => {
    expect(resolveNearMiss(guess, INDEX)).toBe(page);
  });

  it('picks between two sections of one label by the folders of the guess', () => {
    // With nothing to go by, the section a reader meets first.
    expect(resolveNearMiss('verwaltung', INDEX)).toBe(
      'platform/admin/overview',
    );
    expect(resolveNearMiss('tutorials/verwaltung', INDEX)).toBe(
      'tutorials/admin/connect-local-provider',
    );
    expect(resolveNearMiss('tutoriels/verwaltung', INDEX)).toBe(
      'tutorials/admin/connect-local-provider',
    );
  });

  it('reads a section label as the folder of the pages under it', () => {
    // Two pages speak of `Rollen`: alone the word names neither, under the
    // admin label it names the one in that section.
    expect(resolveNearMiss('rollen', INDEX)).toBeNull();
    expect(resolveNearMiss('verwaltung/rollen', INDEX)).toBe(
      'platform/admin/members-and-roles',
    );
    expect(resolveNearMiss('verwaltung/overview', INDEX)).toBe(
      'platform/admin/overview',
    );
    expect(resolveNearMiss('plattform/verwaltung/uebersicht', INDEX)).toBe(
      'platform/admin/overview',
    );
    expect(resolveNearMiss('verwaltung/übersicht', INDEX)).toBe(
      'platform/admin/overview',
    );
  });

  it('keeps a page title ahead of a section label', () => {
    // `Chat` is both the group and its front page's title.
    expect(resolveNearMiss('chat', INDEX)).toBe('platform/chat/overview');
    expect(resolveNearMiss('plattform', INDEX)).toBe('platform');
  });

  it('answers a real page with itself', () => {
    expect(resolveNearMiss('platform/admin/teams', INDEX)).toBe(
      'platform/admin/teams',
    );
  });

  it.each([
    'foo',
    'foo/bar-baz',
    'concepts',
    'overview',
    'wp-login',
    'cgi-bin/test',
    'self-hosted/configuration/xyz',
    'platform/chat/zzzz',
    'verwaltung/xyz',
    'verwaltungen-und-mehr',
    '',
    'a'.repeat(300),
  ])('refuses to guess %s — no page clearly wins', (guess) => {
    expect(resolveNearMiss(guess, INDEX)).toBeNull();
  });
});

describe('a crafted guess', () => {
  it('is scored on a bounded number of words', () => {
    const guess = Array.from({ length: 40 }, (_, i) => `word${i}`).join('-');
    expect(resolveNearMiss(`platform/${guess}`, INDEX)).toBeNull();
    expect(rankNearMisses(`platform/${guess}`, INDEX)).toHaveLength(
      INDEX.pages.length,
    );
  });
});

describe('rankNearMisses', () => {
  it('puts the page a guess means first and keeps reading order on ties', () => {
    const [first] = rankNearMisses('verwaltung/mitglieder-und-rollen', INDEX);
    expect(first?.route).toBe('platform/admin/members-and-roles');
    expect(rankNearMisses('', INDEX).map(({ route }) => route)).toEqual(
      INDEX.pages.map(({ route }) => route),
    );
  });
});

const PAGES = new Set(INDEX.pages.map(({ route }) => route));
const REDIRECTS = new Map([
  ['/old/page', '/platform/chat/basics'],
  ['/de/old/page', '/de/platform/chat/basics'],
  ['/legal/terms', 'https://tale.dev/legal/terms-of-service'],
]);

const DOCS_SITE: MissingAddressSite = {
  prefixedLocales: ['de', 'fr'],
  defaultLocale: 'en',
  pagePath: (locale, route) =>
    locale === 'en'
      ? `/${route}`
      : route
        ? `/${locale}/${route}`
        : `/${locale}`,
  isPage: (_locale, route) => PAGES.has(route),
  redirectFor: (path) => REDIRECTS.get(path),
  index: INDEX,
};

describe('resolveMissingAddress', () => {
  it('folds a retired regional tree and odd spellings into a 301', () => {
    expect(
      resolveMissingAddress('/de-CH/platform/chat/basics', DOCS_SITE),
    ).toEqual({ location: '/de/platform/chat/basics', permanent: true });
    expect(
      resolveMissingAddress('/fr-CH/platform/admin/teams.md', DOCS_SITE),
    ).toEqual({ location: '/fr/platform/admin/teams.md', permanent: true });
    expect(
      resolveMissingAddress('/DE/Platform/Chat/Basics', DOCS_SITE),
    ).toEqual({ location: '/de/platform/chat/basics', permanent: true });
    expect(
      resolveMissingAddress('/platform/chat/basics/index.html', DOCS_SITE),
    ).toEqual({ location: '/platform/chat/basics', permanent: true });
    expect(resolveMissingAddress('/de/de-ch/old/page', DOCS_SITE)).toEqual({
      location: '/de/platform/chat/basics',
      permanent: true,
    });
  });

  it('sends a guess to its page with a 302, in the reader’s language', () => {
    expect(
      resolveMissingAddress('/de/verwaltung/mitglieder-und-rollen', DOCS_SITE),
    ).toEqual({
      location: '/de/platform/admin/members-and-roles',
      permanent: false,
    });
    expect(
      resolveMissingAddress(
        '/de/self-hosted/configuration/retention-limits.md',
        DOCS_SITE,
      ),
    ).toEqual({
      location: '/de/self-hosted/configuration/retention.md',
      permanent: false,
    });
  });

  it('never guesses at a file, a malformed path or an unknown address', () => {
    for (const path of [
      '/assets/index-3f2a.js',
      '/images/missing.webp',
      '/favicon.png',
      '/%E0%A4%A',
      '/de/foo/bar-baz',
      '/platform/chat/basics\\x',
    ]) {
      expect(resolveMissingAddress(path, DOCS_SITE), path).toBeNull();
    }
  });

  it('keeps an external redirect target whole, even for a Markdown export', () => {
    expect(resolveMissingAddress('/legal/Terms.md', DOCS_SITE)).toEqual({
      location: 'https://tale.dev/legal/terms-of-service',
      permanent: true,
    });
  });

  it('serves a one-language site under its mount and drops stray locales', () => {
    const uiDocs: MissingAddressSite = {
      ...DOCS_SITE,
      prefixedLocales: [],
      strayLocales: ['de', 'fr'],
      mount: 'docs',
      pagePath: (_locale, route) => (route ? `/docs/${route}` : '/docs'),
    };
    expect(resolveMissingAddress('/platform/chat/basics', uiDocs)).toEqual({
      location: '/docs/platform/chat/basics',
      permanent: true,
    });
    expect(
      resolveMissingAddress('/DE/docs/platfrom/chat/basics', uiDocs),
    ).toEqual({
      location: '/docs/platform/chat/basics',
      permanent: false,
    });
  });
});
