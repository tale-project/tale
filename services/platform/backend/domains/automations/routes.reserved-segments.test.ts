import { readdirSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  assertAutomationNameCreatable,
  AutomationError,
  RESERVED_AUTOMATION_SEGMENTS,
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
        entry !== 'index.tsx',
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
