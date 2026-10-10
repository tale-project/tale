import { describe, expect, it } from 'vitest';

import {
  automationPackManifestSchema,
  automationTriggerSchema,
} from './automation-pack';

describe('the shared manifest contract', () => {
  it('preserves presentation and the stored task contract normalization', () => {
    const value = automationPackManifestSchema.parse({
      name: 'Case desk',
      scope: 'project',
      hidden: true,
      labels: ['Documents'],
      builtinViews: [{ id: 'inbox' }],
      i18n: { de: { name: 'Fallprüfung' } },
      subjects: {
        task: {
          workflow: 'case-desk',
          ignoredStoredKey: 'stripped',
          input: { kind: 'folder', setupFolderName: 'Setup', ignored: true },
          outcome: {
            files: ['report.md', { name: 'notes.md', optional: true }],
          },
        },
      },
    });
    expect(value).toEqual({
      name: 'Case desk',
      scope: 'project',
      hidden: true,
      labels: ['Documents'],
      builtinViews: [{ id: 'inbox' }],
      i18n: { de: { name: 'Fallprüfung' } },
      subjects: {
        task: {
          workflow: 'case-desk',
          input: { kind: 'folder', setupFolderName: 'Setup' },
          outcome: {
            files: ['report.md', { name: 'notes.md', optional: true }],
          },
        },
      },
    });
    expect(
      automationPackManifestSchema.safeParse({ ...value, unknown: true })
        .success,
    ).toBe(false);
  });

  it('declares triggers with the shared trigger contract, strictly', () => {
    for (const kind of ['event', 'webhook']) {
      expect(automationTriggerSchema.parse({ kind })).toEqual({ kind });
    }
    const schedule = {
      kind: 'schedule',
      cron: '0 0 * * *',
      timezone: 'Europe/Zurich',
    };
    expect(automationTriggerSchema.parse(schedule)).toEqual(schedule);
    const rule = {
      kind: 'schedule',
      repeat: { frequency: 'minutely', interval: 5 },
      timezone: 'UTC',
      input: { owner: 'tale' },
    };
    expect(automationTriggerSchema.parse(rule)).toEqual(rule);
    for (const value of [
      { kind: 'api-key' },
      { kind: 'webhook', unknown: true },
      { kind: 'event', event: '' },
      // A schedule names a repeat rule or a cron expression.
      { kind: 'schedule' },
      // The anchor is the install day; a pack mints no token to rotate.
      { ...rule, startDate: '2026-10-08' },
      { kind: 'webhook', rotateToken: true },
    ]) {
      expect(automationTriggerSchema.safeParse(value).success).toBe(false);
    }
  });
});

describe('the manifest skills declaration', () => {
  const base = { name: 'Carrier' };

  it('accepts valid skill slugs', () => {
    const parsed = automationPackManifestSchema.parse({
      ...base,
      skills: ['document-verify', 'pdf2'],
    });
    expect(parsed.skills).toEqual(['document-verify', 'pdf2']);
  });

  it('refuses a slug the skills domain would refuse', () => {
    for (const bad of ['Upper', 'double--hyphen', '-lead', 'claude']) {
      expect(
        automationPackManifestSchema.safeParse({ ...base, skills: [bad] })
          .success,
      ).toBe(false);
    }
  });

  it('refuses more skills than one package may carry', () => {
    const skills = Array.from({ length: 21 }, (_, i) => `skill-${i}`);
    expect(
      automationPackManifestSchema.safeParse({ ...base, skills }).success,
    ).toBe(false);
  });
});

describe('the manifest settings declaration', () => {
  const base = { name: 'Carrier' };
  const form = {
    file: 'validation-policy.yaml',
    title: 'Validation policy',
    fields: [
      {
        key: 'method',
        label: 'Validation profile',
        type: 'select',
        options: [{ value: 'strict_rules', label: 'Strict checklist' }],
      },
    ],
  };

  it('accepts a settings block and carries it through', () => {
    const parsed = automationPackManifestSchema.parse({
      ...base,
      settings: { folder: 'Setup', forms: [form] },
    });
    expect(parsed.settings?.forms[0]).toMatchObject({
      file: 'validation-policy.yaml',
    });
  });

  it('refuses a malformed settings block at the manifest door', () => {
    expect(
      automationPackManifestSchema.safeParse({
        ...base,
        settings: { forms: [{ ...form, fields: [] }] },
      }).success,
    ).toBe(false);
  });
});
