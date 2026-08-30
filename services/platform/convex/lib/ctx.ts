/* oxlint-disable typescript/no-explicit-any -- rows are shaped at the boundary
   that reads them; see the note on `Doc` in ./dataModel. */
/**
 * The context types the reused 0.4 handler bodies are written against.
 *
 * This is a description of what the 0.5 ctx shim (`backend/lib/convex-shim.ts`)
 * actually hands a body, not a re-export of the retired runtime's types. Two
 * things differ from what the generator used to emit, and both differences are
 * the point:
 *
 * 1. **Ids are strings.** The branded `GenericId` retired with the runtime that
 *    minted them; Postgres ids are text, and a body that reads one out of a row
 *    and passes it back to `db.get` should compile.
 * 2. **Every ctx can `runQuery`/`runMutation`/`runAction`.** The shim keeps one
 *    handler table and one dispatch path, so the query/mutation/action ladder
 *    the runtime enforced is not a distinction it can make.
 *
 * `db` is still here because 26 reused modules still read rows through it. It
 * is the surface that shrinks as domains are ported: when a module's rows move
 * to a 0.5 domain module, its `db` calls go with them.
 *
 * HAND-MAINTAINED. It was `_generated/server.d.ts` until the generator (and
 * the runtime it generated for) retired; nothing writes it now but a person.
 */

/**
 * A row, as the shim returns it. `any`, not `Record<string, any>`: a reused
 * body reads a row straight into whatever local shape it declares, and a
 * record type would refuse every one of those.
 *
 * The `| null` on the readers below is therefore redundant to the CHECKER and
 * load-bearing to the READER — it is the only place absence is written down.
 */
// oxlint-disable typescript/no-redundant-type-constituents -- see above
type Row = any;

/** What `paginate` is given and gives back. */
export interface PaginationOptions {
  numItems: number;
  cursor: string | null;
  endCursor?: string | null;
  id?: number;
  maximumRowsRead?: number;
  maximumBytesRead?: number;
}

export interface PaginationResult<T> {
  page: T[];
  isDone: boolean;
  continueCursor: string;
  splitCursor?: string | null;
  pageStatus?: 'SplitRecommended' | 'SplitRequired' | null;
}

/**
 * The index-range builder. Unlike the generated one it does not step through a
 * declared field list — there is no schema to declare it — so every bound
 * chains onto every other.
 */
export interface IndexRangeBuilder {
  eq(field: string, value: any): IndexRangeBuilder;
  gt(field: string, value: any): IndexRangeBuilder;
  gte(field: string, value: any): IndexRangeBuilder;
  lt(field: string, value: any): IndexRangeBuilder;
  lte(field: string, value: any): IndexRangeBuilder;
}

/** The search-index range builder. */
export interface SearchFilterBuilder {
  search(field: string, query: string): SearchFilterBuilder;
  eq(field: string, value: any): SearchFilterBuilder;
}

/** The expression builder handed to `.filter`. */
export interface FilterBuilder {
  field(path: string): any;
  eq(left: any, right: any): any;
  neq(left: any, right: any): any;
  lt(left: any, right: any): any;
  lte(left: any, right: any): any;
  gt(left: any, right: any): any;
  gte(left: any, right: any): any;
  add(left: any, right: any): any;
  sub(left: any, right: any): any;
  and(...exprs: any[]): any;
  or(...exprs: any[]): any;
  not(expr: any): any;
}

export interface OrderedQuery extends AsyncIterable<Row> {
  filter(predicate: (q: FilterBuilder) => any): OrderedQuery;
  collect(): Promise<Row[]>;
  take(count: number): Promise<Row[]>;
  first(): Promise<Row | null>;
  unique(): Promise<Row | null>;
  paginate(options: PaginationOptions): Promise<PaginationResult<Row>>;
}

export interface TableQuery extends OrderedQuery {
  withIndex(
    index: string,
    range?: (q: IndexRangeBuilder) => IndexRangeBuilder,
  ): TableQuery;
  withSearchIndex(
    index: string,
    range: (q: SearchFilterBuilder) => SearchFilterBuilder,
  ): OrderedQuery;
  fullTableScan(): TableQuery;
  order(direction: 'asc' | 'desc'): OrderedQuery;
}

export interface DatabaseReader {
  get(id: string): Promise<Row | null>;
  query(table: string): TableQuery;
  /** Returns the id if it names a row in `table`, else null. */
  normalizeId(table: string, id: string): string | null;
  /** The system tables (`_scheduled_functions`, `_storage`). */
  system: DatabaseReader;
}

export interface DatabaseWriter extends DatabaseReader {
  insert(table: string, value: Record<string, any>): Promise<string>;
  patch(id: string, value: Record<string, any>): Promise<void>;
  replace(id: string, value: Record<string, any>): Promise<void>;
  delete(id: string): Promise<void>;
}

/** The caller, as the shim resolves it from the session. */
export interface UserIdentity {
  subject: string;
  tokenIdentifier: string;
  issuer: string;
  email?: string;
  emailVerified?: boolean;
  name?: string;
  givenName?: string;
  familyName?: string;
  pictureUrl?: string;
  [claim: string]: unknown;
}

export interface Auth {
  getUserIdentity(): Promise<UserIdentity | null>;
}

export interface StorageReader {
  getUrl(id: string): Promise<string | null>;
}

export interface StorageWriter extends StorageReader {
  generateUploadUrl(): Promise<string>;
  delete(id: string): Promise<void>;
}

export interface StorageActionWriter extends StorageWriter {
  get(id: string): Promise<Blob | null>;
  store(blob: Blob, options?: { sha256?: string }): Promise<string>;
}

export interface Scheduler {
  runAfter(delayMs: number, fn: any, args?: any): Promise<string>;
  runAt(timestamp: number | Date, fn: any, args?: any): Promise<string>;
  cancel(id: string): Promise<void>;
}

/** The dispatch trio every ctx carries — see the note at the top. */
export interface Runner {
  runQuery(fn: any, args?: any): Promise<any>;
  runMutation(fn: any, args?: any): Promise<any>;
  runAction(fn: any, args?: any): Promise<any>;
}

export interface QueryCtx extends Runner {
  db: DatabaseReader;
  auth: Auth;
  storage: StorageReader;
}

export interface MutationCtx extends Runner {
  db: DatabaseWriter;
  auth: Auth;
  storage: StorageWriter;
  scheduler: Scheduler;
}

export interface ActionCtx extends Runner {
  auth: Auth;
  storage: StorageActionWriter;
  scheduler: Scheduler;
  vectorSearch(table: string, index: string, query: any): Promise<any[]>;
}
