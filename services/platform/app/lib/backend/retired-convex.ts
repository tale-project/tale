/**
 * The named refusal for a backend call the app can no longer make.
 *
 * Every shipped read and write goes through the adapter registry
 * (`convex-adapters.ts`) to the pg backend, addressed by its contract name.
 * A name with no row cannot be served at all, and that must FAIL LOUDLY
 * rather than resolve to nothing: this error names the exact function, which
 * is also the registry key someone has to add.
 */
export class ConvexRetiredError extends Error {
  readonly functionName: string;

  constructor(functionName: string) {
    super(
      `"${functionName}" has no 0.5 backend row. The Convex runtime is ` +
        'retired: add an adapter row in app/lib/backend (READ_ADAPTERS, ' +
        'WRITE_ADAPTERS, ACTION_QUERY_ADAPTERS or PAGINATED_ADAPTERS) ' +
        'pointing at the route that serves it.',
    );
    this.name = 'ConvexRetiredError';
    this.functionName = functionName;
  }
}
