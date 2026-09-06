/**
 * Regression: the docs `<title>` was the bare frontmatter title. That name
 * also labels the sidebar entry, the breadcrumb and the H1, so it is short
 * on purpose — "Chat", "Admin", "Teams", "Cloud". As a title it rendered as
 * little as 11 characters and repeated across sections, which Ahrefs reports
 * as "Title too short".
 */

import { describe, expect, it } from 'vitest';

import { buildMetaTitle } from './docs-page';

const SITE = 'Tale documentation';
const crumbs = (...labels: string[]) => labels.map((label) => ({ label }));

describe('buildMetaTitle', () => {
  it('trails the top-level section so short names carry context', () => {
    expect(buildMetaTitle(crumbs('Platform', 'Chat', 'Chat'), SITE)).toBe(
      'Chat | Platform',
    );
    expect(buildMetaTitle(crumbs('Cloud', 'Billing'), SITE)).toBe(
      'Billing | Cloud',
    );
  });

  it('gives a section landing page the site title instead', () => {
    expect(buildMetaTitle(crumbs('Cloud'), SITE)).toBe(
      'Cloud | Tale documentation',
    );
    expect(buildMetaTitle(crumbs('Develop', 'Develop'), SITE)).toBe(
      'Develop | Tale documentation',
    );
  });

  it('does not repeat a section the page name already carries', () => {
    expect(
      buildMetaTitle(
        crumbs('Self-hosted', 'Install', 'Self-hosted quickstart'),
        SITE,
      ),
    ).toBe('Self-hosted quickstart');
  });

  it('drops the section rather than overflow 60 rendered characters', () => {
    const long = 'Pipe meeting transcripts into the Knowledge Base';
    expect(buildMetaTitle(crumbs('Tutorials', 'Admin', long), SITE)).toBe(long);
    // `${long} | Tutorials | Tale` would be 67.
    expect(`${long} | Tale`.length).toBeLessThanOrEqual(60);
  });

  it('falls back to the site title at the docs root', () => {
    expect(buildMetaTitle([], SITE)).toBe(SITE);
  });
});
