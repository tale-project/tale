/**
 * How a node is named to a person.
 *
 * Kept apart from the canvas graph (`./graph`), which parses every
 * expression of the document: a surface that only names nodes — the run
 * step timeline in a task's run dialog — must not load the parser with it.
 */

/** Node ids are `^[a-z][a-z0-9_]{0,49}$` — readable, but underscored. One
 * rendering shared by every surface that names a node to a person. */
export function humanizeNodeId(id: string): string {
  return id.replaceAll('_', ' ');
}
