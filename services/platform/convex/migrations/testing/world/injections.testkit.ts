/**
 * Mid-chain world injections: rows whose TABLES (or field shapes) did not
 * exist at the 0.2.84 baseline. Each injection names the release that
 * introduced its shape (`afterVersion`, verified against the version
 * checkpoints in `testing/versions/`); the versions suite seeds it right
 * after the chain crosses that boundary — modelling a deployment that
 * accumulated the rows while RUNNING that release — and every later
 * checkpoint validates them until the consuming migration transforms them.
 *
 * Chain A/B/C intentionally run WITHOUT injections (their seed↔down
 * deep-compare is anchored to the 0.2.84 baseline); the consuming migrations'
 * own `defineMigrationTest`s and the versions suite carry this coverage.
 *
 * Two-dot basename keeps this out of the Convex push bundle.
 */

import {
  TRIAGE_WORKFLOW_HASH,
  WORLD_EPOCH_MS,
  WORLD_WORKFORCE_AGENT_SLUGS,
  type SeedWorldOrgs,
} from './seed_db.testkit';

/** The slice of a convex-test `t.run` ctx an injection needs (structural —
 *  never imports generated server types; harness passes `ctx as never`). */
export interface InjectionCtx {
  db: {
    insert: (table: string, value: Record<string, unknown>) => Promise<string>;
    query: (table: never) => {
      collect: () => Promise<Array<Record<string, unknown> & { _id: string }>>;
    };
  };
  storage: {
    store: (blob: Blob) => Promise<string>;
  };
}

export interface WorldInjection {
  /** The release whose deployments first held these rows; the versions walk
   *  seeds them right after crossing this boundary. */
  readonly afterVersion: string;
  /**
   * True when the rows are valid in NO release at all — created by the dev
   * cycle AFTER `afterVersion` and consumed before the next release. A
   * deployment sitting exactly at `afterVersion` never holds them, so the
   * init-at-version test skips them when its target IS that boundary.
   */
  readonly devCycleOnly?: true;
  /** Checkpoint-grounded justification for not seeding at baseline. */
  readonly reason: string;
  /** Tables the injection populates (consumed by the corpus coverage guard). */
  readonly tables: readonly string[];
  seed(ctx: InjectionCtx, orgs: SeedWorldOrgs): Promise<void>;
}

