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
import type { ProviderId, Subscription, UsageWindow } from './providers/types';

/** Only the owner may read a file of subscription credentials. */
const FILE_MODE = 0o600;

export type AccountStatus = 'active' | 'expired' | 'error';

const usageWindowSchema = z.object({
  kind: z.enum(['session', 'weekly', 'scoped']),
  label: z.string().nullable(),
  utilization: z.number().nullable(),
  resetsAt: z.string().nullable(),
  // Defaulted rather than required: a document written before the panel drew
  // the countdown has readings with no length on them, and the next refresh
  // pass replaces each one anyway.
  windowSeconds: z.number().nullable().default(null),
});

const subscriptionSchema = z.object({
  plan: z.string().min(1),
  tier: z.string().nullable(),
});

const accountSchema = z.object({
  id: z.string().min(1),
  provider: z.enum(PROVIDER_IDS),
  label: z.string(),
  accountEmail: z.string().nullable(),
  accountId: z.string().nullable(),
  // A document written before the plan had a column of its own carries a
  // `plan` string instead — for an Anthropic account, the organization's
  // NAME. The object strips that key on read, and the next pass reads the
  // subscription afresh, so no row keeps showing an org name as its plan.
  subscription: subscriptionSchema.nullable().default(null),
  /** When the vendor was last asked who the account is and what it pays for. */
  identityCheckedAt: z.string().nullable().default(null),
  /** Sealed by `backend/crypto.ts`; never a bare token. */
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresAt: z.string().nullable(),
  scopes: z.string().nullable(),
  status: z.enum(['active', 'expired', 'error']),
  createdAt: z.string(),
  lastRefreshedAt: z.string().nullable(),
  /**
   * The last reading the vendor actually gave, and when it gave it. A failed
   * read leaves both alone, so `checkedAt` is always the age of the figures —
   * never a timestamp that makes an old reading look current.
   */
  usage: z
    .object({ windows: z.array(usageWindowSchema), checkedAt: z.string() })
    .nullable(),
  /**
   * When a usage read was last attempted, succeeded or not — what the polling
   * floor counts from, so a vendor that keeps failing is not asked on every
   * pass. Null in a document from before the two were apart; the floor then
   * counts from the reading.
   */
  usageAttemptedAt: z.string().nullable().default(null),
});

/**
 * An authorization somebody started, from the moment it is begun until well
 * after it finished.
 *
 * It outlives its completion on purpose: the automatic flows finish without
 * the panel — the gateway polls a device code, or the vendor redirects to
 * `/callback` — so the panel learns the outcome by asking after this entry.
 * `phase` is what keeps one authorization from minting two accounts: only an
 * `open` entry can be claimed, and claiming it is one atomic step.
 *
 * Every field past the original five is defaulted, so a document written
 * before the automatic flows reads as the paste flow it was.
 */
