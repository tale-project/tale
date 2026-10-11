import type { FlowNodeDiff } from '@tale/ui/flow/diff';

import type {
  AutomationDiff,
  FieldChange,
  NodeDiff,
} from '@/lib/engine/core/diff/automation';
import type { ChangeSummary } from '@/lib/engine/core/diff/changes';

import { gateIdOf } from './flow-ids';
import { fieldName } from './issue-text';
import { nodeTitle } from './node-face';

/**
 * What changed between two versions, in the words the Versions tab and the
 * compare page say it: the parts a summary flags, what a changed node's box
 * says, and the versions a comparison offers to compare with.
 */

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** The parts of a version that changed without a count, in words. */
export function changeFlags(changes: ChangeSummary, t: Translate): string[] {
  return [
    changes.inputs === true && t('versions.flags.inputs'),
    changes.output === true && t('versions.flags.output'),
    changes.description === true && t('versions.flags.description'),
    changes.tests === true && t('versions.flags.tests'),
    changes.other === true && t('versions.flags.other'),
    changes.package === true && t('versions.flags.package'),
  ].filter((flag) => flag !== false);
}

/** The fields a change names, in words and in the reader's list form:
 * "Prompt and model". */
export function fieldList(
  fields: readonly FieldChange[],
  ctx: { t: Translate; locale: string },
): { text: string; count: number } {
  const names = [
    ...new Set(fields.map((field) => fieldName(ctx.t, field.field))),
  ];
  return {
    text: new Intl.ListFormat(ctx.locale, { type: 'conjunction' }).format(
      names,
    ),
    count: names.length,
  };
}

/**
 * What a changed or renamed node's box says at its foot: the fields that
 * changed ("Prompt and model changed"), or that it only reads a renamed
 * node by its new name. Nothing for a node that was only renamed, or added
 * or removed — the box says those itself.
 */
export function nodeChangeSummary(
  node: NodeDiff,
  ctx: { t: Translate; locale: string },
): string | undefined {
  if (node.referencesOnly === true) return ctx.t('compare.summary.references');
  if (node.fields.length === 0) return undefined;
  const { text, count } = fieldList(node.fields, ctx);
  return ctx.t('compare.summary.node', { fields: text, count });
}

/** How the canvas marks each changed or renamed node of a comparison
 * (`mergeFlowGraphs`); a node only one version has marks itself. */
export function flowNodeChanges(
  diff: AutomationDiff,
  ctx: { t: Translate; locale: string },
): ReadonlyMap<string, FlowNodeDiff> {
  const marks = new Map<string, FlowNodeDiff>();
  for (const node of diff.nodes) {
    if (node.kind !== 'changed' && node.kind !== 'renamed') continue;
    const summary = nodeChangeSummary(node, ctx);
    marks.set(node.id, {
      kind: node.kind,
      ...(summary !== undefined && { summary }),
      ...(node.kind === 'renamed' &&
        node.renamedFrom !== undefined && {
          renamedFrom: nodeTitle(node.renamedFrom),
          beforeId: node.renamedFrom,
        }),
    });
  }
  return marks;
}

/** The condition in front of each renamed node, by its new id: the older
 * id it stands for on a comparison's chart, one box with its node. */
export function renamedGates(
  diff: AutomationDiff,
): ReadonlyMap<string, string> {
  const gates = new Map<string, string>();
  for (const node of diff.nodes) {
    if (node.kind !== 'renamed' || node.renamedFrom === undefined) continue;
    gates.set(gateIdOf(node.id), gateIdOf(node.renamedFrom));
  }
  return gates;
}

/** How many nodes changed only because they read a renamed node, by the
 * renamed node's new id. */
export function referencesUpdatedBy(
  diff: AutomationDiff,
): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const node of diff.nodes) {
    if (node.referencesOnly !== true) continue;
    const renamed = new Set(
      node.fields.flatMap((field) =>
        (field.referencesOnly ?? []).map((rename) => rename.to),
      ),
    );
    for (const id of renamed) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

/** One version a comparison can start from. */
export interface CompareOption {
  version: number;
  /** Why it is offered first: the version before, the live one, or the
   * one the compared version was based on. */
  role: 'previous' | 'live' | 'basedOn' | null;
}

/**
 * The versions to compare `to` with: the one before it, the live one and
 * the one it was based on first (each once, in that order), then every
 * other earlier or later version, newest first. `to` itself is never
 * offered.
 */
export function compareOptions(
  versions: readonly number[],
  context: { to: number; live: number | null; basedOn: number | null },
): CompareOption[] {
  const present = new Set(versions);
  const first: CompareOption[] = [];
  const offer = (version: number | null, role: CompareOption['role']) => {
    if (
      version === null ||
      version === context.to ||
      !present.has(version) ||
      first.some((option) => option.version === version)
    ) {
      return;
    }
    first.push({ version, role });
  };
  offer(context.to - 1, 'previous');
  offer(context.live, 'live');
  offer(context.basedOn, 'basedOn');
  const rest = [...present]
    .filter(
      (version) =>
        version !== context.to &&
        !first.some((option) => option.version === version),
    )
    .sort((a, b) => b - a)
    .map((version) => ({ version, role: null }));
  return [...first, ...rest];
}
