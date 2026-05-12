/**
 * Cap on how many entries the inlined `versionHistory` array on each
 * promptTemplates row keeps. When a publish would push past this, the oldest
 * entry is dropped (FIFO) and a console.warn is emitted once. 50 × ~4 KiB
 * stays well under the 1 MiB Convex per-document limit.
 */
export const MAX_PROMPT_VERSION_HISTORY = 50;
