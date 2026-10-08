/**
 * The editor's view of validation issues: a stable id per issue, the order a
 * person reads them in, how many each node has, where "go to" takes the
 * reader, and the `IssueItem` the Problems list renders.
 *
 * An issue says where it is with an RFC 6901 pointer into the document
 * (`at.pointer`, `/nodes/2/input/to`) and, for a string, the offending range
 * inside it. Node problems are reached through the canvas and the inspector;
 * a problem elsewhere in the document (the output, the inputs schema, the
 * tests) has no control in the editor, so its row says so instead of going
 * anywhere.
 */

import type { IssueItem } from '@tale/ui/issue-list';
import type { IssueCounts } from '@tale/ui/issue-summary';

import { pointerTokens } from '@/lib/engine/core/syntax/pointer';
import type { Automation, NodeDef } from '@/lib/engine/core/types';
import type { WireAutomationIssue } from '@/lib/shared/schemas/automation-issues';

import {
  issueText,
  type IssueTextContext,
  type IssueTranslate,
} from './issue-text';
import { humanizeNodeId } from './node-label';

/** A wire issue with an id that stays the same across checks of one draft. */
export type AutomationIssue = WireAutomationIssue & { id: string };

/** Where "go to" takes the reader for one issue. */
export type IssueNavigation =
  | {
      kind: 'field';
      nodeId: string;
      nodeIndex: number;
      field: string;
      /** The issue's pointer: the focus registry resolves it to the most
       * specific control that registered for it or a part of it. */
      anchor: string;
      range?: readonly [number, number];
    }
  | { kind: 'node'; nodeId: string; nodeIndex: number }
  | { kind: 'unavailable' };

/** One issue as every surface of the editor needs it. */
export interface AutomationIssueView {
  issue: AutomationIssue;
  item: IssueItem;
  navigation: IssueNavigation;
}

/** Which of a node's fields have a control that can show a problem. */
export type FieldControls = (node: NodeDef) => ReadonlySet<string>;

const NO_NAVIGATION: IssueNavigation = { kind: 'unavailable' };

function pointerOf(issue: WireAutomationIssue): string {
  return issue.at?.pointer ?? '';
}

/**
 * Give each issue an id built from what it is and where — code, pointer,
 * range — so the current row and focus survive a re-check that finds the
 * same problem again. Two issues that share all three are told apart by
 * their order.
 */
export function withIssueIds(
  issues: readonly WireAutomationIssue[],
): AutomationIssue[] {
  const seen = new Map<string, number>();
  return issues.map((issue) => {
    const range = issue.at?.range;
    const base = [
      issue.level,
      issue.code,
      pointerOf(issue),
      range === undefined ? '' : `${range[0]}-${range[1]}`,
    ].join('|');
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return { ...issue, id: count === 0 ? base : `${base}#${count}` };
  });
}

/** The document's parts in the order a person reads a document. */
const SECTION_ORDER = [
  '',
  'version',
  'name',
  'description',
  'inputs',
  'nodes',
  'output',
  'tests',
];

function sectionRank(token: string | undefined): number {
  const rank = SECTION_ORDER.indexOf(token ?? '');
  return rank === -1 ? SECTION_ORDER.length : rank;
}

function compareTokens(a: readonly string[], b: readonly string[]): number {
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i++) {
    const left = a[i] ?? '';
    const right = b[i] ?? '';
    if (left === right) continue;
    const numeric = /^\d+$/;
    if (numeric.test(left) && numeric.test(right)) {
      return Number(left) - Number(right);
    }
    return left < right ? -1 : 1;
  }
  return a.length - b.length;
}

/**
 * Errors first, then in document order: the top-level fields, then node by
 * node in the order they are written, then the output and the tests; inside
 * one string, by where in it the problem starts.
 */
export function sortIssues<T extends WireAutomationIssue>(
  issues: readonly T[],
): T[] {
  return [...issues].sort((a, b) => {
    if (a.level !== b.level) return a.level === 'error' ? -1 : 1;
    const left = pointerTokens(pointerOf(a));
    const right = pointerTokens(pointerOf(b));
    const section = sectionRank(left[0]) - sectionRank(right[0]);
    if (section !== 0) return section;
    const byPointer = compareTokens(left, right);
    if (byPointer !== 0) return byPointer;
    return (a.at?.range?.[0] ?? -1) - (b.at?.range?.[0] ?? -1);
  });
}

/** The node an issue is about: its `nodeId`, else the node its pointer is in. */
function nodeOf(
  issue: WireAutomationIssue,
  doc: Automation,
): { node: NodeDef; index: number } | null {
  const tokens = pointerTokens(pointerOf(issue));
  if (tokens[0] === 'nodes' && tokens[1] !== undefined) {
    const index = /^\d+$/.test(tokens[1]) ? Number(tokens[1]) : -1;
    const node = doc.nodes[index];
    if (node !== undefined && typeof node.id === 'string') {
      return { node, index };
    }
  }
  // A pointer outside the nodes (the output, the tests) is about that place,
  // even when the issue also names the node it involves.
  const outsideNodes = tokens.length > 0 && tokens[0] !== 'nodes';
  if (issue.nodeId !== undefined && !outsideNodes) {
    const index = doc.nodes.findIndex((node) => node.id === issue.nodeId);
    const node = doc.nodes[index];
    if (node !== undefined) return { node, index };
  }
  return null;
}

/** Errors and warnings per node id, for the canvas markers. */
export function issueCountsByNode(
  issues: readonly WireAutomationIssue[],
  doc: Automation,
): ReadonlyMap<string, IssueCounts> {
  const counts = new Map<string, IssueCounts>();
  for (const issue of issues) {
    const found = nodeOf(issue, doc);
    if (found === null) continue;
    const current = counts.get(found.node.id) ?? { errors: 0, warnings: 0 };
    counts.set(
      found.node.id,
      issue.level === 'error'
        ? { ...current, errors: current.errors + 1 }
        : { ...current, warnings: current.warnings + 1 },
    );
  }
  return counts;
}

