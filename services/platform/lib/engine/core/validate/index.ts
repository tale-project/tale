/**
 * Static validation — four passes over an automation document, each pass only
 * seeing what the previous one proved.
 *
 * Returns `{errors, warnings}` where every Issue carries a machine-readable
 * code from the catalog and, wherever possible, an actionable hint — issues
 * are the author's primary feedback signal, and the full rendered output is
 * golden-tested (golden-errors.yml), so changing any message is a
 * deliberate, reviewed API change.
 *
 * Order: document shape → per-node structure → references and templates →
 * connector/store contracts and document quality. Every issue says where it
 * is (`at`: a JSON Pointer, and the range inside the string for code) and
 * what its sentence is built from (`params`).
 *
 * Syntax is the parser's (`../syntax`): acorn locates every error, and where
 * a CodeRunner is installed it confirms a rejection before it is reported —
 * code the runner compiles is valid, merely opaque to the analysis. Without
 * a runner the parser's verdict stands. Subautomation resolution rides the
 * caller-supplied async store.
 */

import { isRecord } from '../../../utils/type-utils';
import { err } from '../errors';
import type { StoreAdapter } from '../slots';
import type { Issue } from '../types';
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
}

export async function validate(
  doc: unknown,
  opts: ValidateOptions = {},
): Promise<{ errors: Issue[]; warnings: Issue[] }> {
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
  const { validNodes, ids } = await validateNodes(ctx);
  await validateReferences(ctx, validNodes, ids);
  await validateContracts(ctx, validNodes);
  return split(issues);
}

function split(issues: Issue[]): { errors: Issue[]; warnings: Issue[] } {
  return {
    errors: issues.filter((i) => i.level === 'error'),
    warnings: issues.filter((i) => i.level === 'warning'),
  };
}
