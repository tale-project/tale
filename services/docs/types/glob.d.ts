// Vite injects `import.meta.glob`; mirror the typing the docs loader uses
// so tsc accepts the eager raw imports.
interface ImportMeta {
  readonly glob: <T>(
    pattern: string | string[],
    options?: { query?: string; import?: string; eager?: boolean },
  ) => Record<string, T>;
}
