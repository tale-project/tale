/**
 * DB half of the baseline world corpus: inserts a representative fresh-0.4.0
 * deployment — one or two rows per live domain, in CURRENT schema shapes —
 * under `worldSchema` (`../world_schema.testkit.ts` = the real
 * `convex/schema.ts`) validation. The fs half lives in `seed_fs.testkit.ts`;
 * the registry of what exists and why in `manifest.testkit.ts`.
 *
 * DETERMINISM CONTRACT: every value below is a fixed literal or an offset of
 * {@link WORLD_EPOCH_MS} — never `Date.now()`/`Math.random()`. Convex ids
 * come from convex-test's deterministic insertion order; storage ids from
 * the caller-supplied `storeBlob` in the same fixed order.
 *
 * `baseline-alpha` carries every seeded table, `baseline-beta` a small
 * subset (the second datapoint for per-org fleet migrations),
 * `baseline-empty` nothing. The deferred-drop tables
 * (`taskAgentRuns`/`wfExecutions`, see convex/legacy/schema.ts) are
 * deliberately NOT seeded — 0.4+ deployments can never hold rows there.
 *
 * Two-dot basename keeps this out of the Convex push bundle.
 */

import type { MutationCtx } from '../../../_generated/server';

/** Fixed timestamp base for all seeded times (2024-05-29T17:06:40Z). */
export const WORLD_EPOCH_MS = 1717000000000;

/**
 * The deterministic 32-byte encryption key the harness stubs as
 * `ENCRYPTION_SECRET_HEX` before seeding, so any future migration that
 * decrypts seeded secret envelopes can be given real ciphertext constants
 * under a known key (same convention the pre-reset corpus used).
 */
export const WORLD_ENCRYPTION_SECRET_HEX =
  '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';

/** One org as returned by `support.seedAuthOrgs` — the REAL component id. */
export interface WorldOrgRef {
  id: string;
  slug: string;
}

/** The three seeded orgs, keyed like `manifest.WORLD_ORGS`. */
export interface SeedWorldOrgs {
  alpha: WorldOrgRef;
  beta: WorldOrgRef;
  empty: WorldOrgRef;
}

export interface SeedWorldOptions {
  /**
   * Stores a blob and returns its `_storage` id — the harness supplies
   * `(content) => ctx.storage.store(new Blob([content]))`. Called in a fixed
   * order so storage ids stay reproducible.
   */
  storeBlob: (content: string) => Promise<string>;
}

/**
 * Every blob the corpus stores, IN storeBlob-call order. The container e2e's
 * `support.seedWorld` action pre-stores exactly this list (actions can reach
 * `ctx.storage`; the transactional row seeder cannot) and feeds the ids back
 * as a queue — a count mismatch throws, so the list cannot drift from the
 * `storeBlob` call sites below.
 */
export const WORLD_BLOB_CONTENTS = ['world-alpha-file-content'] as const;

/** Deterministic corpus user ids (plain Better Auth userId strings). */
export const WORLD_USERS = {
  alphaOwner: 'world-user-alpha-owner',
  alphaMember: 'world-user-alpha-member',
  betaOwner: 'world-user-beta-owner',
} as const;

const T0 = WORLD_EPOCH_MS;

/**
 * 2100-01-01T00:00:00Z — a heartbeat no stale-sweep cron ever reaps (see the
 * generations insert below for why the world's one in-flight row needs it).
 */
const WORLD_SWEEP_PROOF_HEARTBEAT_MS = 4102444800000;

/**
 * Seed every baseline row. Runs inside one `t.run` transaction; inserts are
 * schema-validated by convex-test against the real production schema, so a
 * live-schema change that breaks the corpus fails HERE, not mid-suite.
 */
