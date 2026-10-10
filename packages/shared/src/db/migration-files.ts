/** Files applied by the backend boot migrator, in filename order. */
export function isMigrationFile(name: string): boolean {
  if (name.endsWith('.sql')) return true;
  return (
    name.endsWith('.ts') &&
    !name.endsWith('.test.ts') &&
    !name.endsWith('.d.ts')
  );
}
