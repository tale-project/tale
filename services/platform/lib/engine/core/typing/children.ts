/**
 * Child automations: which saved document a `subautomation` node runs,
 * resolved the way both executors resolve it — `name@version` runs that
 * version; a bare `name` runs the deployed version, or the latest while
 * nothing is deployed.
 *
 * The store is asynchronous and org-scoped, so the children are fetched
 * once, up front, into a map that lives as long as one analysis call; the
 * typing then reads the map synchronously. Nothing is kept between calls,
 * so no organization's documents reach another organization's analysis.
 */

import { isValidAutomationName } from '@tale/shared/automation-name';

import { isRecord } from '../../../utils/type-utils';
import type { StoreAdapter } from '../slots';

/** How deep subautomations nest: the top-level run is depth 0, and a
 * subautomation node in a document at this depth fails. */
export const MAX_SUBAUTOMATION_DEPTH = 3;

/** A `subautomation` reference: `"name"` or `"name@version"`; null when it
 * is neither. */
export function parseAutomationRef(
  ref: string,
): { name: string; version?: number } | null {
  const [name, version, ...rest] = ref.split('@');
  if (rest.length > 0 || !isValidAutomationName(name)) return null;
  if (version === undefined) return { name };
  if (!/^\d+$/.test(version)) return null;
  return { name, version: Number(version) };
}

export interface ResolvedChild {
  name: string;
  /** The version a run of the reference executes. */
  version: number;
  /** The stored document (validated when it was saved). */
  automation: unknown;
}

/** Child documents keyed by the reference as written (`"name"`,
 * `"name@2"`); null for a reference that resolves to nothing. */
export type ChildDocuments = Map<string, ResolvedChild | null>;

function childRefs(doc: unknown): string[] {
  if (!isRecord(doc) || !Array.isArray(doc.nodes)) return [];
  const refs: string[] = [];
  for (const node of doc.nodes) {
    if (
      isRecord(node) &&
      node.type === 'subautomation' &&
      typeof node.automation === 'string'
    ) {
      refs.push(node.automation);
    }
  }
  return refs;
}

async function resolveOne(
  ref: string,
  store: StoreAdapter,
): Promise<ResolvedChild | null> {
  const parsed = parseAutomationRef(ref);
  if (parsed === null) return null;
  try {
    const version =
      parsed.version ?? (await store.deployedVersion(parsed.name)) ?? undefined;
    const got = await store.get(parsed.name, version);
    if (got === null) return null;
    return {
      name: parsed.name,
      version: got.meta.version,
      automation: got.automation,
    };
  } catch (e) {
    console.warn(
      '[engine] a subautomation could not be read for typing; its output is treated as unknown:',
      e instanceof Error ? e.message : e,
    );
    return null;
  }
}

/**
 * Fetch every child document `doc` can run, and theirs, down to the depth a
 * run can reach. Level by level, so a document is expanded at the shallowest
 * depth it occurs; a reference already in `into` is not fetched again.
 */
export async function resolveChildren(
  doc: unknown,
  store: StoreAdapter,
  into: ChildDocuments = new Map(),
): Promise<ChildDocuments> {
  let level: unknown[] = [doc];
  for (let depth = 0; depth < MAX_SUBAUTOMATION_DEPTH; depth++) {
    const next: unknown[] = [];
    for (const parent of level) {
      for (const ref of childRefs(parent)) {
        if (into.has(ref)) continue;
        const child = await resolveOne(ref, store);
        into.set(ref, child);
        if (child !== null) next.push(child.automation);
      }
    }
    if (next.length === 0) break;
    level = next;
  }
  return into;
}
