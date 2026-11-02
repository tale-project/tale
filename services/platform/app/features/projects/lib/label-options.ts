/**
 * What a project label picker offers: the Dispatch editor's label filters
 * and a project agent's label grant pick from the same list.
 */

import type { MultiSelectOption } from '@tale/ui/multi-select';

/** The options of a label picker with every label the stored value names, so
 * a label the project no longer has stays visible and removable. */
export function withStored(
  options: MultiSelectOption[],
  selected: readonly string[],
): MultiSelectOption[] {
  const missing = selected.filter(
    (name) => !options.some((option) => option.value === name),
  );
  return missing.length === 0
    ? options
    : [...options, ...missing.map((name) => ({ value: name, label: name }))];
}