/**
 * Where "go to" takes the reader: the field's control when the inspector has
 * one for it, else the node (its own list of problems sits at the top of the
 * inspector), and nowhere for a part of the document the editor does not
 * edit. A member name that should not be there (an unknown field) has no
 * control by definition, so it goes to the node.
 */
export function issueNavigation(
  issue: WireAutomationIssue,
  doc: Automation,
  controlsOf: FieldControls,
): IssueNavigation {
  const found = nodeOf(issue, doc);
  if (found === null) return NO_NAVIGATION;
  const { node, index } = found;
  const pointer = pointerOf(issue);
  const tokens = pointerTokens(pointer);
  const inNode =
    tokens[0] === 'nodes' && tokens[1] === String(index) && tokens.length > 2;
  const field = inNode ? tokens[2] : undefined;
  if (
    field === undefined ||
    issue.at?.subject === 'key' ||
    !controlsOf(node).has(field)
  ) {
    return { kind: 'node', nodeId: node.id, nodeIndex: index };
  }
  const range = issue.at?.range;
  return {
    kind: 'field',
    nodeId: node.id,
    nodeIndex: index,
    field,
    anchor: pointer,
    ...(range !== undefined && { range }),
  };
}

/** The places of a document outside its nodes, by top-level member. */
const DOCUMENT_PLACES: ReadonlySet<string> = new Set([
  'output',
  'inputs',
  'tests',
  'name',
  'version',
  'nodes',
]);

function fieldLabel(t: IssueTranslate, field: string): string {
  return t(`editor.fields.${field}`, {
    ns: 'automations',
    defaultValue: field,
  });
}

/**
 * Where an issue is, as crumbs a person can follow: the node's name, the
 * field's label, then the keys inside it ("Fetch issues › Input › to"); a
 * place outside the nodes by its own name ("Output › summary"). A test is
 * counted from one, as the catalog's sentences count it.
 */
export function formatIssueLocation(
  issue: WireAutomationIssue,
  doc: Automation,
  ctx: IssueTextContext,
): string {
  const tokens = pointerTokens(pointerOf(issue));
  const found = nodeOf(issue, doc);
  const crumbs: string[] = [];
  if (found !== null && (tokens[0] === 'nodes' || tokens.length === 0)) {
    crumbs.push(humanizeNodeId(found.node.id));
    const [, , field, ...rest] = tokens;
    if (field !== undefined) crumbs.push(fieldLabel(ctx.t, field), ...rest);
  } else {
    const [section, ...rest] = tokens;
    const place =
      section !== undefined && DOCUMENT_PLACES.has(section)
        ? section
        : 'document';
    crumbs.push(
      ctx.t(`places.${place}`, { ns: 'automationIssues' }),
      ...(place === 'document' && section !== undefined
        ? [section, ...rest]
        : rest),
    );
    if (place === 'tests' && rest[0] !== undefined && /^\d+$/.test(rest[0])) {
      crumbs[1] = String(Number(rest[0]) + 1);
    }
  }
  return crumbs.join(' › ');
}

/**
 * One issue as every editor surface reads it: the localized title,
 * explanation, cause and fix (`issue-text.ts`), where it is, and the
 * engine's own English sentence folded away as technical detail.
 */
export function toIssueView(
  issue: AutomationIssue,
  doc: Automation,
  ctx: IssueTextContext & { controlsOf: FieldControls },
): AutomationIssueView {
  const text = issueText(issue, ctx);
  const navigation = issueNavigation(issue, doc, ctx.controlsOf);
  const technical = [issue.message, issue.hint]
    .filter((line) => line !== undefined && line !== '')
    .join('\n');
  const item: IssueItem = {
    id: issue.id,
    severity: issue.level,
    title: text.title,
    location: formatIssueLocation(issue, doc, ctx),
    explanation: text.explanation,
    ...(text.cause !== '' && { cause: text.cause }),
    ...(text.fix !== '' && { fix: text.fix }),
    code: issue.code,
    ...(technical !== '' && { technical }),
    ...(navigation.kind === 'unavailable' && {
      unavailableReason: ctx.t('problems.notEditableHere', {
        ns: 'automations',
      }),
    }),
  };
  return { issue, item, navigation };
}

/**
 * The line a field shows under its control for one of its problems: the
 * issue's cause, led by the key inside the field it is about ("to: …") when
 * the problem is deeper than the field itself and the cause does not
 * already name that key. A problem this build has no words for reads its
 * generic explanation; the engine's English stays in the technical details.
 */
export function fieldIssueMessage(
  view: AutomationIssueView,
  t: IssueTranslate,
): string {
  const { cause: itemCause, explanation } = view.item;
  const cause =
    typeof itemCause === 'string'
      ? itemCause
      : typeof explanation === 'string'
        ? explanation
        : '';
  if (view.navigation.kind !== 'field') return cause;
  const [, , , ...rest] = pointerTokens(view.navigation.anchor);
  if (rest.length === 0) return cause;
  const part = rest.join('.');
  // "The input "to" of …" says the key itself; "to: " before it would say
  // it twice.
  const params = view.issue.params ?? {};
  const named = new Set(
    [params.property, params.key].filter(
      (value): value is string => typeof value === 'string',
    ),
  );
  if (named.has(part) || named.has(rest.at(-1) ?? '')) return cause;
  return t('problems.fieldPart', {
    ns: 'automations',
    part,
    message: cause,
  });
}
