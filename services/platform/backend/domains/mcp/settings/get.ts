/**
 * Reading settings over MCP. Without kinds, the catalog: every kind with
 * what it is, its operations and acts, its risk, where a person changes it
 * in Settings, whether this deployment serves it, and whether the caller's
 * role may read and change it. With kinds, each resource the caller may
 * read through the kind's native read path, its secrets masked, with the
 * hash a change names as expected. A kind whose read is refused answers
 * the refusal beside the others, never an empty list in its place.
 */

import {
  SETTINGS_KINDS,
  settingsKindDescriptor,
  type SettingsKind,
} from '@tale/shared/schemas/settings-kinds';

import { declaredSettingsNames } from '../../../../lib/mcp/settings-schemas.ts';
import { type McpRefusal, refusalFromThrown } from '../refusals.ts';
import { SettingsRefusalError } from './kit.ts';
import { unavailable } from './plan.ts';
import {
  type SettingsContext,
  type SettingsRegistry,
  settingsKey,
} from './registry.ts';
import { maskSecrets } from './secrets.ts';

/** What `get_settings` reads. `ids` and `cursor` go with one kind. */
export interface SettingsQuery {
  readonly kinds?: readonly SettingsKind[];
  readonly ids?: readonly string[];
  readonly cursor?: string;
}

const CATALOG_HINT =
  'get_settings with kinds reads their resources and hashes; plan_settings shows what a change would do, and apply_settings makes it';

const RESOURCES_HINT =
  'change one with plan_settings, show the plan to the person, then apply_settings naming each key with the hash read here';

/** A cursor as a read answers it, bound to the kind whose listing issued it:
 * two kinds hand out the same `p<n>` form, and one kind's place must never
 * read as a place in another's listing. */
function issued(kind: SettingsKind, cursor: string): string {
  return `${kind}:${cursor}`;
}

/** The place a kind's own listing issued, from the cursor a call passes back;
 * refused when another kind's listing — or none — answered it. */
function redeemed(kind: SettingsKind, cursor: string): string {
  const prefix = `${kind}:`;
  if (!cursor.startsWith(prefix) || cursor.length === prefix.length) {
    throw new SettingsRefusalError(
      'INVALID_CURSOR',
      'the cursor is not one this listing answered',
      {
        hint: `pass the cursor get_settings answered for ${kind} (cursors.${kind}), or none for its first page`,
      },
    );
  }
  return cursor.slice(prefix.length);
}

/** What `get_settings` answers. */
export async function getSettings(
  ctx: SettingsContext,
  registry: SettingsRegistry,
  query: SettingsQuery,
): Promise<Record<string, unknown>> {
  if (query.kinds === undefined) {
    const kinds = await Promise.all(
      SETTINGS_KINDS.map(async (descriptor) => {
        const handler = registry[descriptor.kind];
        const access =
          handler === undefined
            ? { read: false, write: false }
            : await handler.access(ctx);
        return {
          kind: descriptor.kind,
          scope: descriptor.scope,
          description: descriptor.description,
          ops: descriptor.ops,
          acts: descriptor.acts,
          baseRisk: descriptor.baseRisk,
          areas: descriptor.areas,
          available: handler !== undefined,
          read: access.read,
          write: access.write,
        };
      }),
    );
    return {
      kinds,
      resources: [],
      refused: [],
      cursors: {},
      nextCursor: null,
      hint: CATALOG_HINT,
    };
  }
  const resources: Record<string, unknown>[] = [];
  const refused: Array<{ kind: SettingsKind } & McpRefusal> = [];
  const cursors: Record<string, string> = {};
  const wanted = [...new Set(query.kinds)];
  for (const kind of wanted) {
    const handler = registry[kind];
    if (handler === undefined) {
      refused.push({ kind, ...unavailable(kind) });
      continue;
    }
    const { secretPaths } = settingsKindDescriptor(kind);
    try {
      const cursor =
        query.cursor === undefined ? undefined : redeemed(kind, query.cursor);
      const page = await handler.list(ctx, {
        ...(query.ids === undefined ? {} : { ids: query.ids }),
        ...(cursor === undefined ? {} : { cursor }),
      });
      for (const item of page.items) {
        resources.push({
          kind,
          id: item.id,
          key: settingsKey(kind, item.id),
          hash: item.hash,
          config: maskSecrets(
            item.config,
            secretPaths,
            declaredSettingsNames(kind, item.id),
          ),
        });
      }
      if (page.nextCursor !== null && page.nextCursor !== undefined) {
        cursors[kind] = issued(kind, page.nextCursor);
      }
    } catch (error) {
      const refusal = refusalFromThrown(error);
      if (refusal === null) throw error;
      refused.push({ kind, ...refusal });
    }
  }
  // One cursor per kind, by kind; `nextCursor` stays for the read of one
  // kind, the only read whose next page is a single place.
  const [only] = wanted;
  const nextCursor =
    wanted.length === 1 && only !== undefined ? (cursors[only] ?? null) : null;
  return { resources, refused, cursors, nextCursor, hint: RESOURCES_HINT };
}
