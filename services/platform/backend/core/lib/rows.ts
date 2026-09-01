/* oxlint-disable typescript/no-explicit-any -- a row's shape is asserted at the
   boundary that reads it, not here. */
/**
 * Row and id types for the reused 0.4 handler bodies.
 *
 * The rows live in Postgres now, and the 0.5 ctx shim hands them back as plain
 * objects. There is no schema to derive a per-table shape from, so `Doc` is
 * deliberately open: a body that needs a real shape declares it locally (see
 * `tasks/helpers.ts` or `documents/access.ts`), which is also what porting a
 * body to a 0.5 domain module starts with.
 *
 * `Id` is a plain string — the branded `GenericId` retired with the runtime
 * that minted them; Postgres ids are text.
 *
 * HAND-MAINTAINED. It was `_generated/dataModel.d.ts` until the generator
 * (and the runtime it generated for) retired; nothing writes it now but a
 * person.
 */

/** Every table name is just a name; nothing validates it any more. */
export type TableNames = string;

/** A row, as the shim returns it. */
export type Doc<_TableName extends TableNames = TableNames> = Record<
  string,
  any
>;

/** A row id. Strings at rest, strings in flight. */
export type Id<_TableName extends TableNames = TableNames> = string;

/**
 * Permissive by construction: any table, any document, any named index. The
 * generated model encoded a schema that no longer governs anything, and
 * `AnyDataModel` is the opposite mistake — it declares NO indexes, so every
 * `withIndex('by_x')` in a reused body would fail to compile against a runtime
 * that in fact accepts it.
 */
export type DataModel = Record<
  string,
  {
    document: any;
    fieldPaths: string;
    indexes: Record<string, string[]>;
    searchIndexes: Record<
      string,
      { searchField: string; filterFields: string }
    >;
    vectorIndexes: Record<
      string,
      { vectorField: string; dimensions: number; filterFields: string }
    >;
  }
>;