export async function seedWorldDb(
  ctx: MutationCtx,
  orgs: SeedWorldOrgs,
  opts: SeedWorldOptions,
): Promise<void> {
  const alpha = orgs.alpha.id;
  const beta = orgs.beta.id;

  // --- Org structure + work items -----------------------------------------
  const alphaProject = await ctx.db.insert('projects', {
    organizationId: alpha,
    name: 'Alpha Launch',
    createdBy: WORLD_USERS.alphaOwner,
    createdAt: T0,
    updatedAt: T0,
  });
  const betaProject = await ctx.db.insert('projects', {
    organizationId: beta,
    name: 'Beta Ops',
    createdBy: WORLD_USERS.betaOwner,
    createdAt: T0,
    updatedAt: T0,
  });

  // Project agents — two on alpha, one on beta, so a migration that rolls the
  // per-project agent count has a non-uniform world to prove itself against.
  await ctx.db.insert('projectAgents', {
    organizationId: alpha,
    projectId: alphaProject,
    name: 'Launch writer',
    harness: 'claude-code',
    model: 'claude-sonnet-5',
    skills: [],
    connectors: [],
    createdBy: WORLD_USERS.alphaOwner,
    createdAt: T0,
    updatedAt: T0,
  });
  await ctx.db.insert('projectAgents', {
    organizationId: alpha,
    projectId: alphaProject,
    name: 'Launch reviewer',
    harness: 'claude-code',
    model: 'claude-sonnet-5',
    skills: [],
    connectors: [],
    createdBy: WORLD_USERS.alphaOwner,
    createdAt: T0,
    updatedAt: T0,
  });
  await ctx.db.insert('projectAgents', {
    organizationId: beta,
    projectId: betaProject,
    name: 'On-call helper',
    harness: 'claude-code',
    model: 'claude-sonnet-5',
    skills: [],
    connectors: [],
    createdBy: WORLD_USERS.betaOwner,
    createdAt: T0,
    updatedAt: T0,
  });

  const alphaTask = await ctx.db.insert('tasks', {
    organizationId: alpha,
    projectId: alphaProject,
    title: 'Draft the launch checklist',
    status: 'in_progress',
    rank: 'a0',
    createdBy: WORLD_USERS.alphaOwner,
    createdByType: 'user',
    createdAt: T0 + 1_000,
    updatedAt: T0 + 2_000,
  });
  const betaTask = await ctx.db.insert('tasks', {
    organizationId: beta,
    projectId: betaProject,
    title: 'Rotate the on-call schedule',
    status: 'todo',
    rank: 'a0',
    createdBy: WORLD_USERS.betaOwner,
    createdByType: 'user',
    createdAt: T0 + 1_000,
    updatedAt: T0 + 1_000,
  });

  await ctx.db.insert('taskActivity', {
    organizationId: alpha,
    taskId: alphaTask,
    projectId: alphaProject,
    actorType: 'user',
    actorId: WORLD_USERS.alphaOwner,
    action: 'status_changed',
    createdAt: T0 + 2_000,
  });

  // --- Discussions (threadMetadata is the live discussion container) ------
  await ctx.db.insert('threadMetadata', {
    threadId: 'world-thread-alpha-task-discussion',
    userId: WORLD_USERS.alphaOwner,
    chatType: 'general',
    status: 'active',
    createdAt: T0 + 3_000,
    organizationId: alpha,
    kind: 'task_discussion',
    taskId: alphaTask,
    discussionStatus: 'open',
  });
  await ctx.db.insert('threadMetadata', {
    threadId: 'world-thread-beta-task-discussion',
    userId: WORLD_USERS.betaOwner,
    chatType: 'general',
    status: 'active',
    createdAt: T0 + 3_000,
    organizationId: beta,
    kind: 'task_discussion',
    taskId: betaTask,
    discussionStatus: 'open',
  });

  // --- Chat (the 0.4 chat world) -------------------------------------------
  const alphaChatThread = await ctx.db.insert('threads', {
    organizationId: alpha,
    userId: WORLD_USERS.alphaMember,
    kind: 'direct',
    archived: false,
    createdAt: T0 + 4_000,
    updatedAt: T0 + 5_000,
  });
  await ctx.db.insert('messages', {
    organizationId: alpha,
    threadId: String(alphaChatThread),
    role: 'user',
    parts: [{ type: 'text', text: 'What shipped in the launch build?' }],
    sequence: 1,
    createdAt: T0 + 4_100,
  });
  await ctx.db.insert('messages', {
    organizationId: alpha,
    threadId: String(alphaChatThread),
    role: 'assistant',
    parts: [{ type: 'text', text: 'Two features and a bug fix.' }],
    sequence: 2,
    createdAt: T0 + 4_200,
  });
  // The heartbeat sits far in the FUTURE on purpose: the live stack the
  // container e2e boots runs recoverStaleDirectGenerations (2-min cron),
  // which DELETES any direct-lane generations row whose heartbeat went
  // stale — and every T0-anchored heartbeat is years stale, so the cron ate
  // this row mid-test between the seeded and post-down world digests.
  // Schema-wise the field is just a number, nothing asserts heartbeat
  // sanity, and the row must stay shaped as the BASELINE release knows it
  // (no post-0.4.1 fields here — the versions suite validates the world
  // against the real 0.4.1 checkpoint schema).
  await ctx.db.insert('generations', {
    organizationId: alpha,
    threadId: String(alphaChatThread),
    status: 'queued',
    streamId: 'world-stream-alpha-1',
    startedAt: T0 + 4_150,
    heartbeatAt: WORLD_SWEEP_PROOF_HEARTBEAT_MS,
  });
  await ctx.db.insert('memories', {
    organizationId: alpha,
    userId: WORLD_USERS.alphaMember,
    content: 'Prefers terse answers.',
    status: 'pending',
    createdAt: T0 + 4_300,
  });

  // --- Automations (the 0.4 automation store) ------------------------------
  await ctx.db.insert('automations', {
    organizationId: alpha,
    name: 'ops/daily-digest',
    version: 1,
    document: {
      version: 1,
      steps: [{ id: 'digest', kind: 'noop' }],
    },
    createdBy: WORLD_USERS.alphaOwner,
    createdAt: T0 + 6_000,
  });
  // A PROJECT-PINNED automation in the retired single-pin shape (the pin is
  // stamped on every version row) — the 0.4.1 pins-to-bindings migration
  // moves it into `automationProjectBindings`, so the chain exercises the
  // real transform, its per-name dedupe, and the byte-identical restore.
  for (const version of [1, 2]) {
    await ctx.db.insert('automations', {
      organizationId: alpha,
      name: 'document/verify-desk',
      version,
      projectId: alphaProject,
      document: {
        version,
        steps: [{ id: 'collect', kind: 'noop' }],
      },
      createdBy: WORLD_USERS.alphaOwner,
      createdAt: T0 + 6_500 + version,
    });
  }
  await ctx.db.insert('automationDeployments', {
    organizationId: alpha,
    name: 'ops/daily-digest',
    version: 1,
    deployedBy: WORLD_USERS.alphaOwner,
    deployedAt: T0 + 6_500,
  });
  await ctx.db.insert('automationTriggers', {
    organizationId: alpha,
    name: 'ops/daily-digest',
    kind: 'schedule',
    enabled: true,
    createdBy: WORLD_USERS.alphaOwner,
    createdAt: T0 + 6_600,
    updatedAt: T0 + 6_600,
  });
  await ctx.db.insert('automationRuns', {
    organizationId: alpha,
    name: 'ops/daily-digest',
    version: 1,
    status: 'success',
    mode: 'live',
    startedBy: WORLD_USERS.alphaOwner,
    input: { trigger: 'schedule' },
    startedAt: T0 + 7_000,
  });

  // --- External conversations + contacts -----------------------------------
  const alphaContact = await ctx.db.insert('contacts', {
    organizationId: alpha,
    source: 'manual_import',
  });
  const alphaConversation = await ctx.db.insert('conversations', {
    organizationId: alpha,
    contactId: alphaContact,
  });
  await ctx.db.insert('conversationMessages', {
    organizationId: alpha,
    conversationId: alphaConversation,
    channel: 'email',
    direction: 'inbound',
    deliveryState: 'delivered',
    content: 'Hello — question about my order.',
  });

  // --- Documents & files ----------------------------------------------------
  const alphaFolder = await ctx.db.insert('folders', {
    organizationId: alpha,
    name: 'Handbook',
  });
  await ctx.db.insert('documents', {
    organizationId: alpha,
    folderId: alphaFolder,
  });
  const alphaBlobId = await opts.storeBlob(WORLD_BLOB_CONTENTS[0]);
  await ctx.db.insert('fileMetadata', {
    organizationId: alpha,
    storageId: alphaBlobId,
    fileName: 'handbook.pdf',
    contentType: 'application/pdf',
    size: 24,
  });

  // --- Credentials (strict rebuilt shapes) ----------------------------------
  await ctx.db.insert('connectorCredentials', {
    organizationId: alpha,
    connectorSlug: 'shopify',
    authMethod: 'api-key',
    name: 'Shop main',
    encryptedData: {
      ciphertext: 'd29ybGQtY2lwaGVydGV4dA',
      nonce: 'd29ybGQtbm9uY2U',
      authTag: 'd29ybGQtdGFn',
      keyFingerprint: 'world-key-fp',
    },
    isDefault: true,
    status: 'active',
    createdBy: WORLD_USERS.alphaOwner,
    createdAt: T0 + 8_000,
    updatedAt: T0 + 8_000,
  });
  await ctx.db.insert('providerCredentials', {
    organizationId: alpha,
    providerSlug: 'openrouter',
    authMethod: 'env',
    name: 'Default OpenRouter',
    isDefault: true,
    status: 'active',
    createdBy: WORLD_USERS.alphaOwner,
    createdAt: T0 + 8_100,
    updatedAt: T0 + 8_100,
  });

  // --- Per-user surfaces ------------------------------------------------------
  await ctx.db.insert('userNotifications', {
    userId: WORLD_USERS.alphaMember,
    organizationId: alpha,
    type: 'task_assigned',
    titleKey: 'notifications.taskAssigned.title',
    bodyKey: 'notifications.taskAssigned.body',
    resourceType: 'task',
    resourceId: String(alphaTask),
    actorType: 'user',
    read: false,
    createdAt: T0 + 9_000,
  });
  await ctx.db.insert('userPreferences', {
    userId: WORLD_USERS.alphaMember,
    organizationId: alpha,
    customInstructions: 'Answer briefly.',
    updatedAt: T0 + 9_100,
  });

  // --- Cross-cutting ----------------------------------------------------------
  await ctx.db.insert('approvals', {
    organizationId: alpha,
    status: 'pending',
    resourceType: 'human_input_request',
    resourceId: 'world-approval-subject-1',
    priority: 'medium',
    threadId: 'world-thread-alpha-task-discussion',
  });
  await ctx.db.insert('auditLogs', {
    organizationId: alpha,
    actorId: WORLD_USERS.alphaOwner,
    actorType: 'user',
    action: 'task.create',
    category: 'data',
    resourceType: 'task',
    timestamp: T0 + 1_000,
    status: 'success',
  });
}
