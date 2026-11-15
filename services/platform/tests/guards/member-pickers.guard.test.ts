// @vitest-environment node

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * A picker offers people by search (`useMemberSearch`, MEMBER-R12) and names
 * the people it holds by lookup (`useMemberLookup`, MEMBER-R11); none reads
 * every member of the organization. The whole-directory reads (`GET /members`
 * behind `useMembers`, and the governance picker query that wrapped it) take
 * every member, with no limit, and a picker that reads them grows with the
 * organization.
 *
 * This walks every non-test `.ts` and `.tsx` under `services/platform/app`
 * and fails on a read of the directory from outside the screens that show
 * the whole list: the member directory's own screens, the organization's
 * settings and the member rights they edit. The screens that stay on the
 * full list are named below; a new picker reads the search or the lookup.
 */

const PLATFORM_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const APP_ROOT = path.join(PLATFORM_ROOT, 'app');

/** The whole-directory reads, by the name a caller imports or calls. */
const WHOLE_DIRECTORY_READS = [
  /\buseMembers\s*\(/,
  /\blistOrgMembersForPicker\b/,
  /\buseOrgMembersFor\w*/,
  /\bmembers\/queries:listByOrganization\b/,
];

/**
 * Where the whole directory is read on purpose, under `app/`: the
 * organization's own member list, which pages every member and edits their
 * rights (`features/settings/organization/`, and its route
 * `routes/dashboard/$id/settings/members.tsx`), and the backend adapters that
 * map the directory's wire rows (`lib/backend/`). A picker anywhere else
 * reads the search or the lookup.
 */
const WHOLE_LIST_SCREENS = [
  'features/settings/organization/',
  'lib/backend/',
  'routes/dashboard/$id/settings/members.tsx',
];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    if (!/\.(ts|tsx)$/.test(entry)) return [];
    if (/\.test\.|\.browser\.test\./.test(entry)) return [];
    return [full];
  });
}

function onWholeList(relative: string): boolean {
  return WHOLE_LIST_SCREENS.some((screen) =>
    screen.endsWith('/') ? relative.startsWith(screen) : relative === screen,
  );
}

describe('member pickers', () => {
  it('offers and names people through the search and the lookup [MEMBER-R11, MEMBER-R12]', () => {
    const offenders: string[] = [];
    for (const file of walk(APP_ROOT)) {
      const relative = path.relative(APP_ROOT, file).split(path.sep).join('/');
      if (onWholeList(relative)) continue;
      const text = readFileSync(file, 'utf8');
      for (const read of WHOLE_DIRECTORY_READS) {
        if (read.test(text)) offenders.push(`${relative}: ${read.source}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
