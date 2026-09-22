/** One selectable subject for a metrics page (a project, an agent, a pack). */
export interface MetricsScopeOption {
  value: string;
  label: string;
}

/**
 * The scope a metrics page should adopt on its own, or `undefined` to leave the
 * choice to the operator.
 *
 * A scope-gated page renders nothing until a subject is picked, so with exactly
 * ONE option and nothing selected the empty state is a pure dead end — the sole
 * option IS the scope. Two or more stays unselected on purpose: silently
 * scoping to an arbitrary subject invites reading one project's numbers as
 * another's. Never resolves while the option list is still loading, since a
 * half-loaded list of one would auto-scope to the wrong subject.
 */
export function soleScopeValue(
  options: ReadonlyArray<MetricsScopeOption>,
  selected: string | undefined,
  isLoading: boolean,
): string | undefined {
  if (isLoading || selected) return undefined;
  return options.length === 1 ? options[0]?.value : undefined;
}
