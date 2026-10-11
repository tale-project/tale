import { readdirSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  assertAutomationNameCreatable,
  AutomationError,
  RESERVED_AUTOMATION_SEGMENTS,
  RESERVED_TRAILING_PATHS,
} from './store.ts';

/**
 * An automation is openable by the name it was saved under. Regression: the
 * name rule accepted `runs`, `metrics`, `listing`, … — the fixed routes the
 * automations API registers ahead of `/:name{.+}` — so such an automation
 * saved fine and then never loaded: `GET /automations/runs` answered the run
 * list, not the automation.
 */

/** Every literal first segment of a fixed route in `routes.ts`. */
function fixedRouteSegments(): string[] {
  const source = readFileSync(new URL('./routes.ts', import.meta.url), 'utf8');
  return [
    ...source.matchAll(
      /app\.(?:get|post|put|patch|delete)\(\s*'\/([^/'\s:{]+)/g,
    ),
  ].map((match) => match[1] ?? '');
}

/** The suffix routes of `routes.ts` (`/:name{.+}/<suffix>`) whose method
 * also has a bare `/:name{.+}` route: those match first, so a name ending
 * in the suffix would answer as another automation. */
function collidingSuffixes(): string[] {
  const source = readFileSync(new URL('./routes.ts', import.meta.url), 'utf8');
  const routes = [
    ...source.matchAll(
      /app\.(get|post|put|patch|delete)\(\s*'\/:name\{\.\+\}(\/[^']*)?'/g,
    ),
  ].map((match) => ({
    method: match[1] ?? '',
    suffix: (match[2] ?? '').replace(/^\//, ''),
  }));
  const bare = new Set(
    routes.filter((route) => route.suffix === '').map((route) => route.method),
  );
  return routes
    .filter((route) => route.suffix !== '' && bare.has(route.method))
    .map((route) => route.suffix);
}

/** Every fixed page beside `$automationSlug` in the app's automations tree. */
function fixedPageSegments(): string[] {
  const dir = new URL(
    '../../../app/routes/dashboard/$id/automations/',
    import.meta.url,
  );
  return readdirSync(dir)
    .filter(
      (entry) =>
        entry.endsWith('.tsx') &&
        !entry.startsWith('$') &&
        entry !== 'index.tsx' &&
        // The directory's own layout (the access gate), not a page: it adds
        // no URL segment.
        entry !== 'route.tsx' &&
        // What the route generator skips (`tsr.config.json`): tests and
        // `-`-prefixed helpers are no routes at all.
        !entry.includes('.test.') &&
        !entry.startsWith('-'),
    )
    .map((entry) => entry.replace(/\.tsx$/, ''));
}

describe('reserved automation name segments', () => {
  it('cover every fixed API route registered ahead of /:name', () => {
    const segments = fixedRouteSegments();
    // A guard against the scan itself going blind: the router has had at
    // least these fixed doors since 0.5 shipped.
    expect(segments).toEqual(
      expect.arrayContaining(['runs', 'metrics', 'listing', 'upload']),
    );
    for (const segment of new Set(segments)) {
      expect(RESERVED_AUTOMATION_SEGMENTS).toContain(segment);
    }
  });

  it('cover every fixed page beside $automationSlug in the app', () => {
    const pages = fixedPageSegments();
    expect(pages).toContain('metrics');
    for (const page of pages) {
      expect(RESERVED_AUTOMATION_SEGMENTS).toContain(page);
    }
  });
});

describe('reserved trailing paths [AUTO-R49]', () => {
  it('cover every suffix route that shares a method with the bare /:name route', () => {
    const suffixes = collidingSuffixes();
    // A guard against the scan going blind: these suffix routes exist.
    expect(suffixes).toEqual(expect.arrayContaining(['versions', 'trigger']));
    for (const suffix of new Set(suffixes)) {
      expect(RESERVED_TRAILING_PATHS).toContain(suffix);
    }
  });

  it.each([
    ['ops/versions', 'versions'],
    ['ops/trigger', 'trigger'],
    ['reports/trigger/runs', 'trigger/runs'],
    ['billing/deployments', 'deployments'],
  ])('refuses %j, naming %j', (name, word) => {
    let caught: unknown;
    try {
      assertAutomationNameCreatable(name);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AutomationError);
    if (caught instanceof AutomationError) {
      expect(caught.code).toBe('AUTOMATION_NAME_RESERVED');
      expect(caught.status).toBe(400);
      expect(caught.message).toContain(`"${word}" at its end`);
    }
  });

  it.each(['versions', 'ops/version-history', 'ops/triggers-digest'])(
    'lets %j through — only a whole path at the end is reserved',
    (name) => {
      expect(assertAutomationNameCreatable(name)).toBe(name);
    },
  );
});

describe('assertAutomationNameCreatable', () => {
  it.each(['runs', 'metrics', 'runs/nightly', 'catalog/node-types'])(
    'refuses %j with a coded, actionable 400',
    (name) => {
      let caught: unknown;
      try {
        assertAutomationNameCreatable(name);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(AutomationError);
      if (caught instanceof AutomationError) {
        expect(caught.code).toBe('AUTOMATION_NAME_RESERVED');
        expect(caught.status).toBe(400);
        expect(caught.message).toContain(`"${name.split('/')[0]}"`);
        expect(caught.message).toContain('ops/');
      }
    },
  );

  it.each([
    'ops/runs',
    'github/triage-issues',
    'nightly-runs',
    'metrics-digest',
  ])('lets %j through — only the FIRST whole segment is reserved', (name) => {
    expect(assertAutomationNameCreatable(name)).toBe(name);
  });

  it('still applies the slug rule first', () => {
    expect(() => assertAutomationNameCreatable('Not A Slug')).toThrow(
      /not a valid automation name/,
    );
  });
});
