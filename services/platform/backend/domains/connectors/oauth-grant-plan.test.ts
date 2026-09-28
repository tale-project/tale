// @vitest-environment node

/**
 * Where a completed consent lands, per intent (#3711). An Add never renews
 * another credential — the connector's default least of all; a Reconnect
 * renews exactly the credential it named or nothing; Slack keeps one
 * credential per workspace.
 */

import { describe, expect, it } from 'vitest';

import type { ConsentIntent } from '../../../lib/shared/connector-consent.ts';
import {
  planOauth2Grant,
  type GrantPlanInput,
  type GrantSibling,
} from './oauth-grant-plan.ts';

const row = (
  id: string,
  name: string,
  extra: Partial<GrantSibling> = {},
): GrantSibling => ({
  id,
  name,
  authMethod: 'oauth2',
  status: 'active',
  ...extra,
});

const ADD: ConsentIntent = { kind: 'add' };
const reconnect = (credentialId: string): ConsentIntent => ({
  kind: 'reconnect',
  credentialId,
});

const plan = (overrides: Partial<GrantPlanInput>) =>
  planOauth2Grant({
    organizationId: 'org-1',
    intent: ADD,
    displayName: 'Gmail',
    nameMax: 100,
    siblings: [],
    target: null,
    route: null,
    targetTeams: [],
    ...overrides,
  });

describe('planOauth2Grant — Add', () => {
  it('stores the first credential under the connector name', () => {
    expect(plan({})).toEqual({ kind: 'create', name: 'Gmail' });
  });

  it('adds a second account as a NEW credential instead of renewing the default', () => {
    expect(
      plan({ siblings: [row('cred-default', 'Gmail', { status: 'active' })] }),
    ).toEqual({ kind: 'create', name: 'Gmail 2' });
  });

  it('numbers past every sibling name, whatever its method, case-insensitively', () => {
    expect(
      plan({
        siblings: [
          row('a', 'gmail'),
          row('b', 'Gmail 2', { status: 'needs-reauth' }),
          row('c', 'GMAIL 3', { authMethod: 'api-key' }),
        ],
      }),
    ).toEqual({ kind: 'create', name: 'Gmail 4' });
  });
});

describe('planOauth2Grant — Reconnect', () => {
  const siblings = [
    row('cred-default', 'Gmail'),
    row('cred-sales', 'Gmail sales', { status: 'needs-reauth' }),
  ];

  it('renews exactly the credential it named — not the default', () => {
    expect(
      plan({
        intent: reconnect('cred-sales'),
        siblings,
        target: siblings[1] ?? null,
      }),
    ).toEqual({ kind: 'renew', credentialId: 'cred-sales', reactivate: true });
  });

  it('refuses when the credential is gone, rather than landing on a sibling', () => {
    expect(
      plan({ intent: reconnect('cred-sales'), siblings, target: null }),
    ).toEqual({ kind: 'refuse', reason: 'credential_missing' });
  });

  it('refuses a locked row that is not the one the intent names', () => {
    expect(
      plan({
        intent: reconnect('cred-sales'),
        siblings,
        target: siblings[0] ?? null,
      }),
    ).toEqual({ kind: 'refuse', reason: 'credential_missing' });
  });

  it('renews a disabled credential without lifting the pause', () => {
    const disabled = row('cred-paused', 'Gmail paused', { status: 'disabled' });
    expect(
      plan({
        intent: reconnect('cred-paused'),
        siblings: [...siblings, disabled],
        target: disabled,
      }),
    ).toEqual({
      kind: 'renew',
      credentialId: 'cred-paused',
      reactivate: false,
    });
  });
});

