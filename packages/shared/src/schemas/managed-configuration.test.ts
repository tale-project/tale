import { describe, expect, it } from 'vitest';

import { AGENT_TOOL_CATALOG } from '../agent-tool-grants';
import {
  managedAgentToolsSchema,
  managedAutomationScheduleSchema,
  managedAgentModelSchema,
  managedAgentModelObservationSchema,
  managedPlatformResourceSchema,
} from './managed-configuration';
import { PROJECT_AGENT_BINDINGS_MAX } from './projects';

describe('explicit managed review-context creation', () => {
  const resource = {
    kind: 'task-review-context',
    config: {
      projectId: 'project-a',
      taskId: '2045dc63-4934-40fc-89f8-f66b82a30152',
      reviewerAgentId: 'reviewer-a',
      enabled: true,
    },
  };
  it('keeps creation separate from the stored config and preserves adoption-only IDs', () => {
    expect(
      managedPlatformResourceSchema.parse({
        ...resource,
        createIfMissing: true,
      }),
    ).toEqual({ ...resource, createIfMissing: true });
    const adoption = {
      ...resource,
      config: { ...resource.config, taskId: 'existing-context' },
    };
    expect(managedPlatformResourceSchema.parse(adoption)).toEqual(adoption);
    expect(
      managedPlatformResourceSchema.safeParse({
        ...adoption,
        createIfMissing: true,
      }).success,
    ).toBe(false);
  });
  it.each([false, null, 'true', 1])(
    'refuses implicit or malformed creation policy %j',
    (createIfMissing) => {
      expect(
        managedPlatformResourceSchema.safeParse({
          ...resource,
          createIfMissing,
        }).success,
      ).toBe(false);
    },
  );
  it('does not accept task titles, caller IDs, permissions or creation policy inside config', () => {
    for (const extra of [
      { createIfMissing: true },
      { title: 'Caller title' },
      { createdBy: 'another-user' },
      { tools: ['task_start_agent'] },
    ])
      expect(
        managedPlatformResourceSchema.safeParse({
          ...resource,
          config: { ...resource.config, ...extra },
        }).success,
      ).toBe(false);
  });
});

describe('managed agent tool declarations', () => {
  const identity = { projectId: 'project-a', agentId: 'agent-a' };

  it('canonicalizes duplicate grants in catalog order, including project-only tools', () => {
    const tools = AGENT_TOOL_CATALOG.map((tool) => tool.name);
    expect(
      managedPlatformResourceSchema.parse({
        kind: 'agent-tools',
        config: {
          ...identity,
          tools: [...tools].reverse().concat(tools.slice(0, 1)),
        },
      }),
    ).toEqual({ kind: 'agent-tools', config: { ...identity, tools } });
    expect(managedAgentToolsSchema.parse({ ...identity, tools: [] })).toEqual({
      ...identity,
      tools: [],
    });
  });

  it.each([
    { tools: ['task_review', 'unknown_tool'] },
    { tools: ['generate_image'] },
    { tools: [' task_review '] },
    { tools: Array(PROJECT_AGENT_BINDINGS_MAX + 1).fill('task_get') },
    { tools: null },
    { tools: [], secrets: ['PRIVATE_TOKEN'] },
    { tools: [], instructions: 'replace unrelated text' },
    { tools: [], model: 'replace-runtime' },
    { tools: [], expectedUpdatedAt: 1 },
  ])(
    'rejects unknown, excessive or unowned configuration fields: %j',
    (fields) => {
      expect(
        managedAgentToolsSchema.safeParse({ ...identity, ...fields }).success,
      ).toBe(false);
    },
  );

  it('requires both explicit identities and the complete desired grant set', () => {
    for (const config of [
      { tools: [] },
      { ...identity },
      { ...identity, agentId: '', tools: [] },
    ])
      expect(managedAgentToolsSchema.safeParse(config).success).toBe(false);
  });
});

describe('managed schedule slot-wake opt-in (#4540)', () => {
  const schedule = {
    projectId: 'project-a',
    name: 'fleet/dispatch',
    cron: '*/30 * * * *',
    timezone: 'Europe/Zurich',
    enabled: true,
  };

  it('declares the opt-in as true, and the opt-out by leaving it out', () => {
    expect(
      managedAutomationScheduleSchema.parse({
        ...schedule,
        wakeOnSlotFreed: true,
      }),
    ).toEqual({ ...schedule, wakeOnSlotFreed: true });
    expect(managedAutomationScheduleSchema.parse(schedule)).toEqual(schedule);
  });

  it.each([false, 'true', 1, null])(
    'refuses %j, so a readback and its declaration always hash alike',
    (wakeOnSlotFreed) => {
      expect(
        managedAutomationScheduleSchema.safeParse({
          ...schedule,
          wakeOnSlotFreed,
        }).success,
      ).toBe(false);
    },
  );
});

describe('managed schedule declarations read as the platform stores them', () => {
  const rule = {
    projectId: 'project-a',
    name: 'reports/weekly',
    repeat: {
      frequency: 'weekly',
      interval: 1,
      weekdays: [5, 1, 5],
      times: ['17:00', '09:00'],
    },
    startDate: '2026-10-01',
    timezone: 'utc',
    enabled: true,
  };

  it('reads a repeat rule in its normal form, whatever order the file uses', () => {
    expect(managedAutomationScheduleSchema.parse(rule)).toEqual({
      ...rule,
      repeat: {
        frequency: 'weekly',
        interval: 1,
        weekdays: [1, 5],
        times: ['09:00', '17:00'],
      },
    });
  });

  it('keeps the zone the way the declaration spells it', () => {
    expect(managedAutomationScheduleSchema.parse(rule).timezone).toBe('utc');
  });

  it.each([' UTC', 'UTC ', '\tEurope/Zurich'])(
    'refuses the zone %j, which no stored zone would ever equal',
    (timezone) => {
      expect(
        managedAutomationScheduleSchema.safeParse({ ...rule, timezone })
          .success,
      ).toBe(false);
    },
  );
});

describe('managed agent model declarations', () => {
  const config = {
    projectId: 'project-a',
    agentId: 'agent-a',
    harness: 'codex',
    model: 'model-a',
    modelProvider: 'provider-a',
  };
  it('requires an explicit provider and preserves nullable legacy observations', () => {
    expect(
      managedPlatformResourceSchema.parse({ kind: 'agent-model', config }),
    ).toEqual({ kind: 'agent-model', config });
    expect(
      managedAgentModelSchema.parse({
        ...config,
        model: ' model-a ',
        modelProvider: ' provider-a ',
      }),
    ).toEqual(config);
    expect(
      managedAgentModelObservationSchema.parse({
        ...config,
        modelProvider: null,
      }).modelProvider,
    ).toBeNull();
    expect(
      managedAgentModelObservationSchema.parse({
        ...config,
        model: ' legacy ',
        modelProvider: ' legacy-provider ',
      }).model,
    ).toBe(' legacy ');
  });
  it.each([
    { modelProvider: undefined },
    { modelProvider: null },
    { modelProvider: '' },
    { modelProvider: ' ' },
    { model: ' ' },
    { harness: '' },
    { agentId: '' },
    { secrets: [] },
    { tools: [] },
    { instructions: 'overwrite' },
    { name: 'overwrite' },
  ])('rejects incomplete or unrelated fields %j', (fields) => {
    expect(
      managedAgentModelSchema.safeParse({ ...config, ...fields }).success,
    ).toBe(false);
  });
});
