// @vitest-environment node

import { describe, expect, it } from 'vitest';

import {
  ORGANIZATION_CREATORS_ENV,
  organizationCreationAllowed,
  parseOrganizationCreators,
} from './organization-creation-gate.ts';

/** A deployment that would answer the organization probe, counting the asking. */
function deployment(hasOrganizations: boolean) {
  let asked = 0;
  return {
    deploymentHasOrganizations: () => {
      asked += 1;
      return Promise.resolve(hasOrganizations);
    },
    timesAsked: () => asked,
  };
}

const creators = (value: string) =>
  parseOrganizationCreators({ [ORGANIZATION_CREATORS_ENV]: value });

describe('parseOrganizationCreators', () => {
  it('is null — no list — while the variable is unset', () => {
    expect(parseOrganizationCreators({})).toBeNull();
    expect(
      parseOrganizationCreators({ [ORGANIZATION_CREATORS_ENV]: undefined }),
    ).toBeNull();
  });

  it('is an empty list — nobody — when the variable is set but names no one', () => {
    expect(creators('')?.size).toBe(0);
    expect(creators('  ,; ')?.size).toBe(0);
  });

  it('reads the deployment-editor grammar: separators, trimming, case', () => {
    expect(
      [
        ...(creators(' Ops@Example.org, sam@example.test;\tEVE@x.io ') ?? []),
      ].sort(),
    ).toEqual(['eve@x.io', 'ops@example.org', 'sam@example.test']);
  });
});

describe('organizationCreationAllowed', () => {
  it('always allows the server-side call the deployment itself makes', async () => {
    for (const hasOrganizations of [false, true]) {
      const target = deployment(hasOrganizations);
      await expect(
        organizationCreationAllowed({
          overHttp: false,
          email: undefined,
          creators: creators(''),
          deploymentHasOrganizations: target.deploymentHasOrganizations,
        }),
      ).resolves.toBe(true);
      expect(target.timesAsked()).toBe(0);
    }
  });

  it('keeps the previous behaviour without a list: any signed-in user may create', async () => {
    const occupied = deployment(true);
    await expect(
      organizationCreationAllowed({
        overHttp: true,
        email: 'stranger@example.test',
        creators: null,
        deploymentHasOrganizations: occupied.deploymentHasOrganizations,
      }),
    ).resolves.toBe(true);
    expect(occupied.timesAsked()).toBe(0);
  });

  it('lets a listed address create, compared case-insensitively, without asking the database', async () => {
    const occupied = deployment(true);
    await expect(
      organizationCreationAllowed({
        overHttp: true,
        email: 'Sam@Example.test',
        creators: creators('ops@example.org, sam@example.test'),
        deploymentHasOrganizations: occupied.deploymentHasOrganizations,
      }),
    ).resolves.toBe(true);
    expect(occupied.timesAsked()).toBe(0);
  });

  it('refuses an unlisted address once the deployment holds an organization', async () => {
    const occupied = deployment(true);
    await expect(
      organizationCreationAllowed({
        overHttp: true,
        email: 'stranger@example.test',
        creators: creators('ops@example.org'),
        deploymentHasOrganizations: occupied.deploymentHasOrganizations,
      }),
    ).resolves.toBe(false);
    expect(occupied.timesAsked()).toBe(1);
  });

  it('lets anyone create the FIRST organization — the setup flow and the managed bootstrap', async () => {
    const empty = deployment(false);
    await expect(
      organizationCreationAllowed({
        overHttp: true,
        email: 'first-owner@example.test',
        creators: creators('ops@example.org'),
        deploymentHasOrganizations: empty.deploymentHasOrganizations,
      }),
    ).resolves.toBe(true);
  });

  it('a list that names nobody closes creation to everyone after the first organization', async () => {
    const occupied = deployment(true);
    await expect(
      organizationCreationAllowed({
        overHttp: true,
        email: 'owner@example.test',
        creators: creators(''),
        deploymentHasOrganizations: occupied.deploymentHasOrganizations,
      }),
    ).resolves.toBe(false);
  });

  it('a caller without an address is never on a list', async () => {
    const occupied = deployment(true);
    await expect(
      organizationCreationAllowed({
        overHttp: true,
        email: undefined,
        creators: creators('ops@example.org'),
        deploymentHasOrganizations: occupied.deploymentHasOrganizations,
      }),
    ).resolves.toBe(false);
  });
});
