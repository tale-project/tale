import { describe, expect, it } from 'vitest';

import frontmatterManifest from '@/app/content/frontmatter.json';
import { allDocSlugs, ensureDocBody, getDocPage } from '@/lib/content/loader';

/**
 * The content loader is the seam between the generated frontmatter manifest
 * (synchronous, always present) and the lazily-globbed page bodies (one chunk
 * per page, pulled by the route loader). The split is what keeps the rail and
 * the breadcrumbs from dragging the whole content tree into the entry bundle,
 * so both halves are asserted here: frontmatter with no body access, and a
 * body that only appears once `ensureDocBody` has run.
 */

const KNOWN_SLUG = 'components/button';
const UNKNOWN_SLUG = 'components/there-is-no-such-page';

describe('allDocSlugs', () => {
  it('is exactly the manifest, in manifest order', () => {
    expect(allDocSlugs()).toEqual(Object.keys(frontmatterManifest));
  });

  it('holds the page this suite reads', () => {
    expect(allDocSlugs()).toContain(KNOWN_SLUG);
    expect(allDocSlugs()).not.toContain(UNKNOWN_SLUG);
  });
});

describe('getDocPage', () => {
  it('resolves frontmatter for a known slug', () => {
    const doc = getDocPage(KNOWN_SLUG);
    expect(doc).not.toBeNull();
    expect(doc?.slug).toBe(KNOWN_SLUG);
    expect(doc?.frontmatter.title).toBe('Button');
    expect(doc?.frontmatter.description.length).toBeGreaterThan(0);
    expect(doc?.frontmatter.noindex).toBe(false);
  });

  it('is null for a slug with no page', () => {
    expect(getDocPage(UNKNOWN_SLUG)).toBeNull();
  });
});

describe('ensureDocBody', () => {
  it('fills the body, and is idempotent', async () => {
    const slug = 'getting-started/introduction';
    expect(getDocPage(slug)?.body).toBe('');

    await ensureDocBody(slug);
    const loaded = getDocPage(slug);
    expect(loaded?.body.length).toBeGreaterThan(0);
    // The frontmatter block is stripped — the body starts at the prose.
    expect(loaded?.body.trimStart().startsWith('---')).toBe(false);

    await ensureDocBody(slug);
    expect(getDocPage(slug)?.body).toBe(loaded?.body);
  });

  it('is a no-op for a slug with no page', async () => {
    await expect(ensureDocBody(UNKNOWN_SLUG)).resolves.toBeUndefined();
    expect(getDocPage(UNKNOWN_SLUG)).toBeNull();
  });
});
