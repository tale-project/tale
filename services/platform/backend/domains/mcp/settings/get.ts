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

import { type McpRefusal, refusalFromThrown } from '../refusals.ts';
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
      nextCursor: null,
      hint: CATALOG_HINT,
    };
  }
  const resources: Record<string, unknown>[] = [];
  const refused: Array<{ kind: SettingsKind } & McpRefusal> = [];
  let nextCursor: string | null = null;
  for (const kind of new Set(query.kinds)) {
    const handler = registry[kind];
    if (handler === undefined) {
      refused.push({ kind, ...unavailable(kind) });
      continue;
    }
    const { secretPaths } = settingsKindDescriptor(kind);
    try {
      const page = await handler.list(ctx, {
        ...(query.ids === undefined ? {} : { ids: query.ids }),
        ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
      });
      for (const item of page.items) {
        resources.push({
          kind,
          id: item.id,
          key: settingsKey(kind, item.id),
          hash: item.hash,
          config: maskSecrets(item.config, secretPaths),
        });
      }
      nextCursor = page.nextCursor ?? nextCursor;
    } catch (error) {
      const refusal = refusalFromThrown(error);
      if (refusal === null) throw error;
      refused.push({ kind, ...refusal });
    }
  }
  return { resources, refused, nextCursor, hint: RESOURCES_HINT };
}
