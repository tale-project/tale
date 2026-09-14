import type { Release } from './types';

/**
 * How many of the newest release bodies the prerendered changelog carries.
 *
 * Rendering every body put ~400 KB of release notes into
 * `dist/changelog/index.html`. A fixed count of twelve held the page near
 * 216 KB until the notes themselves grew: six consecutive 0.5.x fix
 * releases of 17–24 KB of Markdown each pushed the same twelve past the
 * 300 KB `tests/prerender/seo.test.ts` holds the page to. So the cut is a
 * byte budget, not a count — the newest bodies whose Markdown, summed,
 * stays within {@link PRERENDER_BODY_BUDGET_CHARS} (about 1.3× that once
 * rendered, on top of a ~160 KB skeleton: forty release headers, the two
 * timelines and the JSON-LD), at most {@link PRERENDER_BODY_MAX} of them.
 * The newest release is always prerendered, whatever its size. Every other
 * body mounts on hydration from the manifest the JS bundle already ships,
 * so a visitor sees the same page; the server and the first client render
 * compute the same cut from the same manifest, so hydration matches.
 */
export const PRERENDER_BODY_MAX = 12;
export const PRERENDER_BODY_BUDGET_CHARS = 72_000;

/**
 * The number of leading releases whose bodies the prerendered HTML carries
 * — `index < prerenderedBodyCount(releases)` is the render-time test. A
 * release without a body costs nothing and still counts, so the cut stays
 * an index into the stream.
 */
export function prerenderedBodyCount(
  releases: readonly Pick<Release, 'body'>[],
): number {
  let count = 0;
  let chars = 0;
  for (const release of releases) {
    if (count >= PRERENDER_BODY_MAX) break;
    const size = release.body?.length ?? 0;
    if (count > 0 && chars + size > PRERENDER_BODY_BUDGET_CHARS) break;
    chars += size;
    count += 1;
  }
  return count;
}
