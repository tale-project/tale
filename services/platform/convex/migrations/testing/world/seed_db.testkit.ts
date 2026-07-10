/**
 * DB half of the baseline world corpus: inserts every 0.2.84-era row the
 * 37-runnable-migration chain reads, under `worldSchema`
 * (`../world_schema.testkit.ts`) validation. The fs half lives in
 * `seed_fs.testkit.ts`; the registry of what exists and why in
 * `manifest.testkit.ts`.
 *
 * DETERMINISM CONTRACT: every value below is a fixed literal or an offset of
 * {@link WORLD_EPOCH_MS} — never `Date.now()`/`Math.random()`. Encrypted SSO
 * credentials are pre-computed compact-JWE constants (a fresh `encryptString`
 * call embeds a random IV, which would break byte-level reproducibility).
 * Convex ids come from convex-test's deterministic insertion order; storage
 * ids from the caller-supplied `storeBlob` in the same fixed order.
 *
 * Every section names the migrations that consume it. Two-dot basename keeps
 * this out of the Convex push bundle.
 */

/** Fixed timestamp base for all seeded times (2024-05-29T17:06:40Z). */
export const WORLD_EPOCH_MS = 1717000000000;

/**
 * The deterministic 32-byte encryption key the harness must stub as
 * `ENCRYPTION_SECRET_HEX` (and stub `ENCRYPTION_SECRET` to undefined — the
 * base64 var wins when present, see `convex/lib/crypto/get_secret_key.ts`)
 * BEFORE 0.2.87/01 runs, so `decryptString` can open the JWE constants below.
 * Same key the 0.2.87/01 per-migration test uses.
 */
export const WORLD_ENCRYPTION_SECRET_HEX =
  '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';

/** Plaintexts 0.2.87/01 must recover into `connection.secrets.json`. */
export const WORLD_SSO_CLIENT_ID = 'world-sso-client-id';
export const WORLD_SSO_CLIENT_SECRET = 'world-sso-client-secret';

/**
 * Compact JWE (`alg: dir`, `enc: A256GCM`) of {@link WORLD_SSO_CLIENT_ID} /
 * {@link WORLD_SSO_CLIENT_SECRET} under {@link WORLD_ENCRYPTION_SECRET_HEX} —
 * generated once with the repo's `jose` dependency (same construction as
 * `convex/lib/crypto/encrypt_string.ts`) and frozen for determinism.
 */
export const WORLD_SSO_CLIENT_ID_JWE =
  'eyJhbGciOiJkaXIiLCJlbmMiOiJBMjU2R0NNIn0..vOXuxZjNtztv2zgm.UNUyfpX0XhrvELlPfkgQZqh02g.ECYNkcdN1alha85zRGZOWA';
export const WORLD_SSO_CLIENT_SECRET_JWE =
  'eyJhbGciOiJkaXIiLCJlbmMiOiJBMjU2R0NNIn0..n-PpSVLaVrXVczGO.XdjKpssfyRnDB56rZ69MHcit_sokqdA.wrA_7O1RPbyw3LILUAorug';

/**
 * The two retired workforce persona slugs seeded as `agentInstallations` rows
 * (both members of 0.2.90/06's `WORKFORCE_AGENT_SLUGS`), matching the
 * `agents/workforce/*.json` fixture files 0.2.90/05 deletes.
 */
export const WORLD_WORKFORCE_AGENT_SLUGS = [
  'analyst',
  'product-manager',
] as const;

/** Fixed content-hash literals. Nothing in the chain re-derives them (the
 *  0.2.90/07-down provisioner skips marked workflows before comparing), so a
 *  stable literal beats hashing fixture bytes at seed time. */
const TRIAGE_WORKFLOW_HASH = 'worldhash-triage-unassigned-tasks-v1';

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
 * Every `storeBlob` content, in EXACT call order — the container e2e's
 * support action pre-stores these (mutations cannot `storage.store`) and the
 * seeding mutation consumes the resulting ids as a queue, throwing on any
 * count mismatch, so this list cannot silently drift from the call sites.
 */
export const WORLD_BLOB_CONTENTS: readonly string[] = [
  'world-upload-intent-blob',
  'world-threadfile-q2-summary',
  'world-threadfile-analyze-py',
  'world-threadfile-revenue-png',
];

