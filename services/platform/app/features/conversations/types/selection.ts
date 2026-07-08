export type SelectionState =
  | {
      type: 'individual';
      selectedIds: Set<string>;
    }
  | {
      type: 'all';
    };

export function isAllSelection(
  state: SelectionState,
): state is { type: 'all' } {
  return state.type === 'all';
}
