/**
 * Static validation — six passes over an automation document, each pass only
 * seeing what the previous one proved.
 *
 * Returns `{errors, warnings}` where every Issue carries a machine-readable
 * code from the catalog and, wherever possible, an actionable hint — issues
 * are the author's primary feedback signal, and the full rendered output is
 * golden-tested (golden-errors.yml), so changing any message is a
 * deliberate, reviewed API change.
 *
 * Order: document shape → per-node structure → references and templates →
 * connector/store contracts and document quality → the analysis (`../analysis`:
 * the types of every value and the ways a run can go, and what they reveal —
 * reads of fields that cannot exist, reads of skipped nodes, nodes that can
 * never run, iteration that cannot work) → what the document names of the
 * organization, against what the store says it has (`../analysis/org-state`:
 * skills, connectors, secrets, agent runtimes, the trigger's event — warnings
 * only, and only from a store that answers). Asked for (`detail`), the result
 * also carries the per-node summary with the possible paths and the types.
 * Every issue says where it is (`at`: a JSON Pointer, and the range inside
 * the string for code) and what its sentence is built from (`params`).
 *
 * Syntax is the parser's (`../syntax`): acorn locates every error, and where
 * a CodeRunner is installed it confirms a rejection before it is reported —
 * code the runner compiles is valid, merely opaque to the analysis. Without
 * a runner the parser's verdict stands. Subautomation resolution rides the
 * caller-supplied async store, and resolves a reference the way a run does:
 * `name@version` that version, a bare `name` the deployed version (the
 * latest while none is) — fetched once per call.
 */

import { isRecord } from '../../../utils/type-utils';
import { analyze, type AutomationAnalysis } from '../analysis';
import {
  orgFactsQuery,
  orgStateIssues,
  type OrgStateInput,
} from '../analysis/org-state';
import { err } from '../errors';
import type { OrgFacts, StoreAdapter } from '../slots';
import type { Issue, NodeDef } from '../types';
import { resolveChildren } from '../typing/children';
import type { AutomationTypes } from '../typing/infer';
import { createValidationContext } from './context';
import { validateContracts } from './contracts';
import { validateDocument } from './document';
import { validateNodes } from './nodes';
import { validateReferences } from './references';

const MAX_NODES = 40;

export interface ValidateOptions {
  /**
   * Where subautomation references resolve. Threaded per call because a store
   * is org-scoped; without one the reference SYNTAX is still checked but its
   * existence is not (a bare harness has no store to ask).
   */
  store?: StoreAdapter;
  /**
   * What to return beside the issues: `analysis` (the per-node summary and
   * the possible paths) and `types` (the shape of every node's output, the
   * run input and the result). Save, deploy and run leave it out.
   */
  detail?: ReadonlyArray<'analysis' | 'types'>;
}

export interface ValidationResult {
  errors: Issue[];
  warnings: Issue[];
  /** With `detail: ['analysis']`, unless the nodes reference each other in
   * a cycle. */
  analysis?: AutomationAnalysis;
  /** With `detail: ['types']`, once the document has its nodes. */
  types?: AutomationTypes;
}

export async function validate(
  doc: unknown,
  opts: ValidateOptions = {},
): Promise<ValidationResult> {
  if (!isRecord(doc)) {
    return {
      errors: [
        err(
          'AUTOMATION_NOT_OBJECT',
          'the automation document must be a mapping/object: {version, name, inputs?, nodes, output?}',
          { at: { pointer: '' }, params: {} },
        ),
      ],
      warnings: [],
    };
  }

  const issues: Issue[] = [];
  validateDocument(doc, issues);

  if (!Array.isArray(doc.nodes) || doc.nodes.length === 0) {
    issues.push(
      err(
        'NODES_MISSING',
        '"nodes" must be a non-empty array of node objects',
        {
          path: 'nodes',
          at: {
            pointer: '/nodes',
            ...(doc.nodes === undefined && { subject: 'missing' as const }),
          },
          params: {},
        },
      ),
    );
    return split(issues);
  }
  if (doc.nodes.length > MAX_NODES) {
    issues.push(
      err(
        'NODES_TOO_MANY',
        `automation has ${doc.nodes.length} nodes — at most ${MAX_NODES} per automation`,
        {
          path: 'nodes',
          hint: 'extract cohesive groups into saved automations and call them with subautomation nodes',
          at: { pointer: '/nodes' },
          params: { count: doc.nodes.length, max: MAX_NODES },
        },
      ),
    );
  }

  const ctx = createValidationContext(doc, issues, opts.store);
  if (opts.store !== undefined) {
    ctx.children = await resolveChildren(doc, opts.store);
  }
  const { validNodes, ids } = await validateNodes(ctx);
  await validateReferences(ctx, validNodes, ids);
  await validateContracts(ctx, validNodes);

  // Duplicate ids already carry their own error; the analysis reads the
  // first occurrence of each, like both executors.
  const unique: NodeDef[] = [];
  const seen = new Set<string>();
  for (const n of validNodes) {
    if (seen.has(n.id)) continue;
    seen.add(n.id);
    unique.push(n);
  }
  const analyzed = analyze({
    doc,
    nodes: unique,
    indexOf: (n) => ctx.indexOf(n),
    sources: (index) => ctx.sources(index),
    outputSources: () => ctx.outputSources(),
    parse: ctx.parse,
    ...(ctx.children !== undefined && { children: ctx.children }),
    issues: [...issues],
  });
  issues.push(...analyzed.issues);
  if (opts.store?.orgFacts !== undefined) {
    issues.push(
      ...(await orgState(opts.store.orgFacts.bind(opts.store), {
        doc,
        nodes: unique,
        indexOf: (n) => ctx.indexOf(n),
      })),
    );
  }

  const detail = new Set(opts.detail ?? []);
  return {
    ...split(issues),
    ...(detail.has('analysis') &&
      analyzed.analysis !== undefined && { analysis: analyzed.analysis }),
    ...(detail.has('types') && { types: analyzed.types }),
  };
}

/**
 * What the document names of the organization against what it has: the
 * host is asked once, for only the facts the document needs. A host that
 * cannot answer is a host that cannot tell — the document has no problem.
 */
async function orgState(
  orgFacts: NonNullable<StoreAdapter['orgFacts']>,
  input: OrgStateInput,
): Promise<Issue[]> {
  const query = orgFactsQuery(input);
  if (query === null) return [];
  let facts: OrgFacts;
  try {
    facts = await orgFacts(query);
  } catch (e) {
    console.warn(
      '[engine] skipping the organization checks (store lookup failed):',
      e instanceof Error ? e.message : e,
    );
    return [];
  }
  return orgStateIssues(input, facts);
}

function split(issues: Issue[]): { errors: Issue[]; warnings: Issue[] } {
  return {
    errors: issues.filter((i) => i.level === 'error'),
    warnings: issues.filter((i) => i.level === 'warning'),
  };
}
