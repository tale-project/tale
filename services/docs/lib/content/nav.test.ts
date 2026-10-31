import { describe, expect, it } from 'vitest';

import { navGroupTrail } from './nav';

describe('navigation group trail', () => {
  it('reuses the configuration label without requiring a section index', () => {
    expect(navGroupTrail('self-hosted/configuration/providers')).toEqual([
      'nav.groups.selfHosted',
      'nav.groups.configuration',
    ]);
  });

  it('preserves nested groups whose label keys differ from URL segments', () => {
    expect(navGroupTrail('self-hosted/operate/release-notes/format')).toEqual([
      'nav.groups.selfHosted',
      'nav.groups.operate',
      'nav.groups.releaseNotes',
    ]);
    expect(navGroupTrail('tutorials/videos/welcome-to-tale')).toEqual([
      'nav.groups.tutorials',
      'nav.groups.tutorialsVideos',
    ]);
  });

  it('finds a section landing page by its address as well as its file', () => {
    // `/tutorials/videos` reaches the page as `tutorials/videos`; nav.json
    // lists the file, `tutorials/videos/index`.
    expect(navGroupTrail('tutorials/videos')).toEqual([
      'nav.groups.tutorials',
      'nav.groups.tutorialsVideos',
    ]);
    expect(navGroupTrail('tutorials/videos')).toEqual(
      navGroupTrail('tutorials/videos/index'),
    );
  });

  it('leaves unlisted pages to the existing title fallback', () => {
    expect(navGroupTrail('unknown/page')).toEqual([]);
  });
});
