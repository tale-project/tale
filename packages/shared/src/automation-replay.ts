/**
 * How a run is run again: with its own input (`again`), with an input a
 * person edited (`edited`), or from one of its steps (`from`). A leaf with no
 * imports, so the engine's planner and the doors' request schema share one
 * list.
 */
export const REPLAY_KINDS = ['again', 'edited', 'from'] as const;

export type ReplayKind = (typeof REPLAY_KINDS)[number];
