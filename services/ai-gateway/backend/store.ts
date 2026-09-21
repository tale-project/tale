/**
 * Where the gateway keeps its accounts.
 *
 * A credential pool is a handful of records, not a dataset: one JSON document
 * under `AI_GATEWAY_DATA_DIR`, rewritten whole on every change. That keeps the
 * service a single process with nothing to provision — the same property that
 * makes the org-configuration trees files rather than rows — and it matches
 * the shape of the thing: an operator can read it, back it up by copying it,
 * and move it between machines.
 *
 * Two properties the implementation owes that a database would give for free:
 * writes are atomic (a temporary file is renamed over the document, so a crash
 * mid-write leaves the previous one intact) and serialized (every mutation
 * queues behind the last, so two concurrent requests cannot both read-modify-
 * write the same document and lose one of the changes).
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { z } from 'zod';

import { isRecord } from './providers/oauth';
import { PROVIDER_IDS } from './providers/types';
import type { ProviderId, UsageWindow } from './providers/types';

/** Only the owner may read a file of subscription credentials. */
const FILE_MODE = 0o600;

export type AccountStatus = 'active' | 'expired' | 'error';

const usageWindowSchema = z.object({
  kind: z.enum(['session', 'weekly', 'scoped']),
  label: z.string().nullable(),
  utilization: z.number().nullable(),
  resetsAt: z.string().nullable(),
});

const accountSchema = z.object({
  id: z.string().min(1),
  provider: z.enum(PROVIDER_IDS),
  label: z.string(),
  accountEmail: z.string().nullable(),
  accountId: z.string().nullable(),
  plan: z.string().nullable(),
  /** Sealed by `backend/crypto.ts`; never a bare token. */
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresAt: z.string().nullable(),
  scopes: z.string().nullable(),
  status: z.enum(['active', 'expired', 'error']),
  createdAt: z.string(),
  lastRefreshedAt: z.string().nullable(),
  usage: z
    .object({ windows: z.array(usageWindowSchema), checkedAt: z.string() })
    .nullable(),
});

const pendingSchema = z.object({
  state: z.string().min(1),
  provider: z.enum(PROVIDER_IDS),
  codeVerifier: z.string().min(1),
  redirectUri: z.string().min(1),
  /** Set when completing this flow re-authenticates an existing account. */
  targetAccountId: z.string().nullable(),
  createdAt: z.string(),
});

const documentSchema = z.object({
  version: z.literal(1),
  accounts: z.array(accountSchema),
  pending: z.array(pendingSchema),
});

export type StoredAccount = z.infer<typeof accountSchema>;
export type PendingAuthorization = z.infer<typeof pendingSchema>;
type StoreDocument = z.infer<typeof documentSchema>;

const EMPTY: StoreDocument = { version: 1, accounts: [], pending: [] };

export class StoreError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'StoreError';
  }
}

export interface AccountStore {
  listAccounts(): Promise<StoredAccount[]>;
  getAccount(id: string): Promise<StoredAccount | null>;
  /** Insert or replace an account, keyed by id. */
  putAccount(account: StoredAccount): Promise<void>;
  deleteAccount(id: string): Promise<boolean>;
  addPending(pending: PendingAuthorization): Promise<void>;
  /** Read and consume a pending authorization; one-time by construction. */
  takePending(state: string): Promise<PendingAuthorization | null>;
  /** Drop authorizations nobody completed. Returns how many went. */
  prunePending(maxAgeMs: number, now?: Date): Promise<number>;
}

export interface FileAccountStoreOptions {
  dataDir: string;
  /** File name inside the data directory. */
  fileName?: string;
}

