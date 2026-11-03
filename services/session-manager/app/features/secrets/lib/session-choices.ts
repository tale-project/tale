/** A session a secret can be for: all a picker needs of it. */
export interface SessionChoice {
  id: number;
  name: string;
}

/**
 * The sessions of several sources as one list, each once (the first source
 * that names it wins), in the order a person reads them: by name, with
 * numbers compared as numbers ("2" before "10").
 */
export function mergeSessionChoices(
  ...sources: ReadonlyArray<readonly SessionChoice[]>
): SessionChoice[] {
  const byId = new Map<number, SessionChoice>();
  for (const source of sources) {
    for (const { id, name } of source) {
      if (!byId.has(id)) byId.set(id, { id, name });
    }
  }
  return [...byId.values()].sort(
    (a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true }) || a.id - b.id,
  );
}
