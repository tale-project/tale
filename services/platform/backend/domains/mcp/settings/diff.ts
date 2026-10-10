/**
 * What a change replaces, member by member, as a plan shows it: each leaf
 * that differs with what it holds before and after. Objects are walked;
 * anything else — a list included — is compared whole. Both sides arrive
 * masked, so a diff never shows a secret.
 */

import { stableStringify } from '@tale/shared/utils/stable-stringify';

import { isRecord } from '../../../../lib/utils/type-utils.ts';

/** One member a change replaces: where (an RFC 6901 pointer into the
 * config, `''` for all of it), and what it holds before and after — a side
 * left out has no such member. */
export interface SettingsDiffEntry {
  readonly path: string;
  readonly before?: unknown;
  readonly after?: unknown;
}

/** How many members one plan lists for one change: a reader's page, never
 * a catalog replaced whole spelled out entry by entry. */
const MAX_ENTRIES = 200;

function token(name: string): string {
  return `/${name.replaceAll('~', '~0').replaceAll('/', '~1')}`;
}

function same(left: unknown, right: unknown): boolean {
  return stableStringify(left) === stableStringify(right);
}

/** The members `after` replaces in `before`, in key order, at most
 * {@link MAX_ENTRIES}; `truncated` says more were left out. */
export function diffConfigs(
  before: unknown,
  after: unknown,
): { diff: SettingsDiffEntry[]; truncated: boolean } {
  const diff: SettingsDiffEntry[] = [];
  let truncated = false;
  const push = (entry: SettingsDiffEntry): void => {
    if (diff.length < MAX_ENTRIES) diff.push(entry);
    else truncated = true;
  };
  const walk = (left: unknown, right: unknown, path: string): void => {
    if (same(left, right)) return;
    if (isRecord(left) && isRecord(right)) {
      const names = [
        ...new Set([...Object.keys(left), ...Object.keys(right)]),
      ].sort();
      for (const name of names) {
        const inLeft = Object.hasOwn(left, name);
        const inRight = Object.hasOwn(right, name);
        if (inLeft && inRight) {
          walk(left[name], right[name], path + token(name));
        } else if (inLeft) {
          push({ path: path + token(name), before: left[name] });
        } else {
          push({ path: path + token(name), after: right[name] });
        }
      }
      return;
    }
    push({ path, before: left, after: right });
  };
  walk(before, after, '');
  return { diff, truncated };
}
