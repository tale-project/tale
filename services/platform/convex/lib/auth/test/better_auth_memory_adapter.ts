/**
 * In-memory Better Auth adapter for unit/integration tests of email normalization
 * and duplicate-user merge paths.
 */

import type { BetterAuthMember, BetterAuthUser } from '../../../members/types';

type Model = 'user' | 'member' | 'account' | 'teamMember' | 'session';

type WhereClause = { field: string; value: string; operator: 'eq' };

type FindManyArgs = {
  model: Model;
  paginationOpts: { cursor: string | null; numItems: number };
  where: WhereClause[];
};

type CreateArgs = {
  input: { model: Model; data: Record<string, unknown> };
};

type UpdateManyArgs = {
  input: {
    model: Model;
    where: WhereClause[];
    update: Record<string, unknown>;
  };
};

type DeleteOneArgs = {
  input: { model: Model; where: WhereClause[] };
};

type MemoryRow = Record<string, unknown> & { _id: string };

export type BetterAuthMemoryStore = {
  users: Map<string, MemoryRow>;
  members: Map<string, MemoryRow>;
  accounts: Map<string, MemoryRow>;
  teamMembers: Map<string, MemoryRow>;
  sessions: Map<string, MemoryRow>;
  nextId: number;
};

export function createBetterAuthMemoryStore(): BetterAuthMemoryStore {
  return {
    users: new Map(),
    members: new Map(),
    accounts: new Map(),
    teamMembers: new Map(),
    sessions: new Map(),
    nextId: 1,
  };
}

function tableForModel(
  store: BetterAuthMemoryStore,
  model: Model,
): Map<string, MemoryRow> {
  switch (model) {
    case 'user':
      return store.users;
    case 'member':
      return store.members;
    case 'account':
      return store.accounts;
    case 'teamMember':
      return store.teamMembers;
    case 'session':
      return store.sessions;
    default: {
      const _exhaustive: never = model;
      throw new Error(`Unknown model: ${String(_exhaustive)}`);
    }
  }
}

function stringField(row: MemoryRow, field: string): string {
  const value = row[field];
  return typeof value === 'string' ? value : '';
}

function rowSortKey(row: MemoryRow): string {
  return stringField(row, '_id');
}

function matchesWhere(row: MemoryRow, where: WhereClause[]): boolean {
  return where.every((w) => stringField(row, w.field) === w.value);
}

function paginate<T>(
  rows: T[],
  cursor: string | null,
  numItems: number,
): {
  page: T[];
  isDone: boolean;
  continueCursor: string | null;
} {
  const start = cursor ? Number.parseInt(cursor, 10) : 0;
  const page = rows.slice(start, start + numItems);
  const next = start + page.length;
  return {
    page,
    isDone: next >= rows.length,
    continueCursor: next >= rows.length ? null : String(next),
  };
}

export function seedUser(
  store: BetterAuthMemoryStore,
  user: BetterAuthUser,
): void {
  store.users.set(user._id, { ...user });
}

export function seedMember(
  store: BetterAuthMemoryStore,
  member: BetterAuthMember & { _id: string },
): void {
  store.members.set(member._id, { ...member });
}

export function seedTeamMember(
  store: BetterAuthMemoryStore,
  teamMember: {
    _id: string;
    teamId: string;
    userId: string;
    createdAt?: number;
  },
): void {
  store.teamMembers.set(teamMember._id, { ...teamMember });
}

export function listTeamMembers(store: BetterAuthMemoryStore): MemoryRow[] {
  return [...store.teamMembers.values()];
}

export function listUsers(store: BetterAuthMemoryStore): BetterAuthUser[] {
  // Test seeds always write full Better Auth user rows.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- memory store rows are seeded as BetterAuthUser
  return [...store.users.values()] as BetterAuthUser[];
}

export function handleBetterAuthFindMany(
  store: BetterAuthMemoryStore,
  args: FindManyArgs,
): {
  page: Record<string, unknown>[];
  isDone: boolean;
  continueCursor: string | null;
} {
  const table = tableForModel(store, args.model);
  let rows = [...table.values()];
  if (args.where.length > 0) {
    rows = rows.filter((row) => matchesWhere(row, args.where));
  }
  rows.sort((a, b) => rowSortKey(a).localeCompare(rowSortKey(b)));
  return paginate(
    rows,
    args.paginationOpts.cursor,
    args.paginationOpts.numItems,
  );
}

export function handleBetterAuthCreate(
  store: BetterAuthMemoryStore,
  args: CreateArgs,
): Record<string, unknown> {
  const id = `id_${store.nextId++}`;
  const row = { _id: id, ...args.input.data };
  tableForModel(store, args.input.model).set(id, row);
  return row;
}

