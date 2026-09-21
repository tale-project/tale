import { describe, expect, it } from 'vitest';

import { allDocSlugs, docAnalyticsPath } from '@/lib/content/loader';
import { docPath } from '@/lib/content/paths';

/**
 * What a pageview is allowed to say. `main.tsx` reports the `analyticsPath`
 * the `/docs/$` loader returned and nothing else, and that loader returns what
 * `docAnalyticsPath` derives — so this function is the whole filter between a
 * browser's URL and the Umami website. A path may only reach a report when a
 * real page resolved under it: a scanner's URL, a markdown twin and the 404
 * have to come back undefined, or the report grows rows nobody wrote.
 *
 * Collection itself — the config script, the proxy paths, DNT/GPC and the
 * collector boundary — belongs to `@tale/ui/analytics` and is asserted there.
 */

const KNOWN_SLUG = 'components/button';
const UNKNOWN_SLUG = 'components/there-is-no-such-page';

describe('the pageview a documentation page reports', () => {
  it('is its canonical path, for every page the site ships', () => {
    expect(docAnalyticsPath(KNOWN_SLUG)).toBe(docPath(KNOWN_SLUG));
    expect(allDocSlugs().map(docAnalyticsPath)).toEqual(
      allDocSlugs().map(docPath),
    );
  });

  it('is absent for a slug with no page', () => {
    expect(docAnalyticsPath(UNKNOWN_SLUG)).toBeUndefined();
  });

  it('is absent for the markdown twin the Bun server owns', () => {
    expect(docAnalyticsPath(`${KNOWN_SLUG}.md`)).toBeUndefined();
  });

  it('is absent at the root of the documentation tree', () => {
    expect(docAnalyticsPath('')).toBeUndefined();
  });
});
