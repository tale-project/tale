// @vitest-environment node

/**
 * Every page of Settings has its MCP story: a settings kind covers it, or
 * `coverage.ts` says what an agent cannot change there yet, or why the page
 * holds nothing to change. The pages are read from the settings rail itself
 * — its rows (`settings-rail.tsx`, and the mobile overview's
 * `use-settings-menu-groups.ts`, which must list the same) and the tabs of
 * the rows that have them — so a page added to the rail without its story
 * fails here, and so does a page the shared list names that the rail lost.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  SETTINGS_AREAS,
  SETTINGS_KINDS,
  type SettingsArea,
} from '@tale/shared/schemas/settings-kinds';
import { describe, expect, it } from 'vitest';

import { API_NAV_ITEMS } from '../../../../app/routes/dashboard/$id/settings/api/-nav-items';
import { GOVERNANCE_NAV_ITEMS } from '../../../../app/routes/dashboard/$id/settings/governance/-nav-items';
import { METRICS_NAV_ITEMS } from '../../../../app/routes/dashboard/$id/settings/metrics/-nav-items';
import { SETTINGS_NOT_EXPOSED, SETTINGS_PLANNED } from './coverage';

const PLATFORM = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../..',
);

/** The rail's rows that open tabs, with the tabs each one opens. */
const TABS: Readonly<Record<string, ReadonlyArray<{ slug: string }>>> = {
  governance: GOVERNANCE_NAV_ITEMS,
  metrics: METRICS_NAV_ITEMS,
  api: API_NAV_ITEMS,
};

function source(file: string): string {
  return readFileSync(path.join(PLATFORM, file), 'utf8');
}

/** Every row a rail source lists, by its path under Settings. */
function rows(text: string): string[] {
  return [...text.matchAll(/\bpath:\s*'([a-z-]+)'/g)].map(
    (match) => match[1] ?? '',
  );
}

const RAIL = source('app/features/settings/components/settings-rail.tsx');
const OVERVIEW = source(
  'app/features/settings/components/use-settings-menu-groups.ts',
);

/** Every page of Settings the app shows, tab by tab. */
function appAreas(): string[] {
  return rows(RAIL).flatMap((row) => {
    const tabs = TABS[row];
    return tabs === undefined ? [row] : tabs.map((tab) => `${row}/${tab.slug}`);
  });
}

const covered = new Set<string>(
  SETTINGS_KINDS.flatMap((descriptor): readonly string[] => descriptor.areas),
);

describe('the pages of Settings over MCP', () => {
  it('reads the rail: its rows, and the tabs of the rows that open tabs', () => {
    const rail = rows(RAIL);
    expect(rail.length).toBeGreaterThan(10);
    // The mobile overview lists the same pages as the desktop rail.
    expect([...rows(OVERVIEW)].sort()).toEqual([...rail].sort());
    // A row opens tabs exactly when the rail draws it as a group.
    const groups = [
      ...RAIL.matchAll(/kind:\s*'group',[^}]*?path:\s*'([a-z-]+)'/g),
    ].map((match) => match[1]);
    expect(groups.sort()).toEqual(Object.keys(TABS).sort());
  });

  it('names in the shared list exactly the pages the rail shows', () => {
    expect([...SETTINGS_AREAS].sort()).toEqual(appAreas().sort());
  });

  it('gives every page its story: a kind covers it, or it says why not', () => {
    const untold = SETTINGS_AREAS.filter(
      (area) =>
        !covered.has(area) &&
        SETTINGS_PLANNED[area] === undefined &&
        SETTINGS_NOT_EXPOSED[area] === undefined,
    );
    expect(
      untold,
      'name the page in a settings kind’s areas, or say why not in coverage.ts',
    ).toEqual([]);
  });

  it('tells each page one story', () => {
    const listed = (area: SettingsArea) =>
      [
        covered.has(area),
        SETTINGS_PLANNED[area] !== undefined,
        SETTINGS_NOT_EXPOSED[area] !== undefined,
      ].filter(Boolean).length;
    expect(SETTINGS_AREAS.filter((area) => listed(area) > 1)).toEqual([]);
  });

  it('says why in a sentence', () => {
    for (const [area, reason] of Object.entries({
      ...SETTINGS_PLANNED,
      ...SETTINGS_NOT_EXPOSED,
    })) {
      expect(reason, area).toMatch(/^\S.*\.$/);
    }
  });
});