export function handleBetterAuthUpdateMany(
  store: BetterAuthMemoryStore,
  args: UpdateManyArgs,
): void {
  const table = tableForModel(store, args.input.model);
  for (const [id, row] of table.entries()) {
    if (matchesWhere(row, args.input.where)) {
      table.set(id, { ...row, ...args.input.update });
    }
  }
}

export function handleBetterAuthDeleteOne(
  store: BetterAuthMemoryStore,
  args: DeleteOneArgs,
): void {
  const table = tableForModel(store, args.input.model);
  for (const [id, row] of table.entries()) {
    if (matchesWhere(row, args.input.where)) {
      table.delete(id);
      return;
    }
  }
}

const ADAPTER = {
  findMany: 'betterAuth.adapter.findMany',
  create: 'betterAuth.adapter.create',
  updateMany: 'betterAuth.adapter.updateMany',
  deleteOne: 'betterAuth.adapter.deleteOne',
} as const;

export function createBetterAuthTestCtx(
  store: BetterAuthMemoryStore,
  db?: {
    insert: (table: string, doc: Record<string, unknown>) => Promise<string>;
    query: (table: string) => {
      filter: (
        fn: (q: {
          eq: (a: unknown, b: unknown) => unknown;
          field: (name: string) => unknown;
        }) => unknown,
      ) => { collect: () => Promise<Array<Record<string, unknown>>> };
      withIndex: (
        _name: string,
        fn: (q: { eq: (field: string, value: string) => unknown }) => unknown,
      ) => {
        first: () => Promise<Record<string, unknown> | null>;
        collect: () => Promise<Array<Record<string, unknown>>>;
      };
    };
    patch: (id: string, update: Record<string, unknown>) => Promise<void>;
    delete: (id: string) => Promise<void>;
  },
): {
  runQuery: (
    ref: unknown,
    args: FindManyArgs,
  ) => Promise<ReturnType<typeof handleBetterAuthFindMany>>;
  runMutation: (
    ref: unknown,
    args: CreateArgs | UpdateManyArgs | DeleteOneArgs,
  ) => Promise<unknown>;
  db: NonNullable<typeof db>;
} {
  return {
    db: db ?? stubDb(),
    runQuery: async (ref, args) => {
      if (ref === ADAPTER.findMany) {
        return handleBetterAuthFindMany(store, args);
      }
      throw new Error(`Unexpected runQuery ref: ${String(ref)}`);
    },
    runMutation: async (ref, args) => {
      if (ref === ADAPTER.create) {
        return handleBetterAuthCreate(store, args);
      }
      if (ref === ADAPTER.updateMany) {
        handleBetterAuthUpdateMany(store, args);
        return null;
      }
      if (ref === ADAPTER.deleteOne) {
        handleBetterAuthDeleteOne(store, args);
        return null;
      }
      throw new Error(`Unexpected runMutation ref: ${String(ref)}`);
    },
  };
}

function stubDb(): {
  insert: (table: string, doc: Record<string, unknown>) => Promise<string>;
  query: (table: string) => {
    filter: () => { collect: () => Promise<Array<Record<string, unknown>>> };
    withIndex: () => {
      first: () => Promise<Record<string, unknown> | null>;
      collect: () => Promise<Array<Record<string, unknown>>>;
    };
  };
  patch: (id: string, update: Record<string, unknown>) => Promise<void>;
  delete: (id: string) => Promise<void>;
} {
  const tables = new Map<string, Map<string, Record<string, unknown>>>();
  let next = 1;
  function table(name: string): Map<string, Record<string, unknown>> {
    let t = tables.get(name);
    if (!t) {
      t = new Map();
      tables.set(name, t);
    }
    return t;
  }
  return {
    insert: async (name, doc) => {
      const id = `doc_${next++}`;
      table(name).set(id, { _id: id, ...doc });
      return id;
    },
    query: (name) => ({
      filter: () => ({
        collect: async () => [...table(name).values()],
      }),
      withIndex: () => ({
        first: async () => [...table(name).values()][0] ?? null,
        collect: async () => [...table(name).values()],
      }),
    }),
    patch: async (id, update) => {
      for (const rows of tables.values()) {
        const row = rows.get(id);
        if (row) {
          rows.set(id, { ...row, ...update });
          return;
        }
      }
    },
    delete: async (id) => {
      for (const rows of tables.values()) {
        rows.delete(id);
      }
    },
  };
}

export { ADAPTER as BETTER_AUTH_ADAPTER_REFS };
