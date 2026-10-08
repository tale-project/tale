/**
 * Facts about a parsed transform body that hold regardless of data: whether
 * it returns, and whether it reaches for module loading, the network or the
 * host process — which the data-only runner never provides.
 */

import type { Node } from 'estree';
import { walk } from 'zimmerframe';

import { collectRefs } from './walk';

/** Names a transform body may not call or read; the runner has none. */
const IO_CALLS: ReadonlySet<string> = new Set(['require', 'fetch']);

/** Every undeclared name `findIoAccess` judges — CODE_NO_IO's subject, so
 * no other rule reports them in a body. */
export const IO_NAMES: ReadonlySet<string> = new Set([...IO_CALLS, 'process']);

/**
 * The first module, network or host-process access in a body: a call of an
 * undeclared `require`/`fetch`, a dynamic `import(...)`, or a member of an
 * undeclared `process`. `token` is the source text up to and including the
 * `(` or `.` that makes it an access (`fetch(`, `process.`).
 */
export function findIoAccess(
  ast: Node,
  code: string,
  roots: ReadonlySet<string>,
): { token: string; range: [number, number] } | null {
  const hits: Array<{ token: string; range: [number, number] }> = [];
  const upTo = (start: number, from: number, char: string): void => {
    const at = code.indexOf(char, from);
    if (at === -1) return;
    hits.push({ token: code.slice(start, at + 1), range: [start, at + 1] });
  };
  for (const site of collectRefs(ast, { roots })) {
    if (site.root !== 'free') continue;
    const [start] = site.range;
    if (IO_CALLS.has(site.name) && site.called && site.path.length === 0) {
      upTo(start, start + site.name.length, '(');
    } else if (site.name === 'process' && site.path.length > 0) {
      upTo(start, start + site.name.length, '.');
    }
  }
  walk<Node, null>(ast, null, {
    ImportExpression(node, { next }) {
      const [start] = node.range ?? [0, 0];
      upTo(start, start + 'import'.length, '(');
      next();
    },
  });
  hits.sort((a, b) => a.range[0] - b.range[0]);
  return hits[0] ?? null;
}

function isFunctionNode(node: Node): boolean {
  return (
    node.type === 'FunctionDeclaration' ||
    node.type === 'FunctionExpression' ||
    node.type === 'ArrowFunctionExpression'
  );
}

/** Whether the body itself returns — a `return` inside a nested function
 * returns from that function, not from the body. */
export function hasTopLevelReturn(ast: Node): boolean {
  let found = false;
  walk<Node, null>(ast, null, {
    _(node, { next, stop }) {
      if (node.type === 'ReturnStatement') {
        found = true;
        stop();
        return;
      }
      if (isFunctionNode(node)) return;
      next();
    },
  });
  return found;
}
