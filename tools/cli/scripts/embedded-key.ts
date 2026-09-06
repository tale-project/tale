/**
 * Build the key an embedded file is stored under in the generated
 * `embedded-files.ts` map.
 *
 * Keys are a POSIX contract, not a host path: `getEmbeddedExamples()` matches
 * the literal `builtin-configs/<domain>/`, the generator files the catalog by
 * `startsWith('builtin-configs/')`, and `.tale/reference/...` restores rely on
 * the same shape. `path.join` on a Windows host would emit
 * `builtin-configs\agents\...`, so every prefix match returned nothing and a
 * Windows-built `tale init` scaffolded empty domain dirs. Split on BOTH
 * separators (a Windows `relative()` yields backslashes; git-checked catalog
 * names cannot contain one) and join with `/` regardless of `path.sep`.
 */
export function toEmbeddedKey(prefix: string, relFromBase: string): string {
  const segments = relFromBase.split(/[\\/]+/).filter((s) => s.length > 0);
  return [prefix, ...segments].join('/');
}