/**
 * The slice of a convex-test mutation ctx the seeder needs, kept structural so
 * this module never imports generated server types. The harness passes its
 * real ctx across the boundary with `ctx as never` (house pattern for
 * fixture/production type seams).
 */
export interface SeedWorldCtx {
  db: {
    insert: (table: string, value: Record<string, unknown>) => Promise<string>;
  };
}

/**
 * Insert the full baseline DB corpus. Alpha gets everything, beta a small
 * subset (second per-org datapoint), empty nothing. Idempotency is NOT a goal
 * — the harness seeds exactly once into a fresh world.
 */
export async function seedWorldDb(
  ctx: SeedWorldCtx,
  orgs: SeedWorldOrgs,
  opts: SeedWorldOptions,
): Promise<void> {
  const { alpha, beta } = orgs;
  const db = ctx.db;

  // --- governancePolicies — 0.2.85/01 exports the file types, /02 splits the
  // --- staged DSAR change, /03 snapshot-deletes every row -------------------
  await db.insert('governancePolicies', {
    organizationId: alpha.id,
    policyType: 'password_policy',
    config: { minLength: 16 },
    enabled: true,
    updatedBy: 'user_alpha_admin',
    updatedAt: WORLD_EPOCH_MS,
  });
  await db.insert('governancePolicies', {
    organizationId: alpha.id,
    policyType: 'dsar_governance',
    config: { coolingOffHours: 48 },
    enabled: true,
    updatedBy: 'user_alpha_admin',
    updatedAt: WORLD_EPOCH_MS,
    // The staged change 0.2.85/02 moves into `dsarPolicyPendingChanges`.
    pendingConfig: { coolingOffHours: 12 },
    pendingEffectiveAt: WORLD_EPOCH_MS + 7 * 24 * 3600_000,
    pendingProposedBy: 'user_alpha_admin',
    pendingProposedByEmail: 'admin@baseline-alpha.example',
    pendingProposedAt: WORLD_EPOCH_MS - 24 * 3600_000,
  });
  // Legacy non-file policy type: 0.2.85/01 skips the file export and 0.2.85/02
  // the pending split, but 0.2.85/03 still snapshot-deletes it.
  await db.insert('governancePolicies', {
    organizationId: alpha.id,
    policyType: 'personalization',
    config: { enabled: true },
    enabled: true,
    updatedAt: WORLD_EPOCH_MS,
  });
  await db.insert('governancePolicies', {
    organizationId: beta.id,
    policyType: 'password_policy',
    config: { minLength: 12 },
    enabled: true,
    updatedAt: WORLD_EPOCH_MS,
  });

  // --- orgPackagePolicy / modelSyncSettings — 0.2.87/02+03 export to files,
  // --- /04+05 snapshot-delete (alpha only) -----------------------------------
  await db.insert('orgPackagePolicy', {
    organizationId: alpha.id,
    defaultMode: 'allowlist',
    pythonAllow: ['numpy', 'pandas'],
    pythonDeny: [],
    nodeAllow: ['lodash'],
    nodeDeny: [],
    updatedAt: WORLD_EPOCH_MS,
    updatedByUserId: 'user_alpha_admin',
  });
  await db.insert('modelSyncSettings', {
    organizationId: alpha.id,
    autoSyncEnabled: true,
    updatedAt: WORLD_EPOCH_MS,
  });

  // --- ssoProviders — 0.2.87/01 decrypts + exports to governance/sso/ -------
  await db.insert('ssoProviders', {
    organizationId: alpha.id,
    providerId: 'entra-id',
    issuer: 'https://login.microsoftonline.com/baseline-tenant/v2.0',
    clientIdEncrypted: WORLD_SSO_CLIENT_ID_JWE,
    clientSecretEncrypted: WORLD_SSO_CLIENT_SECRET_JWE,
    scopes: ['openid', 'email', 'profile'],
    autoProvisionRole: true,
    roleMappingRules: [
      { source: 'group', pattern: '*admin*', targetRole: 'admin' },
    ],
    defaultRole: 'member',
    providerFeatures: {
      entraId: {
        autoProvisionTeam: true,
        excludeGroups: ['Everyone'],
        enableOneDriveAccess: true,
        domainHint: 'baseline-alpha.example',
      },
    },
    createdAt: WORLD_EPOCH_MS,
    updatedAt: WORLD_EPOCH_MS,
  });

  // --- projects — stable FK holders for bindings and schedules ---------------
  const projectPlatform = await db.insert('projects', {
    organizationId: alpha.id,
    name: 'Platform',
    createdBy: 'user_alpha_admin',
    createdAt: WORLD_EPOCH_MS,
    updatedAt: WORLD_EPOCH_MS,
  });
  const projectWebsite = await db.insert('projects', {
    organizationId: alpha.id,
    name: 'Website',
    createdBy: 'user_alpha_admin',
    createdAt: WORLD_EPOCH_MS,
    updatedAt: WORLD_EPOCH_MS,
  });

  // --- appInstallations — 0.2.88/01+02 + 0.2.91/01 look it up by (org, appSlug);
  // --- 0.2.93/01 renames the slug fields; 0.2.93/04 moves the rows.
  // --- Deliberately NO `config` (see manifest profile `appConfigSeeded`). ----
  await db.insert('appInstallations', {
    organizationId: alpha.id,
    appSlug: 'issue-desk',
    appName: 'Resolve GitHub issues',
    installedAt: WORLD_EPOCH_MS,
    installedBy: 'user_alpha_admin',
    status: 'active',
    requiredIntegrations: ['github'],
    resources: [
      {
        domain: 'workflows',
        path: 'issue-desk/desk-process.json',
        contentHash: 'worldhash-desk-process-v1',
      },
      {
        domain: 'workflows',
        path: 'issue-desk/reconcile.json',
        contentHash: 'worldhash-reconcile-v1',
      },
      {
        domain: 'agents',
        path: 'desk-implementer.json',
        contentHash: 'worldhash-desk-implementer-v1',
      },
      {
        domain: 'agents',
        path: 'desk-reviewer.json',
        contentHash: 'worldhash-desk-reviewer-v1',
      },
    ],
  });
  await db.insert('appInstallations', {
    organizationId: beta.id,
    appSlug: 'triage-github-issues',
    appName: 'Triage GitHub issues',
    installedAt: WORLD_EPOCH_MS,
    installedBy: 'user_beta_admin',
    status: 'active',
    requiredIntegrations: ['github'],
    resources: [],
  });

  // --- appProjectBindings — both CONFIGLESS: the 0.2.88/01 copy and 0.2.91/01
  // --- fold run as guarded no-ops (see manifest profile `appConfigSeeded`);
  // --- 0.2.93/02 renames the slug field, 0.2.93/05 moves the rows ------------
  await db.insert('appProjectBindings', {
    organizationId: alpha.id,
    appSlug: 'issue-desk',
    projectId: projectPlatform,
    boundAt: WORLD_EPOCH_MS,
    boundBy: 'user_alpha_admin',
  });
  await db.insert('appProjectBindings', {
    organizationId: alpha.id,
    appSlug: 'issue-desk',
    projectId: projectWebsite,
    boundAt: WORLD_EPOCH_MS + 3600_000,
    boundBy: 'user_alpha_admin',
  });

  // --- appUploadClaims / appUploadIntents — 0.2.93/06+07 move the rows -------
  await db.insert('appUploadClaims', {
    organizationId: alpha.id,
    slug: 'custom-report',
    claimedAt: WORLD_EPOCH_MS,
    expiresAt: WORLD_EPOCH_MS + 3600_000,
  });
  await db.insert('appUploadIntents', {
    storageId: await opts.storeBlob('world-upload-intent-blob'),
    organizationId: alpha.id,
    userId: 'user_alpha_admin',
    createdAt: WORLD_EPOCH_MS,
  });

  // --- wfSchedules — pre-split org-level shape. 0.2.88/02 assigns the app
  // --- schedule to the first issue-desk binding; the plain schedule is its
  // --- skip path. `variables` carry NONE of 0.2.91/01's CONFIG_KEYS
  // --- (owner/repo/testCommand/repoNotes) — see manifest `appConfigSeeded`. --
  await db.insert('wfSchedules', {
    organizationId: alpha.id,
    workflowSlug: 'issue-desk/reconcile',
    cronExpression: '*/15 * * * *',
    timezone: 'UTC',
    isActive: true,
    createdAt: WORLD_EPOCH_MS,
    createdBy: 'system',
    variables: { state: 'open' },
  });
  await db.insert('wfSchedules', {
    organizationId: alpha.id,
    workflowSlug: 'daily-report',
    cronExpression: '0 6 * * *',
    timezone: 'UTC',
    isActive: true,
    createdAt: WORLD_EPOCH_MS,
    createdBy: 'user_alpha_admin',
  });

  // --- wfEventSubscriptions — the pre-triage shape 0.2.92/02 keys on: the
  // --- task.created row whose org gains the task.status_changed sibling ------
  await db.insert('wfEventSubscriptions', {
    organizationId: alpha.id,
    workflowSlug: 'projects/tasks/triage-unassigned-tasks',
    eventType: 'task.created',
    isActive: true,
    createdAt: WORLD_EPOCH_MS,
    createdBy: 'system',
  });

  // --- wfInstallations + wfDefaultProvisions — the SURVIVOR autoInstall
  // --- workflow's rows, so 0.2.90/07's sweep leaves them and its down's
  // --- provisioner SKIPS the file instead of re-inserting wall-clock rows
  // --- (manifest profile `survivorWorkflowProvisionMarker`) ------------------
  await db.insert('wfInstallations', {
    organizationId: alpha.id,
    workflowSlug: 'projects/tasks/triage-unassigned-tasks',
    installedAt: WORLD_EPOCH_MS,
    installedBy: 'system',
    contentHash: TRIAGE_WORKFLOW_HASH,
  });
  await db.insert('wfDefaultProvisions', {
    organizationId: alpha.id,
    workflowSlug: 'projects/tasks/triage-unassigned-tasks',
    contentHash: TRIAGE_WORKFLOW_HASH,
    provisionedAt: WORLD_EPOCH_MS,
  });

  // --- threadFiles — RELATIVE paths only, one per source root, for 0.2.89/02
  // --- (`user_upload` → /user/uploads, `agent_write` → /user/code,
  // --- `run_output` → /user/output). No absolute edge row — its down strips
  // --- the prefix (manifest profile `threadFilePathsRelativeOnly`). ----------
  const threadFileSeeds = [
    {
      path: 'reports/q2-summary.pdf',
      source: 'user_upload',
      contentType: 'application/pdf',
      blob: 'world-threadfile-q2-summary',
    },
    {
      path: 'scripts/analyze.py',
      source: 'agent_write',
      contentType: 'text/x-python',
      blob: 'world-threadfile-analyze-py',
    },
    {
      path: 'charts/revenue.png',
      source: 'run_output',
      contentType: 'image/png',
      blob: 'world-threadfile-revenue-png',
    },
  ] as const;
  for (const seed of threadFileSeeds) {
    await db.insert('threadFiles', {
      organizationId: alpha.id,
      threadId: 'thread_alpha_chat_1',
      path: seed.path,
      storageId: await opts.storeBlob(seed.blob),
      size: seed.blob.length,
      contentType: seed.contentType,
      source: seed.source,
      createdAt: WORLD_EPOCH_MS,
      updatedAt: WORLD_EPOCH_MS,
    });
  }

  // --- threadMetadata — old appSlug-era discussion rows for 0.2.93/03 (slug +
  // --- subjectType rename) and 0.2.93/08 (kind rewrite), plus a chat survivor
  await db.insert('threadMetadata', {
    threadId: 'thread_alpha_app_1',
    userId: 'user_alpha_admin',
    chatType: 'general',
    status: 'active',
    createdAt: WORLD_EPOCH_MS,
    organizationId: alpha.id,
    kind: 'app_discussion',
    appSlug: 'issue-desk',
    subjectType: 'app', // 0.2.93/03 rewrites to 'automation'
    subjectId: 'issue-desk',
  });
  await db.insert('threadMetadata', {
    threadId: 'thread_alpha_app_2',
    userId: 'user_alpha_member',
    chatType: 'general',
    status: 'active',
    createdAt: WORLD_EPOCH_MS + 60_000,
    organizationId: alpha.id,
    kind: 'app_discussion',
    appSlug: 'issue-desk',
    subjectType: 'task', // slug-only path of 0.2.93/03 (subjectType untouched)
    subjectId: 'task-100',
  });
  await db.insert('threadMetadata', {
    threadId: 'thread_alpha_chat_1',
    userId: 'user_alpha_admin',
    chatType: 'general',
    status: 'active',
    createdAt: WORLD_EPOCH_MS,
    organizationId: alpha.id,
    kind: 'chat', // survivor — untouched by the 0.2.93 renames
  });

  // --- customers / vendors — 0.3.4/02+03 copy them into contacts; the edge
  // --- rows (source only) prove the nameless/emailless merge path ------------
  const customerAcme = await db.insert('customers', {
    organizationId: alpha.id,
    name: 'Acme GmbH',
    email: 'billing@acme.example',
    externalId: 'cust-1001',
    status: 'active',
    source: 'manual_import',
    locale: 'de',
    metadata: { tier: 'gold' },
  });
  await db.insert('customers', {
    organizationId: alpha.id,
    source: 'api_import', // EDGE: no name, no email (0.3.4/03 merge edge)
  });
  const customerBeta = await db.insert('customers', {
    organizationId: beta.id,
    name: 'Beta Buyer',
    email: 'buyer@beta.example',
    source: 'manual_import',
  });
  await db.insert('vendors', {
    organizationId: alpha.id,
    name: 'Paper Supplies Co',
    email: 'orders@paper.example',
    phone: '+49 30 1234567',
    externalId: 42,
    source: 'manual_import',
    tags: ['stationery'],
    metadata: { rating: 4 },
    notes: 'Net 30 terms',
  });
  await db.insert('vendors', {
    organizationId: alpha.id,
    source: 'file_upload', // EDGE: no name, no email (0.3.4/02 merge edge)
  });

  // --- conversations + conversationMessages — 0.2.90/02 derives
  // --- integrationName from the newest named message; 0.3.4/04 repoints
  // --- customerId → contactId. conv2 is the underivable/no-customer survivor.
  const convInvoice = await db.insert('conversations', {
    organizationId: alpha.id,
    customerId: customerAcme,
    subject: 'Invoice discrepancy',
    status: 'open',
    channel: 'email',
    direction: 'inbound',
    lastMessageAt: WORLD_EPOCH_MS + 1000,
    // NO integrationName (0.2.90/02 backfills 'outlook'), NO contactId.
  });
  await db.insert('conversationMessages', {
    organizationId: alpha.id,
    conversationId: convInvoice,
    channel: 'email',
    direction: 'inbound',
    deliveryState: 'delivered',
    content: 'Hello, my May invoice seems to double-count seats.',
    sentAt: WORLD_EPOCH_MS,
    deliveredAt: WORLD_EPOCH_MS + 500,
    // Older message with NO integrationName — the scan must pass over it.
  });
  await db.insert('conversationMessages', {
    organizationId: alpha.id,
    conversationId: convInvoice,
    channel: 'email',
    direction: 'inbound',
    deliveryState: 'delivered',
    integrationName: 'outlook', // newest named message → the derived value
    content: 'Following up on the invoice question.',
    sentAt: WORLD_EPOCH_MS + 900,
    deliveredAt: WORLD_EPOCH_MS + 1000,
  });
  await db.insert('conversations', {
    organizationId: alpha.id,
    subject: 'Anonymous website note',
    status: 'open',
    channel: 'email',
    direction: 'inbound',
    // Survivor: no customerId (0.3.4/04 skip) and no named message
    // (0.2.90/02 underivable skip).
  });
  const convBetaOrder = await db.insert('conversations', {
    organizationId: beta.id,
    customerId: customerBeta,
    subject: 'Order status',
    status: 'open',
    channel: 'email',
    direction: 'inbound',
    lastMessageAt: WORLD_EPOCH_MS + 2000,
    // NO integrationName — beta's 0.2.90/02 datapoint (backfills 'gmail').
  });
  await db.insert('conversationMessages', {
    organizationId: beta.id,
    conversationId: convBetaOrder,
    channel: 'email',
    direction: 'inbound',
    deliveryState: 'delivered',
    integrationName: 'gmail',
    content: 'Where is my order #778?',
    sentAt: WORLD_EPOCH_MS + 1800,
    deliveredAt: WORLD_EPOCH_MS + 2000,
  });

  // --- supportCases — 0.3.4/05 repoints customerId → contactId; the
  // --- requester-only case is its skip path ---------------------------------
  await db.insert('supportCases', {
    organizationId: alpha.id,
    subject: 'Invoice discrepancy for May',
    status: 'open',
    customerId: customerAcme,
    createdBy: 'user_alpha_support',
    createdByType: 'user',
    createdAt: WORLD_EPOCH_MS,
    updatedAt: WORLD_EPOCH_MS,
  });
  await db.insert('supportCases', {
    organizationId: alpha.id,
    subject: 'Password reset loop',
    status: 'pending',
    requesterEmail: 'visitor@example.com',
    createdBy: 'user_alpha_support',
    createdByType: 'user',
    createdAt: WORLD_EPOCH_MS,
    updatedAt: WORLD_EPOCH_MS,
  });

  // --- agentInstallations — 0.2.90/06 snapshot-deletes the two workforce
  // --- persona rows; 'assistant' is the survivor -----------------------------
  await db.insert('agentInstallations', {
    organizationId: alpha.id,
    agentSlug: WORLD_WORKFORCE_AGENT_SLUGS[0], // 'analyst'
    installedAt: WORLD_EPOCH_MS,
    installedBy: 'system',
    contentHash: 'worldhash-analyst-v1',
    enabled: true,
  });
  await db.insert('agentInstallations', {
    organizationId: alpha.id,
    agentSlug: WORLD_WORKFORCE_AGENT_SLUGS[1], // 'product-manager'
    installedAt: WORLD_EPOCH_MS,
    installedBy: 'system',
    contentHash: 'worldhash-product-manager-v1',
    enabled: false,
    disabledReason: 'user',
  });
  await db.insert('agentInstallations', {
    organizationId: alpha.id,
    agentSlug: 'assistant',
    installedAt: WORLD_EPOCH_MS,
    installedBy: 'system',
    contentHash: 'worldhash-assistant-v1',
    enabled: true,
  });

  // --- userNotifications — 0.2.90/08 snapshot-deletes the workforce_digest
  // --- rows (one unread, one read); task_assigned is the survivor ------------
  await db.insert('userNotifications', {
    userId: 'user_alpha_admin',
    organizationId: alpha.id,
    type: 'workforce_digest',
    titleKey: 'workforceDigest',
    bodyKey: 'workforceDigestBody',
    resourceType: 'dashboard',
    resourceId: alpha.id,
    actorType: 'system',
    read: false,
    createdAt: WORLD_EPOCH_MS,
  });
  await db.insert('userNotifications', {
    userId: 'user_alpha_member',
    organizationId: alpha.id,
    type: 'workforce_digest',
    titleKey: 'workforceDigest',
    bodyKey: 'workforceDigestBody',
    resourceType: 'dashboard',
    resourceId: alpha.id,
    actorType: 'system',
    read: true,
    readAt: WORLD_EPOCH_MS + 100,
    createdAt: WORLD_EPOCH_MS,
  });
  await db.insert('userNotifications', {
    userId: 'user_alpha_admin',
    organizationId: alpha.id,
    type: 'task_assigned',
    titleKey: 'taskAssigned',
    bodyKey: 'taskAssignedBody',
    resourceType: 'task',
    resourceId: 'task-100',
    actorType: 'user',
    actorId: 'user_alpha_member',
    read: false,
    createdAt: WORLD_EPOCH_MS,
  });

  // --- integrationCredentials — 0.2.90/03 lists them per org; this row is
  // --- INACTIVE so the email-app install stays a no-op while the
  // --- active-filter is still exercised (manifest `emailCredentialsActive`) --
  await db.insert('integrationCredentials', {
    organizationId: alpha.id,
    slug: 'outlook',
    status: 'inactive',
    isActive: false,
    authMethod: 'oauth2',
  });
}
