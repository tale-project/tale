// @vitest-environment node

/**
 * The real install/uninstall actions are filesystem- and deployment-bound
 * (`installAutomationInternal` copies bundle files from TALE_CONFIG_BUILTIN_DIR), so
 * this test drives the handler against a fake `NodeMigrationCtx` that
 * dispatches on function names and records calls — proving the org-selection
 * logic (active-credential gating + integration→app map), the installedBy
 * marker, idempotence in both directions, the marker-targeted `down`, and the
 * log-and-continue posture on a failed install. Org enumeration is covered by
 * the runner tests; the install/uninstall engines by the apps test suites.
 */

import { getFunctionName } from 'convex/server';
import { describe, expect, it, vi } from 'vitest';

import { internal } from '../../../../_generated/api';
import type {
  NodeMigrationCtx,
  NodeMigrationHelpers,
} from '../../../framework/types';
import {
  emailAppInstallTargets,
  INTEGRATION_TO_EMAIL_APP,
  MIGRATION_INSTALLED_BY,
  migration,
  type CredentialLike,
} from './index';

const ORG = { id: 'org1', slug: 'org1' };

/** The migration never touches the filesystem — helpers must stay unused. */
const helpers = new Proxy({} as NodeMigrationHelpers, {
  get(_target, prop) {
    throw new Error(`unexpected helpers.${String(prop)} access`);
  },
});

const FN = {
  listCredentials: getFunctionName(
    internal.integrations.credential_queries.listInternal,
  ),
  getInstallation: getFunctionName(
    internal.automations.install_mutations.getAutomationInstallationInternal,
  ),
  install: getFunctionName(
    internal.automations.install_actions.installAutomationInternal,
  ),
  uninstall: getFunctionName(
    internal.automations.install_actions.uninstallAutomationInternal,
  ),
};

interface FakeState {
  credentials: CredentialLike[];
  /** appSlug → install row (as `getAutomationInstallationInternal` returns it). */
  installs: Map<string, { installedBy: string }>;
  installCalls: { automationSlug: string; installedBy: string }[];
  uninstallCalls: string[];
  /** App slugs whose install should throw (catalog-missing simulation). */
  failInstalls?: ReadonlySet<string>;
}

function fakeCtx(state: FakeState): NodeMigrationCtx {
  return {
    runQuery: async (ref: unknown, args: { automationSlug?: string }) => {
      const name = getFunctionName(ref as never);
      if (name === FN.listCredentials) return state.credentials;
      if (name === FN.getInstallation) {
        return state.installs.get(args.automationSlug ?? '') ?? null;
      }
      throw new Error(`unexpected runQuery(${name})`);
    },
    runMutation: async (ref: unknown) => {
      throw new Error(
        `unexpected runMutation(${getFunctionName(ref as never)})`,
      );
    },
    runAction: async (
      ref: unknown,
      args: { automationSlug: string; installedBy?: string },
    ) => {
      const name = getFunctionName(ref as never);
      if (name === FN.install) {
        if (state.failInstalls?.has(args.automationSlug)) {
          throw new Error(
            `App "${args.automationSlug}" not found in the catalog`,
          );
        }
        state.installCalls.push({
          automationSlug: args.automationSlug,
          installedBy: args.installedBy ?? '',
        });
        state.installs.set(args.automationSlug, {
          installedBy: args.installedBy ?? '',
        });
        return { ok: true, workflows: 0, agents: 0, resources: 0 };
      }
      if (name === FN.uninstall) {
        state.uninstallCalls.push(args.automationSlug);
        state.installs.delete(args.automationSlug);
        return { ok: true };
      }
      throw new Error(`unexpected runAction(${name})`);
    },
  };
}

function active(slug: string): CredentialLike {
  return { slug, isActive: true, status: 'active' };
}

describe('0.2.90/03 install_email_apps', () => {
  it('emailAppInstallTargets keeps only ACTIVE credentials of mapped integrations', () => {
    const targets = emailAppInstallTargets([
      active('outlook'),
      { slug: 'gmail', isActive: false, status: 'active' }, // disabled
      { slug: 'imap_smtp', isActive: true, status: 'error' }, // unhealthy
      active('slack'), // active but not an email integration
    ]);
    expect(targets).toEqual(['reply-outlook-emails']);
  });

  it('up installs the mapped app per active credential, stamped with the marker', async () => {
    const state: FakeState = {
      credentials: [active('outlook'), active('gmail'), active('imap_smtp')],
      installs: new Map(),
      installCalls: [],
      uninstallCalls: [],
    };
    await migration.up(fakeCtx(state), ORG, helpers);

    expect(state.installCalls).toEqual(
      Object.values(INTEGRATION_TO_EMAIL_APP).map((automationSlug) => ({
        automationSlug,
        installedBy: MIGRATION_INSTALLED_BY,
      })),
    );
  });

  it('up skips an already-installed app and is idempotent on a second run', async () => {
    const state: FakeState = {
      credentials: [active('outlook'), active('gmail')],
      installs: new Map([
        ['reply-outlook-emails', { installedBy: 'admin@acme.com' }],
      ]),
      installCalls: [],
      uninstallCalls: [],
    };
    await migration.up(fakeCtx(state), ORG, helpers);
    expect(state.installCalls).toEqual([
      {
        automationSlug: 'reply-gmail-emails',
        installedBy: MIGRATION_INSTALLED_BY,
      },
    ]);
    // The human install row was never overwritten.
    expect(state.installs.get('reply-outlook-emails')).toEqual({
      installedBy: 'admin@acme.com',
    });

    await migration.up(fakeCtx(state), ORG, helpers);
    expect(state.installCalls).toHaveLength(1);
  });

  it('up logs and continues past a failed install instead of aborting the org', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const state: FakeState = {
        credentials: [active('outlook'), active('gmail')],
        installs: new Map(),
        installCalls: [],
        uninstallCalls: [],
        failInstalls: new Set(['reply-outlook-emails']),
      };
      await expect(
        migration.up(fakeCtx(state), ORG, helpers),
      ).resolves.toBeUndefined();
      // reply-gmail-emails still installed despite reply-outlook-emails failing first.
      expect(state.installCalls).toEqual([
        {
          automationSlug: 'reply-gmail-emails',
          installedBy: MIGRATION_INSTALLED_BY,
        },
      ]);
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('down uninstalls ONLY marker-stamped rows and is idempotent', async () => {
    const state: FakeState = {
      credentials: [],
      installs: new Map([
        ['reply-outlook-emails', { installedBy: MIGRATION_INSTALLED_BY }],
        ['reply-gmail-emails', { installedBy: 'admin@acme.com' }],
      ]),
      installCalls: [],
      uninstallCalls: [],
    };
    await migration.down(fakeCtx(state), ORG, helpers);
    expect(state.uninstallCalls).toEqual(['reply-outlook-emails']);
    expect(state.installs.has('reply-gmail-emails')).toBe(true);

    await migration.down(fakeCtx(state), ORG, helpers);
    expect(state.uninstallCalls).toHaveLength(1);
  });

  it('up + down round-trips to the pre-migration state', async () => {
    const state: FakeState = {
      credentials: [active('imap_smtp')],
      installs: new Map(),
      installCalls: [],
      uninstallCalls: [],
    };
    const ctx = fakeCtx(state);
    await migration.up(ctx, ORG, helpers);
    expect([...state.installs.keys()]).toEqual(['reply-imap-emails']);
    await migration.down(ctx, ORG, helpers);
    expect(state.installs.size).toBe(0);
  });
});
