import {
  type AccessLevel,
  EXTRA_SCOPES,
  type ExtraScope,
  levelOf,
} from '@/lib/shared/agent-access';

/** What a connection's access comes to, for a list: the level it holds and
 * the extras beside it. */
export interface AccessSummary {
  level: AccessLevel | null;
  extras: ExtraScope[];
}

/**
 * The access a connection holds in the words a list can show: one level —
 * read and test, edit, or edit and deploy, each adding to the one before —
 * and the extras it holds beside it. Changing settings reads them too, so
 * one extra says both. A scope the consent page does not offer, which a
 * connection made before may hold, lets the agent do nothing and is not
 * shown.
 */
export function summarizeAccess(scopes: readonly string[]): AccessSummary {
  const held = new Set(scopes);
  return {
    level: levelOf(held),
    extras: EXTRA_SCOPES.filter(
      (extra) =>
        held.has(extra) &&
        !(extra === 'tale:settings.read' && held.has('tale:settings.write')),
    ),
  };
}