export const WORLD_INJECTIONS: readonly WorldInjection[] = [
  {
    afterVersion: '0.2.85',
    reason:
      "appInstallations, appProjectBindings, agentInstallations, and wfDefaultProvisions first appear in the v0.2.85 schema, and userNotifications.resourceType gained 'dashboard' there — none of it can sit in a 0.2.84 baseline.",
    tables: [
      'appInstallations',
      'appProjectBindings',
      'agentInstallations',
      'wfDefaultProvisions',
      'userNotifications',
    ],
    async seed(ctx, orgs) {
      const { alpha, beta } = orgs;

      // --- appInstallations — 0.2.96/01+02 + 0.3.4/09 look it up by
      // --- (org, appSlug); 0.3.4/13 renames the slug fields; 0.3.4/16 moves
      // --- the rows. Deliberately NO `config` (manifest `appConfigSeeded`). --
      await ctx.db.insert('appInstallations', {
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
      await ctx.db.insert('appInstallations', {
        organizationId: beta.id,
        appSlug: 'triage-github-issues',
        appName: 'Triage GitHub issues',
        installedAt: WORLD_EPOCH_MS,
        installedBy: 'user_beta_admin',
        status: 'active',
        requiredIntegrations: ['github'],
        resources: [],
      });

      // --- appProjectBindings — both CONFIGLESS (manifest `appConfigSeeded`);
      // --- 0.3.4/14 renames the slug field, 0.3.4/17 moves the rows. FKs
      // --- re-resolve the baseline-seeded projects by name. ------------------
      const projects = await ctx.db.query('projects' as never).collect();
      const projectId = (name: string): string => {
        const row = projects.find(
          (p) => p.organizationId === alpha.id && p.name === name,
        );
        if (!row) {
          throw new Error(
            `injection 0.2.85: baseline project "${name}" not found`,
          );
        }
        return row._id;
      };
      await ctx.db.insert('appProjectBindings', {
        organizationId: alpha.id,
        appSlug: 'issue-desk',
        projectId: projectId('Platform'),
        boundAt: WORLD_EPOCH_MS,
        boundBy: 'user_alpha_admin',
      });
      await ctx.db.insert('appProjectBindings', {
        organizationId: alpha.id,
        appSlug: 'issue-desk',
        projectId: projectId('Website'),
        boundAt: WORLD_EPOCH_MS + 3600_000,
        boundBy: 'user_alpha_admin',
      });

      // --- agentInstallations — 0.3.4/05 snapshot-deletes the two workforce
      // --- persona rows; 'assistant' is the survivor -------------------------
      await ctx.db.insert('agentInstallations', {
        organizationId: alpha.id,
        agentSlug: WORLD_WORKFORCE_AGENT_SLUGS[0], // 'analyst'
        installedAt: WORLD_EPOCH_MS,
        installedBy: 'system',
        contentHash: 'worldhash-analyst-v1',
        enabled: true,
      });
      await ctx.db.insert('agentInstallations', {
        organizationId: alpha.id,
        agentSlug: WORLD_WORKFORCE_AGENT_SLUGS[1], // 'product-manager'
        installedAt: WORLD_EPOCH_MS,
        installedBy: 'system',
        contentHash: 'worldhash-product-manager-v1',
        enabled: false,
        disabledReason: 'user',
      });
      await ctx.db.insert('agentInstallations', {
        organizationId: alpha.id,
        agentSlug: 'assistant',
        installedAt: WORLD_EPOCH_MS,
        installedBy: 'system',
        contentHash: 'worldhash-assistant-v1',
        enabled: true,
      });

      // --- wfDefaultProvisions — the survivor workflow's provision marker ----
      await ctx.db.insert('wfDefaultProvisions', {
        organizationId: alpha.id,
        workflowSlug: 'projects/tasks/triage-unassigned-tasks',
        contentHash: TRIAGE_WORKFLOW_HASH,
        provisionedAt: WORLD_EPOCH_MS,
      });

      // --- userNotifications — 0.3.4/07 snapshot-deletes the workforce_digest
      // --- rows (one unread, one read) ---------------------------------------
      await ctx.db.insert('userNotifications', {
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
      await ctx.db.insert('userNotifications', {
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
    },
  },
  {
    afterVersion: '0.2.96',
    reason:
      'appUploadClaims, appUploadIntents, and supportCases first appear in the v0.2.96 schema, as does threadMetadata.kind — a 0.2.84 baseline deployment cannot hold any of it.',
    tables: [
      'appUploadClaims',
      'appUploadIntents',
      'supportCases',
      'threadMetadata',
    ],
    async seed(ctx, orgs) {
      const { alpha } = orgs;

      // --- threadMetadata — a kind:'chat' survivor ('chat' joined the union
      // --- in v0.2.96): 0.3.4/15+/20 must leave kind-bearing non-app rows
      // --- untouched --------------------------------------------------------
      await ctx.db.insert('threadMetadata', {
        threadId: 'thread_alpha_chat_2',
        userId: 'user_alpha_member',
        chatType: 'general',
        status: 'active',
        createdAt: WORLD_EPOCH_MS + 120_000,
        organizationId: alpha.id,
        kind: 'chat',
      });

      // --- appUploadClaims / appUploadIntents — 0.3.4/18+19 move the rows ---
      await ctx.db.insert('appUploadClaims', {
        organizationId: alpha.id,
        slug: 'custom-report',
        claimedAt: WORLD_EPOCH_MS,
        expiresAt: WORLD_EPOCH_MS + 3600_000,
      });
      await ctx.db.insert('appUploadIntents', {
        storageId: await ctx.storage.store(
          new Blob(['world-upload-intent-blob']),
        ),
        organizationId: alpha.id,
        userId: 'user_alpha_admin',
        createdAt: WORLD_EPOCH_MS,
      });

      // --- supportCases — 0.3.4/25 repoints customerId → contactId; the
      // --- requester-only case is its skip path. The customer FK targets the
      // --- baseline-seeded Acme row (externalId cust-1001). -----------------
      const customers = await ctx.db.query('customers' as never).collect();
      const acme = customers.find((c) => c.externalId === 'cust-1001');
      if (!acme) {
        throw new Error(
          'injection 0.2.96: baseline customer cust-1001 not found',
        );
      }
      await ctx.db.insert('supportCases', {
        organizationId: alpha.id,
        subject: 'Invoice discrepancy for May',
        status: 'open',
        customerId: acme._id,
        createdBy: 'user_alpha_support',
        createdByType: 'user',
        createdAt: WORLD_EPOCH_MS,
        updatedAt: WORLD_EPOCH_MS,
      });
      await ctx.db.insert('supportCases', {
        organizationId: alpha.id,
        subject: 'Password reset loop',
        status: 'pending',
        requesterEmail: 'visitor@example.com',
        createdBy: 'user_alpha_support',
        createdByType: 'user',
        createdAt: WORLD_EPOCH_MS,
        updatedAt: WORLD_EPOCH_MS,
      });
    },
  },
  {
    afterVersion: '0.3.3',
    devCycleOnly: true,
    reason:
      "threadMetadata's appSlug/subjectType fields and the app_discussion kind appear in NO released schema (v0.3.4-dev declares automationSlug/subjectType and automation_discussion) — only dev-cycle deployments ever held these rows.",
    tables: ['threadMetadata'],
    async seed(ctx, orgs) {
      const { alpha } = orgs;

      // --- app-era discussion rows for 0.3.4/15 (slug + subjectType rename)
      // --- and 0.3.4/20 (kind rewrite) ---------------------------------------
      await ctx.db.insert('threadMetadata', {
        threadId: 'thread_alpha_app_1',
        userId: 'user_alpha_admin',
        chatType: 'general',
        status: 'active',
        createdAt: WORLD_EPOCH_MS,
        organizationId: alpha.id,
        kind: 'app_discussion',
        appSlug: 'issue-desk',
        subjectType: 'app', // 0.3.4/15 rewrites to 'automation'
        subjectId: 'issue-desk',
      });
      await ctx.db.insert('threadMetadata', {
        threadId: 'thread_alpha_app_2',
        userId: 'user_alpha_member',
        chatType: 'general',
        status: 'active',
        createdAt: WORLD_EPOCH_MS + 60_000,
        organizationId: alpha.id,
        kind: 'app_discussion',
        appSlug: 'issue-desk',
        subjectType: 'task', // slug-only path of 0.3.4/15 (subjectType untouched)
        subjectId: 'task-100',
      });
    },
  },
];