export function createFileAccountStore(
  options: FileAccountStoreOptions,
): AccountStore {
  const filePath = join(options.dataDir, options.fileName ?? 'accounts.json');
  // Every mutation appends to this chain, so read-modify-write pairs never
  // interleave. A rejected link must not poison the chain, hence the catch.
  let queue: Promise<unknown> = Promise.resolve();

  async function read(): Promise<StoreDocument> {
    let raw: string;
    try {
      raw = await readFile(filePath, 'utf8');
    } catch (error) {
      // The first boot has no document yet; anything else is a real failure.
      if (isRecord(error) && error['code'] === 'ENOENT') {
        return structuredClone(EMPTY);
      }
      throw new StoreError(`Could not read ${filePath}.`, { cause: error });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new StoreError(`${filePath} is not valid JSON.`, { cause: error });
    }

    const result = documentSchema.safeParse(parsed);
    if (!result.success) {
      throw new StoreError(
        `${filePath} is not a gateway account document: ${result.error.issues
          .map((issue) => `${issue.path.join('.')} ${issue.message}`)
          .join('; ')}`,
      );
    }
    return result.data;
  }

  async function write(document: StoreDocument): Promise<void> {
    await mkdir(dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.tmp`;
    try {
      await writeFile(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, {
        encoding: 'utf8',
        mode: FILE_MODE,
      });
      await rename(temporaryPath, filePath);
    } catch (error) {
      throw new StoreError(`Could not write ${filePath}.`, { cause: error });
    }
  }

  function mutate<T>(
    change: (document: StoreDocument) => T | Promise<T>,
  ): Promise<T> {
    const next = queue.then(async () => {
      const document = await read();
      const result = await change(document);
      await write(document);
      return result;
    });
    queue = next.catch(() => undefined);
    return next;
  }

  return {
    async listAccounts() {
      const document = await read();
      return [...document.accounts].sort((a, b) =>
        a.createdAt.localeCompare(b.createdAt),
      );
    },

    async getAccount(id) {
      const document = await read();
      return document.accounts.find((account) => account.id === id) ?? null;
    },

    putAccount(account) {
      return mutate((document) => {
        const index = document.accounts.findIndex(
          (existing) => existing.id === account.id,
        );
        if (index === -1) document.accounts.push(account);
        else document.accounts[index] = account;
      });
    },

    deleteAccount(id) {
      return mutate((document) => {
        const index = document.accounts.findIndex(
          (account) => account.id === id,
        );
        if (index === -1) return false;
        document.accounts.splice(index, 1);
        return true;
      });
    },

    addPending(pending) {
      return mutate((document) => {
        document.pending.push(pending);
      });
    },

    takePending(state) {
      return mutate((document) => {
        const index = document.pending.findIndex(
          (entry) => entry.state === state,
        );
        if (index === -1) return null;
        const [taken] = document.pending.splice(index, 1);
        return taken ?? null;
      });
    },

    prunePending(maxAgeMs, now = new Date()) {
      return mutate((document) => {
        const cutoff = now.getTime() - maxAgeMs;
        const before = document.pending.length;
        document.pending = document.pending.filter((entry) => {
          const created = new Date(entry.createdAt).getTime();
          return Number.isFinite(created) && created >= cutoff;
        });
        return before - document.pending.length;
      });
    },
  };
}

/** An in-memory store, for tests and for a read-only smoke run. */
export function createMemoryAccountStore(): AccountStore {
  const document: StoreDocument = structuredClone(EMPTY);

  return {
    listAccounts: () =>
      Promise.resolve(
        [...document.accounts].sort((a, b) =>
          a.createdAt.localeCompare(b.createdAt),
        ),
      ),
    getAccount: (id) =>
      Promise.resolve(
        document.accounts.find((account) => account.id === id) ?? null,
      ),
    putAccount: (account) => {
      const index = document.accounts.findIndex(
        (existing) => existing.id === account.id,
      );
      if (index === -1) document.accounts.push(account);
      else document.accounts[index] = account;
      return Promise.resolve();
    },
    deleteAccount: (id) => {
      const index = document.accounts.findIndex((account) => account.id === id);
      if (index === -1) return Promise.resolve(false);
      document.accounts.splice(index, 1);
      return Promise.resolve(true);
    },
    addPending: (pending) => {
      document.pending.push(pending);
      return Promise.resolve();
    },
    takePending: (state) => {
      const index = document.pending.findIndex(
        (entry) => entry.state === state,
      );
      if (index === -1) return Promise.resolve(null);
      const [taken] = document.pending.splice(index, 1);
      return Promise.resolve(taken ?? null);
    },
    prunePending: (maxAgeMs, now = new Date()) => {
      const cutoff = now.getTime() - maxAgeMs;
      const before = document.pending.length;
      document.pending = document.pending.filter((entry) => {
        const created = new Date(entry.createdAt).getTime();
        return Number.isFinite(created) && created >= cutoff;
      });
      return Promise.resolve(before - document.pending.length);
    },
  };
}

/** What the panel may see: every field except the credentials themselves. */
export interface AccountView {
  id: string;
  provider: ProviderId;
  label: string;
  accountEmail: string | null;
  plan: string | null;
  status: AccountStatus;
  expiresAt: string | null;
  scopes: string | null;
  createdAt: string;
  lastRefreshedAt: string | null;
  usage: { windows: UsageWindow[]; checkedAt: string } | null;
}

export function toAccountView(account: StoredAccount): AccountView {
  return {
    id: account.id,
    provider: account.provider,
    label: account.label,
    accountEmail: account.accountEmail,
    plan: account.plan,
    status: account.status,
    expiresAt: account.expiresAt,
    scopes: account.scopes,
    createdAt: account.createdAt,
    lastRefreshedAt: account.lastRefreshedAt,
    usage: account.usage,
  };
}
