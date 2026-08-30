/**
 * `convexTest` module-glob normalization, shared by the 0.4 function-layer
 * suites.
 *
 * `convexTest` resolves function modules by their CONVEX-ROOT-relative key
 * (`sandbox/workspace_access.js`), but `import.meta.glob` keys are relative to
 * the TEST file — and the glob pattern must be a string literal, so each test
 * owns its own glob call and tells us which directory it globbed from.
 */

/** Normalize one glob key relative to the convex root, resolving `..`. */
function toConvexRootKey(dirFromRoot: string, globKey: string): string {
  const stack: string[] = [];
  for (const part of `${dirFromRoot}/${globKey}`.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  return stack.join('/');
}

/**
 * Convert an `import.meta.glob` result into the `{ 'path/from/convex/root':
 * loader }` map `convexTest` wants.
 *
 * @param rawModules result of `import.meta.glob('<…>/**\/*.*s')` in the test file
 * @param dirFromRoot the test file's directory relative to `convex/`
 */
export function buildModules(
  rawModules: Record<string, () => Promise<unknown>>,
  dirFromRoot: string,
): Record<string, () => Promise<unknown>> {
  const modules: Record<string, () => Promise<unknown>> = {};
  for (const [key, loader] of Object.entries(rawModules)) {
    modules[toConvexRootKey(dirFromRoot, key)] = loader;
  }
  return modules;
}