describe('planOauth2Grant — Slack workspaces', () => {
  const slack = (overrides: Partial<GrantPlanInput>) =>
    plan({ displayName: 'Slack', ...overrides });
  const routed = (credentialId: string, organizationId = 'org-1') => ({
    organizationId,
    credentialId,
  });

  it('claims the workspace for a first connection', () => {
    expect(slack({ team: { id: 'T-1', name: 'Acme' } })).toEqual({
      kind: 'create',
      name: 'Slack',
      claimTeamId: 'T-1',
    });
  });

  it('renews the credential an already connected workspace routes to, even on Add', () => {
    expect(
      slack({
        siblings: [row('cred-1', 'Slack')],
        team: { id: 'T-1' },
        route: routed('cred-1'),
      }),
    ).toEqual({ kind: 'renew', credentialId: 'cred-1', reactivate: true });
  });

  it('keeps a disabled workspace credential disabled when it is renewed', () => {
    expect(
      slack({
        siblings: [row('cred-1', 'Slack', { status: 'disabled' })],
        team: { id: 'T-1' },
        route: routed('cred-1'),
      }),
    ).toEqual({ kind: 'renew', credentialId: 'cred-1', reactivate: false });
  });

  it('names a second workspace after itself', () => {
    expect(
      slack({
        siblings: [row('cred-1', 'Slack')],
        team: { id: 'T-2', name: 'Second Workspace' },
      }),
    ).toEqual({
      kind: 'create',
      name: 'Slack (Second Workspace)',
      claimTeamId: 'T-2',
    });
  });

  it('falls back to a counter when the workspace name is unknown or taken', () => {
    expect(
      slack({
        siblings: [row('cred-1', 'Slack'), row('cred-2', 'Slack 2')],
        team: { id: 'T-3' },
      }),
    ).toEqual({ kind: 'create', name: 'Slack 3', claimTeamId: 'T-3' });
  });

  it('keeps a long workspace label within the name limit, with room for a counter', () => {
    const outcome = slack({
      nameMax: 30,
      siblings: [row('cred-1', 'Slack')],
      team: { id: 'T-4', name: 'A workspace with a very long name' },
    });
    expect(outcome).toMatchObject({ kind: 'create', claimTeamId: 'T-4' });
    expect(outcome.kind === 'create' && outcome.name.length).toBe(24);
  });

  it('refuses a workspace another organization holds, for either intent', () => {
    for (const intent of [ADD, reconnect('cred-1')]) {
      expect(
        slack({
          intent,
          siblings: [row('cred-1', 'Slack')],
          target: row('cred-1', 'Slack'),
          team: { id: 'T-1' },
          route: routed('cred-x', 'org-other'),
        }),
      ).toEqual({ kind: 'refuse', reason: 'workspace_claimed' });
    }
  });

  it('renews a Reconnect in the workspace the credential is routed from', () => {
    expect(
      slack({
        intent: reconnect('cred-2'),
        siblings: [row('cred-1', 'Slack'), row('cred-2', 'Slack (B)')],
        target: row('cred-2', 'Slack (B)'),
        team: { id: 'T-B' },
        route: routed('cred-2'),
        targetTeams: ['T-B'],
      }),
    ).toEqual({ kind: 'renew', credentialId: 'cred-2', reactivate: true });
  });

  it("refuses a Reconnect into a workspace another of this organization's credentials holds", () => {
    expect(
      slack({
        intent: reconnect('cred-2'),
        siblings: [row('cred-1', 'Slack'), row('cred-2', 'Slack (B)')],
        target: row('cred-2', 'Slack (B)'),
        team: { id: 'T-A' },
        route: routed('cred-1'),
        targetTeams: ['T-B'],
      }),
    ).toEqual({ kind: 'refuse', reason: 'account_mismatch' });
  });

  it('refuses a Reconnect into an unrouted workspace when the credential holds another', () => {
    expect(
      slack({
        intent: reconnect('cred-2'),
        siblings: [row('cred-2', 'Slack (B)')],
        target: row('cred-2', 'Slack (B)'),
        team: { id: 'T-NEW' },
        targetTeams: ['T-B'],
      }),
    ).toEqual({ kind: 'refuse', reason: 'account_mismatch' });
  });

  it('routes a workspace to a Reconnect target that holds none yet', () => {
    expect(
      slack({
        intent: reconnect('cred-9'),
        siblings: [row('cred-9', 'Slack imported')],
        target: row('cred-9', 'Slack imported'),
        team: { id: 'T-9' },
      }),
    ).toEqual({
      kind: 'renew',
      credentialId: 'cred-9',
      reactivate: true,
      claimTeamId: 'T-9',
    });
  });
});
