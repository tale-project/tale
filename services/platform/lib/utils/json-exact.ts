/**
 * `JSON.parse` that reports what it had to round: a whole number beyond
 * ±(2^53 − 1) is rounded by the parser before any schema sees it, so a
 * source system's 64-bit id arrived silently altered and was stored that
 * way (the REST body, 2026-09-14 evaluation, g7-7b) — and a JSON-RPC `id`
 * above 2^53 was echoed as its neighbour, so a client keying its
 * correlation table on snowflake ids never matched the reply (the MCP
 * door, 2026-09-19 evaluation, K8-2). The reviver reads the literal's own
 * source text (Node 22 / Bun) and records the holder of the first such
 * literal; the tree is then walked to name the FULL path
 * (`messages.0.createdAt`, not the bare `createdAt`) so a client mapping
 * the path back to a row can find it. Throws exactly what `JSON.parse`
 * throws when the text is not JSON at all.
 */
export type ExactJson =
  | { readonly exact: true; readonly value: unknown }
  | { readonly exact: false; readonly path: string };

export function parseJsonExact(raw: string): ExactJson {
  let inexact: { holder: unknown; key: string } | null = null;
  const reviver = function (
    this: unknown,
    key: string,
    value: unknown,
    context?: { source?: string },
  ): unknown {
    if (
      inexact === null &&
      typeof value === 'number' &&
      Number.isInteger(value) &&
      !Number.isSafeInteger(value) &&
      typeof context?.source === 'string' &&
      /^-?\d+$/.test(context.source)
    ) {
      inexact = { holder: this, key };
    }
    return value;
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the lib typing predates the reviver's source-text context
  const parsed: unknown = JSON.parse(
    raw,
    reviver as Parameters<typeof JSON.parse>[1],
  );
  if (inexact === null) return { exact: true, value: parsed };
  // The root literal's holder is JSON.parse's ephemeral `{ "": value }`
  // wrapper (key ""), so that case is the empty path; otherwise the holder
  // is a real node of the parsed tree.
  const found: { holder: unknown; key: string } = inexact;
  const base = found.key === '' ? '' : identityPath(parsed, found.holder);
  const path =
    found.key === ''
      ? ''
      : base === null
        ? found.key
        : base === ''
          ? found.key
          : `${base}.${found.key}`;
  return { exact: false, path };
}

/** The dotted path of `target` (an object or array) inside `root` by
 * identity, or null when it is not in the tree. Iterative, so a deep body
 * cannot exhaust the stack. */
function identityPath(root: unknown, target: unknown): string | null {
  const stack: { value: unknown; path: string }[] = [{ value: root, path: '' }];
  while (stack.length > 0) {
    const item = stack.pop();
    if (item === undefined) break;
    const current = item.value;
    if (current === target) return item.path;
    if (Array.isArray(current)) {
      for (let index = current.length - 1; index >= 0; index -= 1) {
        stack.push({
          value: current[index],
          path: item.path === '' ? String(index) : `${item.path}.${index}`,
        });
      }
    } else if (current !== null && typeof current === 'object') {
      for (const [key, child] of Object.entries(current)) {
        stack.push({
          value: child,
          path: item.path === '' ? key : `${item.path}.${key}`,
        });
      }
    }
  }
  return null;
}

/** The sentence the REST door and the MCP door both state for a literal
 * that cannot be carried exactly — one wording, wherever it is met. */
export const INEXACT_NUMBER_MESSAGE =
  'is a whole number beyond 2^53 − 1, which cannot be carried exactly; send it as a string';
