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
 * connector/store contracts and document quality. Validation is async end
 * to end: syntax checks ride the CodeRunner and subautomation resolution rides
 * the async store; with no runner installed, syntax checks are skipped
 * silently and re-run once a backend is wired.
 */

import { isRecord } from '../../../utils/type-utils';
import { err } from '../errors';
import type { Issue } from '../types';
import { validateContracts } from './contracts';
import { validateDocument } from './document';
import { validateNodes } from './nodes';
import { validateReferences } from './references';

const MAX_NODES = 40;

export async function validate(
  doc: unknown,
): Promise<{ errors: Issue[]; warnings: Issue[] }> {
  if (!isRecord(doc)) {
    return {
      errors: [
        err(
          'AUTOMATION_NOT_OBJECT',
          'the automation document must be a mapping/object: {version, name, inputs?, nodes, output?}',
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
        },
      ),
    );
  }

  const { validNodes, ids } = await validateNodes(doc.nodes, issues);
  await validateReferences(doc, validNodes, ids, issues);
  await validateContracts(doc, validNodes, issues);
  return split(issues);
}

function split(issues: Issue[]): { errors: Issue[]; warnings: Issue[] } {
  return {
    errors: issues.filter((i) => i.level === 'error'),
    warnings: issues.filter((i) => i.level === 'warning'),
  };
}
