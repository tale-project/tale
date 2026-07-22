import { describe, expect, it } from 'vitest';

import {
  automationInstalledTabValues,
  automationSwitchLocation,
} from './automation-switch-path';

describe('automationInstalledTabValues', () => {
  it('always includes integrations and configuration', () => {
    const tabs = automationInstalledTabValues(
      { scope: 'org', workflows: [], views: [] },
      true,
    );
    expect(tabs.has('integrations')).toBe(true);
    expect(tabs.has('configuration')).toBe(true);
    expect(tabs.has('editor')).toBe(false);
  });

  it('adds workflow tabs for a developer when a workflow exists', () => {
    const tabs = automationInstalledTabValues(
      { scope: 'org', workflows: ['notify'], views: [] },
      true,
    );
    expect(tabs.has('editor')).toBe(true);
    expect(tabs.has('executions')).toBe(true);
    expect(tabs.has('triggers')).toBe(true);
    expect(tabs.has('environment')).toBe(true);
  });

  it('omits workflow tabs when the caller is not a developer', () => {
    const tabs = automationInstalledTabValues(
      { scope: 'org', workflows: ['notify'], views: [] },
      false,
    );
    expect(tabs.has('editor')).toBe(false);
    expect(tabs.has('triggers')).toBe(false);
  });

  it('includes org-scoped view ids and skips them on project scope', () => {
    const views = [{ id: 'inbox', data: {} }] as never;
    expect(
      automationInstalledTabValues(
        { scope: 'org', workflows: [], views },
        false,
      ).has('inbox'),
    ).toBe(true);
    expect(
      automationInstalledTabValues(
        { scope: 'project', workflows: [], views },
        false,
      ).has('inbox'),
    ).toBe(false);
  });
});

describe('automationSwitchLocation', () => {
  const org = 'org-1';
  const withWorkflowTabs = new Set([
    'editor',
    'executions',
    'triggers',
    'environment',
    'integrations',
    'configuration',
  ]);
  const withoutWorkflowTabs = new Set(['integrations', 'configuration']);

  it('keeps ?tab= when the target exposes it', () => {
    expect(
      automationSwitchLocation({
        organizationId: org,
        toSlug: 'gmail/sync-emails',
        search: { tab: 'configuration' },
        targetTabValues: withoutWorkflowTabs,
      }),
    ).toEqual({
      pathname: `/dashboard/${org}/automations/gmail__sync-emails`,
      search: { tab: 'configuration' },
    });
  });

  it('drops ?tab=editor when the target has no editor', () => {
    expect(
      automationSwitchLocation({
        organizationId: org,
        toSlug: 'inbox-only',
        search: { tab: 'editor' },
        targetTabValues: withoutWorkflowTabs,
      }),
    ).toEqual({
      pathname: `/dashboard/${org}/automations/inbox-only`,
      search: {},
    });
  });

  it('keeps editor when the target has workflow tabs', () => {
    expect(
      automationSwitchLocation({
        organizationId: org,
        toSlug: 'other',
        search: { tab: 'editor' },
        targetTabValues: withWorkflowTabs,
      }).search,
    ).toEqual({ tab: 'editor' });
  });

  it('builds the project-scoped root path', () => {
    expect(
      automationSwitchLocation({
        organizationId: org,
        toSlug: 'other',
        projectId: 'proj-1',
        search: {},
        targetTabValues: withWorkflowTabs,
      }).pathname,
    ).toBe(`/dashboard/${org}/projects/proj-1/automations/other`);
  });
});