const pendingSchema = z.object({
  state: z.string().min(1),
  provider: z.enum(PROVIDER_IDS),
  /** Set when completing this flow re-authenticates an existing account. */
  targetAccountId: z.string().nullable(),
  createdAt: z.string(),
  flow: z.enum(['device', 'redirect', 'paste']).default('paste'),
  /** A name typed for the account; a flow that finishes alone still has it. */
  label: z.string().nullable().default(null),
  /** PKCE verifier and redirect, for a flow whose code comes back to us. */
  codeVerifier: z.string().default(''),
  redirectUri: z.string().default(''),
  /** The vendor's handle for a device code — sealed, as it opens a grant. */
  deviceAuthId: z.string().nullable().default(null),
  userCode: z.string().nullable().default(null),
  pollIntervalSeconds: z.number().nullable().default(null),
  /** When the vendor stops accepting the device code. */
  expiresAt: z.string().nullable().default(null),
  phase: z.enum(['open', 'claimed', 'connected', 'failed']).default('open'),
  /** The account a finished authorization connected. */
  accountId: z.string().nullable().default(null),
  /** Why a finished authorization failed, as the panel's error code. */
  failure: z.string().nullable().default(null),
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
  /**
   * Change one account as it is stored now: `change` edits the current row
   * in place. Every write after an account exists goes through here, so two
   * passes that each read the row earlier cannot overwrite each other's
   * fields — a rotated refresh token above all, which is lost for good once
   * an older copy lands on top of it. Answers the row as written, or null
   * when it is gone, which a late write must never bring back.
   */
  updateAccount(
    id: string,
    change: (account: StoredAccount) => void,
  ): Promise<StoredAccount | null>;
  deleteAccount(id: string): Promise<boolean>;
  addPending(pending: PendingAuthorization): Promise<void>;
  getPending(state: string): Promise<PendingAuthorization | null>;
  /**
   * Take an `open` authorization for completion, marking it `claimed` in the
   * same step: one-time by construction, so a replayed paste or a second
   * device poll that raced the first cannot finish it again. Null when it is
   * gone or no longer open.
   */
  claimPending(state: string): Promise<PendingAuthorization | null>;
  /** Record how a claimed authorization ended. */
  settlePending(
    state: string,
    outcome:
      | { phase: 'connected'; accountId: string }
      | { phase: 'failed'; failure: string },
  ): Promise<void>;
  /** Drop authorizations older than `maxAgeMs`. Returns how many went. */
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

    updateAccount(id, change) {
      return mutate((document) => {
        const account = document.accounts.find((row) => row.id === id);
        if (!account) return null;
        change(account);
        return structuredClone(account);
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

    async getPending(state) {
      return findPending(await read(), state);
    },

    claimPending(state) {
      return mutate((document) => claimIn(document, state));
    },

    settlePending(state, outcome) {
      return mutate((document) => {
        settleIn(document, state, outcome);
      });
    },

    prunePending(maxAgeMs, now = new Date()) {
      return mutate((document) => pruneIn(document, maxAgeMs, now));
    },
  };
}

/*
 * The pending-authorization rules, written once over a document so the file
 * store (inside its serialized mutation) and the memory store cannot drift
 * apart on what "one-time" means.
 */

function findPending(
  document: StoreDocument,
  state: string,
): PendingAuthorization | null {
  const entry = document.pending.find((pending) => pending.state === state);
  return entry ? structuredClone(entry) : null;
}

function claimIn(
  document: StoreDocument,
  state: string,
): PendingAuthorization | null {
  const entry = document.pending.find((pending) => pending.state === state);
  if (!entry || entry.phase !== 'open') return null;
  entry.phase = 'claimed';
  return structuredClone(entry);
}

function settleIn(
  document: StoreDocument,
  state: string,
  outcome:
    | { phase: 'connected'; accountId: string }
    | { phase: 'failed'; failure: string },
): void {
  const entry = document.pending.find((pending) => pending.state === state);
  if (!entry) return;
  entry.phase = outcome.phase;
  if (outcome.phase === 'connected') entry.accountId = outcome.accountId;
  else entry.failure = outcome.failure;
}

function pruneIn(document: StoreDocument, maxAgeMs: number, now: Date): number {
  const cutoff = now.getTime() - maxAgeMs;
  const before = document.pending.length;
  document.pending = document.pending.filter((entry) => {
    const created = new Date(entry.createdAt).getTime();
    return Number.isFinite(created) && created >= cutoff;
  });
  return before - document.pending.length;
}

/**
 * An in-memory store, for tests and for a read-only smoke run.
 *
 * Rows go in and come out as copies, the way the file store's reads are fresh
 * parses: a caller holding an account it read earlier has a copy that goes
 * stale, exactly as it would against the document — which is what lets a
 * test catch a write that lands an old copy over a newer row.
 */
export function createMemoryAccountStore(): AccountStore {
  const document: StoreDocument = structuredClone(EMPTY);

  return {
    listAccounts: () =>
      Promise.resolve(
        structuredClone(document.accounts).sort((a, b) =>
          a.createdAt.localeCompare(b.createdAt),
        ),
      ),
    getAccount: (id) => {
      const account = document.accounts.find((row) => row.id === id);
      return Promise.resolve(account ? structuredClone(account) : null);
    },
    putAccount: (account) => {
      const copy = structuredClone(account);
      const index = document.accounts.findIndex(
        (existing) => existing.id === account.id,
      );
      if (index === -1) document.accounts.push(copy);
      else document.accounts[index] = copy;
      return Promise.resolve();
    },
    updateAccount: (id, change) => {
      const account = document.accounts.find((row) => row.id === id);
      if (!account) return Promise.resolve(null);
      change(account);
      return Promise.resolve(structuredClone(account));
    },
    deleteAccount: (id) => {
      const index = document.accounts.findIndex((account) => account.id === id);
      if (index === -1) return Promise.resolve(false);
      document.accounts.splice(index, 1);
      return Promise.resolve(true);
    },
    addPending: (pending) => {
      document.pending.push(structuredClone(pending));
      return Promise.resolve();
    },
    getPending: (state) => Promise.resolve(findPending(document, state)),
    claimPending: (state) => Promise.resolve(claimIn(document, state)),
    settlePending: (state, outcome) => {
      settleIn(document, state, outcome);
      return Promise.resolve();
    },
    prunePending: (maxAgeMs, now = new Date()) =>
      Promise.resolve(pruneIn(document, maxAgeMs, now)),
  };
}

/** What the panel may see: every field except the credentials themselves. */
export interface AccountView {
  id: string;
  provider: ProviderId;
  label: string;
  accountEmail: string | null;
  subscription: Subscription | null;
  status: AccountStatus;
  expiresAt: string | null;
  scopes: string | null;
  createdAt: string;
  lastRefreshedAt: string | null;
  /**
   * The last reading, when it was read, and whether it is stale: the latest
   * attempt to read it failed, or the account cannot be read at all until it
   * is signed in again. A stale reading is still the best figure there is,
   * so it is shown — as what it is.
   */
  usage: {
    windows: UsageWindow[];
    checkedAt: string;
    stale: boolean;
  } | null;
}

/** Whether an account's figures are older than its latest try at them. */
function readingIsStale(account: StoredAccount): boolean {
  if (!account.usage) return false;
  if (account.status === 'expired') return true;
  const attempted = account.usageAttemptedAt
    ? new Date(account.usageAttemptedAt).getTime()
    : Number.NaN;
  const read = new Date(account.usage.checkedAt).getTime();
  return (
    Number.isFinite(attempted) && Number.isFinite(read) && attempted > read
  );
}

export function toAccountView(account: StoredAccount): AccountView {
  return {
    id: account.id,
    provider: account.provider,
    label: account.label,
    accountEmail: account.accountEmail,
    subscription: account.subscription,
    status: account.status,
    expiresAt: account.expiresAt,
    scopes: account.scopes,
    createdAt: account.createdAt,
    lastRefreshedAt: account.lastRefreshedAt,
    usage: account.usage
      ? { ...account.usage, stale: readingIsStale(account) }
      : null,
  };
}
